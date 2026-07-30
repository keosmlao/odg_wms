import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { IN_TRANSIT_WH, TRANSFER_FORMAT } from "@/lib/erpPost";
import PrintLetterhead from "@/components/PrintLetterhead";
import { fitCell } from "@/lib/printFit";
import AutoPrint from "../AutoPrint";

/**
 * ໃບບິນໂອນສິນຄ້າ — the copy that travels WITH the goods.
 *
 * Deliberately coarser than the movement slip next door (../page.tsx): item and
 * quantity only, down to the warehouse, never the bin and never the serials.
 * The driver and the receiving side check "what and how many", they have no use
 * for the source rack — and printing bin numbers on a document that leaves the
 * building only leaks the layout.
 *
 * One line per item: an item picked from several bins is summed into a single
 * row, so this bill never shows the same code twice.
 *
 * IDENTITY: this bill is headed by the ERP transfer number (FT…), not the WMS
 * movement number (DP…). Everyone outside the warehouse — the destination store,
 * accounting, SmartBiz — tracks the transfer by its FT; the DP is an internal
 * WMS id and is printed only as a cross-reference. The SN/ISN movement slip next
 * door keeps leading with the DP, since that is the warehouse's own record.
 */
type Header = {
  doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null;
  wh_code: string | null; wh_name: string | null; user_created: string | null; user_name: string | null;
};
type Line = {
  item_code: string; item_name: string | null; unit_code: string | null; qty: string;
  from_wh: string | null; from_wh_name: string | null; to_wh: string | null; to_wh_name: string | null;
};

/** Blank rows padded on so the printed bill keeps a constant shape. */
const MIN_FORM_ROWS = 16;

function whLabel(code: string | null, name: string | null) {
  if (!code) return "—";
  return name ? `${code} · ${name}` : code;
}

export default async function PrintTransferBillPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { doc } = await params;
  const sp = await searchParams;
  const docNo = decodeURIComponent(doc).trim();

  const head = await query<Header>(
    `SELECT t.doc_no, to_char(t.doc_date,'DD/MM/YYYY') AS doc_date, t.doc_time, t.doc_ref,
            t.wh_code, w.name_1 AS wh_name, t.user_created, e.fullname_lo AS user_name
     FROM public.odg_wms_trans t
     LEFT JOIN public.ic_warehouse w ON w.code = t.wh_code
     LEFT JOIN public.odg_employee e ON e.employee_code = t.user_created
     WHERE t.doc_no = $1 LIMIT 1`,
    [docNo],
  );
  const h = head[0];

  // GROUP BY item_code is what collapses a multi-bin pick into one billed line.
  const lines = h ? await query<Line>(
    `SELECT d.item_code,
            MAX(d.item_name) AS item_name,
            MAX(d.unit_code) AS unit_code,
            COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = -1), SUM(d.qty) FILTER (WHERE d.calc_flag = 1))::numeric::text AS qty,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = -1) AS from_wh,
            MAX(wf.name_1) FILTER (WHERE d.calc_flag = -1) AS from_wh_name,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = 1) AS to_wh,
            MAX(wt.name_1) FILTER (WHERE d.calc_flag = 1) AS to_wh_name
     FROM public.odg_wms_trans_detail d
     LEFT JOIN public.ic_warehouse wf ON wf.code = d.wh_code AND d.calc_flag = -1
     LEFT JOIN public.ic_warehouse wt ON wt.code = d.wh_code AND d.calc_flag = 1
     WHERE d.doc_no = $1
     GROUP BY d.item_code ORDER BY d.item_code`,
    [docNo],
  ) : [];

  // The ERP transfer doc this movement posted. `doc_ref_trans` on ic_trans is set
  // to the WMS DP that created it (see erpPost.postErpTransfer), and each ERP doc
  // has both a 70 and a 72 row under one doc_no — hence DISTINCT. FT first, so a
  // transfer is always headed by its ໃບໂອນ even if some other ERP doc is linked.
  const erpDocs = h ? await query<{ doc_no: string; doc_format_code: string | null; doc_date: string | null; doc_time: string | null }>(
    `SELECT DISTINCT ON (doc_no) doc_no, doc_format_code,
            to_char(doc_date,'DD/MM/YYYY') AS doc_date, doc_time
     FROM public.ic_trans WHERE doc_ref_trans = $1
     ORDER BY doc_no, (doc_format_code = '${TRANSFER_FORMAT}') DESC`,
    [docNo],
  ) : [];
  const erp = erpDocs.find((e) => e.doc_format_code === TRANSFER_FORMAT) ?? erpDocs[0] ?? null;
  // Head the bill with the FT when there is one; otherwise fall back to the WMS
  // doc rather than printing a blank number, and say which one is being shown.
  const billNo = erp?.doc_no ?? h?.doc_no ?? docNo;

  const fromWh = lines.find((l) => l.from_wh)?.from_wh ?? h?.wh_code ?? null;
  const fromWhName = lines.find((l) => l.from_wh)?.from_wh_name ?? h?.wh_name ?? null;
  const toWh = lines.find((l) => l.to_wh)?.to_wh ?? null;
  const toWhName = lines.find((l) => l.to_wh)?.to_wh_name ?? null;

  // A transfer-out lands in the in-transit warehouse; the bill should name where
  // the goods are really headed, taken from the request (124) it fulfils.
  let finalDest: string | null = null;
  let refRemark: string | null = null;
  if (h?.doc_ref) {
    const dest = await query<{ wh_to: string | null; wh_to_name: string | null; remark: string | null }>(
      `SELECT h.wh_to, w.name_1 AS wh_to_name, h.remark
       FROM public.ic_trans h LEFT JOIN public.ic_warehouse w ON w.code = h.wh_to
       WHERE h.doc_no = $1 AND h.trans_flag = 124 LIMIT 1`,
      [h.doc_ref],
    );
    if (dest[0]?.wh_to) finalDest = whLabel(dest[0].wh_to, dest[0].wh_to_name);
    refRemark = dest[0]?.remark ?? null;
  }
  // Show the real destination rather than the in-transit staging code.
  const destLabel = toWh === IN_TRANSIT_WH ? (finalDest ?? whLabel(toWh, toWhName)) : whLabel(toWh, toWhName);

  const totalQty = lines.reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0);
  const filler = Math.max(0, MIN_FORM_ROWS - lines.length);
  // Nothing on a document that leaves the building may be clipped — the receiver
  // has no way to recover an item code or name that ends in "…".
  const cell = "border border-slate-400 px-1.5 py-[3px] align-top";
  const wrap = { overflowWrap: "anywhere" as const, wordBreak: "break-word" as const };
  // Usable inner width of the ລາຍການສິນຄ້າ column: 58% of the table (190mm page
  // less the 20px page padding ≈ 678px) minus this cell's 6px side padding.
  const NAME_COL_PX = Math.round(678 * 0.58) - 12;

  return (
    <div className="mx-auto flex max-w-[190mm] flex-col bg-white p-5 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif", minHeight: "100vh" }}>
      <style>{`@media print { .no-print { display:none !important } @page { size: A4; margin: 8mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບເອກະສານ {docNo}</p>
      ) : (
        <div className="flex flex-1 flex-col">
          <PrintLetterhead docNo={billNo} />

          <div className="mb-3 text-center text-base font-bold">ໃບບິນໂອນສິນຄ້າ</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ຈາກສາງ:</b> {whLabel(fromWh, fromWhName)}</div>
            <div>
              <b>ເລກທີ່ໂອນ:</b> <span className="font-mono font-bold">{billNo}</span>
              {!erp && <span className="ml-1 text-[10px] text-slate-500">(ຍັງບໍ່ໄດ້ອອກເລກ ໃບໂອນ ERP)</span>}
            </div>
            <div><b>ເຖິງສາງ:</b> {destLabel}</div>
            <div><b>ວັນທີ:</b> {erp?.doc_date ?? h.doc_date} {erp?.doc_time ?? h.doc_time}</div>
            <div><b>ອ້າງອີງ ໃບຂໍໂອນ:</b> <span className="font-mono">{h.doc_ref ?? "—"}</span></div>
            {/* Cross-reference back to the WMS movement, so this bill can always
                be matched to the SN/ISN slip that lists the units. */}
            {erp && <div><b>ເອກະສານ WMS:</b> <span className="font-mono">{h.doc_no}</span></div>}
            <div><b>ຜູ້ດຳເນີນ:</b> {h.user_name?.trim() || h.user_created || "—"}</div>
            {refRemark && <div className="col-span-2"><b>ໝາຍເຫດ:</b> {refRemark}</div>}
          </div>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              {/* The name column takes everything the other four don't need, so
                  long names fit on one line at as large a size as possible. */}
              <col className="w-[5%]" /><col className="w-[15%]" /><col className="w-[58%]" />
              <col className="w-[11%]" /><col className="w-[11%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className={`${cell} text-center`}>#</th>
                <th className={cell}>ລະຫັດສິນຄ້າ</th>
                <th className={cell}>ລາຍການສິນຄ້າ</th>
                <th className={`${cell} text-right`}>ຈຳນວນ</th>
                <th className={cell}>ໜ່ວຍ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.item_code}>
                  <td className={`${cell} text-center`}>{i + 1}</td>
                  <td className={`${cell} font-mono font-bold`} style={wrap}>{l.item_code}</td>
                  {/* Shrinks to hold a long name on one line; wraps only when
                      one line would stop being readable. Never truncates. */}
                  <td className={cell} style={fitCell(l.item_name, NAME_COL_PX)}>{l.item_name}</td>
                  <td className={`${cell} text-right font-mono`}>{Number.parseFloat(l.qty)}</td>
                  <td className={cell} style={wrap}>{l.unit_code ?? ""}</td>
                </tr>
              ))}
              {Array.from({ length: filler }, (_, i) => (
                <tr key={`blank-${i}`}>
                  {Array.from({ length: 5 }, (_, c) => <td key={c} className={cell}>&nbsp;</td>)}
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className={cell} colSpan={3}>ຈຳນວນທັງໝົດ</td>
                <td className={`${cell} text-right font-mono`}>{totalQty.toFixed(2)}</td>
                <td className={cell}>{lines[0]?.unit_code ?? ""}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-auto pt-10" style={{ breakInside: "avoid" }}>
            <div className="grid grid-cols-4 gap-4 text-center text-[11px]">
              {["ຜູ້ສ້າງເອກະສານ", "ຫົວໜ້າສາງຕົ້ນທາງ", "ຫົວໜ້າສາງປາຍທາງ", "ຜູ້ຮັບສິນຄ້າ"].map((s) => (
                <div key={s}>{s}</div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-4 gap-4 text-center text-[11px]">
              <div className="font-mono">{h.user_created ?? "....................."}</div>
              <div>.....................</div>
              <div>.....................</div>
              <div>.....................</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
