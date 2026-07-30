import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { MOVE_REASONS } from "@/lib/moveReasons";
import { IN_TRANSIT_WH } from "@/lib/erpPost";
import PrintLetterhead from "@/components/PrintLetterhead";
import { fitCell } from "@/lib/printFit";
import AutoPrint from "./AutoPrint";

const REASON_LABEL = Object.fromEntries(MOVE_REASONS.map((r) => [r.code, r.label]));

/**
 * Standalone printable slip for any WMS movement (DP doc): goods-issue pick slip,
 * transfer-out / transfer-receive slip, or return slip. Lives outside the (app)
 * layout so it prints without chrome.
 *
 * One row per PHYSICAL UNIT (SN + ISN) with the bin it moved at — this is the
 * copy the warehouse signs, so it has to be checkable unit by unit. The
 * destination doc number lives in the header, not repeated down a column.
 *
 * For the same movement WITHOUT any bin detail — the copy that travels with the
 * goods — see ./bill (ໃບບິນໂອນສິນຄ້າ).
 */
type Header = {
  doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null;
  wh_code: string | null; wh_name: string | null; user_created: string | null; user_name: string | null;
};
type Row = {
  item_code: string; item_name: string | null; unit_code: string | null; qty: string;
  from_wh: string | null; from_wh_name: string | null; from_loc: string | null;
  to_wh: string | null; to_wh_name: string | null; to_loc: string | null;
};

/** Blank rows padded onto the table so the printed form keeps a constant shape. */
const MIN_FORM_ROWS = 22;

function whLabel(code: string | null, name: string | null) {
  if (!code) return "—";
  return name ? `${code} · ${name}` : code;
}

export default async function PrintWmsDocPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
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

  // Group the +/- detail legs per item → from (−1) / to (+1). Grouping by item
  // also collapses an item that was picked from several bins into one line.
  const rows = h ? await query<Row>(
    `SELECT d.item_code,
            MAX(d.item_name) AS item_name,
            MAX(d.unit_code) AS unit_code,
            COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = -1), SUM(d.qty) FILTER (WHERE d.calc_flag = 1))::numeric::text AS qty,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = -1) AS from_wh,
            MAX(wf.name_1) FILTER (WHERE d.calc_flag = -1) AS from_wh_name,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = -1) AS from_loc,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = 1) AS to_wh,
            MAX(wt.name_1) FILTER (WHERE d.calc_flag = 1) AS to_wh_name,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = 1) AS to_loc
     FROM public.odg_wms_trans_detail d
     LEFT JOIN public.ic_warehouse wf ON wf.code = d.wh_code AND d.calc_flag = -1
     LEFT JOIN public.ic_warehouse wt ON wt.code = d.wh_code AND d.calc_flag = 1
     WHERE d.doc_no = $1
     GROUP BY d.item_code ORDER BY d.item_code`,
    [docNo],
  ) : [];

  // One row per physical unit — sn_trans_detail carries the exact rack/location/
  // pallet it moved at (source node for an issue-out leg, landing node for a
  // receive), so we can show "ຈ່າຍອອກ/ຮັບເຂົ້າ ທີ່ຈຸດໃດ" per serial, not just per item.
  const units = h ? await query<{ item_code: string; sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null }>(
    `SELECT item_code, NULLIF(TRIM(sn), '') AS sn, NULLIF(TRIM(isn), '') AS isn,
            NULLIF(TRIM(rack), '') AS rack, NULLIF(TRIM(location), '') AS location, NULLIF(TRIM(pallet), '') AS pallet
     FROM public.sn_trans_detail WHERE doc_no = $1 ORDER BY item_code, COALESCE(isn, sn)`,
    [docNo],
  ) : [];
  const unitsByItem = new Map<string, typeof units>();
  for (const u of units) {
    const a = unitsByItem.get(u.item_code) ?? []; a.push(u); unitsByItem.set(u.item_code, a);
  }
  function unitLoc(u: { rack: string | null; location: string | null; pallet: string | null }): string {
    return [u.rack, u.location, u.pallet].filter(Boolean).join(" / ") || "—";
  }

  // Short-movement reasons (table may not exist yet → degrade silently).
  let notes: { item_code: string; reason_code: string | null; short_qty: string | null }[] = [];
  if (h) {
    try {
      notes = await query<{ item_code: string; reason_code: string | null; short_qty: string | null }>(
        `SELECT item_code, reason_code, short_qty::numeric::text AS short_qty FROM public.odg_wms_move_note WHERE doc_no = $1 ORDER BY item_code`,
        [docNo],
      );
    } catch { notes = []; }
  }

  const isRelocation = rows.some((r) => r.to_wh);
  const title = !h ? "ບໍ່ພົບເອກະສານ" : isRelocation ? "ໃບໂອນ / ຮັບໂອນ ສິນຄ້າ (WMS)" : "ໃບຈ່າຍສິນຄ້າ (WMS Pick Slip)";
  // A receive doc's −1 leg sits AT 9903 (goods leaving in-transit) — so its
  // sn_trans_detail units carry the DESTINATION landing node, not a source one.
  // An issue-out / transfer-out doc's units carry the real SOURCE node.
  const isReceiveDoc = rows.some((r) => r.from_wh === IN_TRANSIT_WH);
  const binHeader = isReceiveDoc ? "ຮັບເຂົ້າທີ່" : "ຈ່າຍອອກຈາກ";

  // Doc-level from → to for the header block. The transfer-out leg lands in the
  // in-transit warehouse tagged with the request doc, so resolve that request's
  // real destination and name it instead of printing "9903" on its own.
  const fromWh = rows.find((r) => r.from_wh)?.from_wh ?? h?.wh_code ?? null;
  const fromWhName = rows.find((r) => r.from_wh)?.from_wh_name ?? h?.wh_name ?? null;
  const toWh = rows.find((r) => r.to_wh)?.to_wh ?? null;
  const toWhName = rows.find((r) => r.to_wh)?.to_wh_name ?? null;
  let finalDest: string | null = null;
  if (h?.doc_ref && (toWh === IN_TRANSIT_WH || fromWh === IN_TRANSIT_WH)) {
    const dest = await query<{ wh_to: string | null; wh_to_name: string | null }>(
      `SELECT h.wh_to, w.name_1 AS wh_to_name
       FROM public.ic_trans h LEFT JOIN public.ic_warehouse w ON w.code = h.wh_to
       WHERE h.doc_no = $1 AND h.trans_flag = 124 LIMIT 1`,
      [h.doc_ref],
    );
    if (dest[0]?.wh_to) finalDest = whLabel(dest[0].wh_to, dest[0].wh_to_name);
  }

  type PrintRow = {
    key: string; item_code: string; item_name: string | null; unit_code: string | null;
    sn: string | null; isn: string | null; bin: string; qty: number;
  };
  const printRows: PrintRow[] = [];
  for (const r of rows) {
    const us = unitsByItem.get(r.item_code) ?? [];
    if (us.length > 0) {
      for (const u of us) {
        printRows.push({
          key: `${r.item_code}-${u.sn ?? u.isn ?? printRows.length}`,
          item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
          sn: u.sn, isn: u.isn,
          // sn_trans_detail already holds the node that matters for this doc
          // kind — the source bin on an issue-out, the landing bin on a receive.
          bin: unitLoc(u),
          qty: 1,
        });
      }
    } else {
      // No serials on this item — one summed line at its bin.
      printRows.push({
        key: r.item_code, item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
        sn: null, isn: null,
        bin: (isReceiveDoc ? r.to_loc : r.from_loc) ?? "—",
        qty: Number.parseFloat(r.qty || "0"),
      });
    }
  }
  const totalQty = printRows.reduce((s, r) => s + r.qty, 0);
  const filler = Math.max(0, MIN_FORM_ROWS - printRows.length);

  // Printed cells must never clip: a client checking a serial against the goods
  // in front of them cannot verify "1B0045Z0104JB84…". So no `truncate` anywhere
  // — anything too long wraps inside its cell instead.
  const cell = "border border-slate-400 px-1 py-[3px] align-top";
  // 8.5px keeps the longest SN in the system (31 chars) on a single line at the
  // column width below; anything longer still wraps rather than being cut.
  const idCell = { overflowWrap: "anywhere", wordBreak: "break-word", fontSize: "8.5px", lineHeight: 1.3 } as const;
  const textCell = { overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.3 } as const;
  // Usable inner width of the ຊື່ column: 26% of the table (≈678px) less padding.
  // This slip carries SN + ISN + bin as well, so the name gets far less room than
  // on the bill — most names shrink, the longest still wrap.
  const NAME_COL_PX = Math.round(678 * 0.26) - 8;

  return (
    <div className="mx-auto flex max-w-[190mm] flex-col bg-white p-5 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif", minHeight: "100vh" }}>
      <style>{`@media print { .no-print { display:none !important } @page { size: A4; margin: 8mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບເອກະສານ {docNo}</p>
      ) : (
        <div className="flex flex-1 flex-col">
          <PrintLetterhead docNo={h.doc_no} />

          <div className="mb-3 text-center text-base font-bold">{title}</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ຈາກສາງ:</b> {whLabel(fromWh, fromWhName)}</div>
            <div><b>ເລກທີ່ເອກະສານ:</b> <span className="font-mono">{h.doc_no}</span></div>
            <div><b>ເຖິງສາງ:</b> {isRelocation ? whLabel(toWh, toWhName) : "—"}</div>
            <div><b>ວັນທີ:</b> {h.doc_date} {h.doc_time}</div>
            {finalDest && <div><b>ປາຍທາງ:</b> {finalDest}</div>}
            <div><b>ອ້າງອີງ (ໄປເລກທີ):</b> <span className="font-mono">{h.doc_ref ?? "—"}</span></div>
          </div>

          <table className="w-full table-fixed border-collapse text-[10px]">
            <colgroup>
              {/* Sized from the real data: SN runs to 31 chars, the bin label to
                  21, while ISN and the item code are a fixed 11 — so the width
                  goes where it is actually needed. */}
              <col className="w-[26%]" /><col className="w-[10%]" /><col className="w-[10%]" />
              <col className="w-[26%]" /><col className="w-[18%]" /><col className="w-[5%]" /><col className="w-[5%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left text-[9px]">
                <th className={cell}>SN</th>
                <th className={cell}>Internal SN</th>
                <th className={cell}>ລະຫັດສິນຄ້າ</th>
                <th className={cell}>ຊື່</th>
                <th className={cell}>{binHeader}</th>
                <th className={`${cell} text-right`}>ຈຳນວນ</th>
                <th className={cell}>ຫົວໜ່ວຍ</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((r) => (
                <tr key={r.key}>
                  <td className={`${cell} font-mono`} style={idCell}>{r.sn ?? ""}</td>
                  <td className={`${cell} font-mono`} style={idCell}>{r.isn ?? ""}</td>
                  <td className={`${cell} font-mono font-bold`} style={idCell}>{r.item_code}</td>
                  <td className={cell} style={fitCell(r.item_name, NAME_COL_PX, 10)}>{r.item_name}</td>
                  <td className={`${cell} font-mono`} style={idCell}>{r.bin}</td>
                  <td className={`${cell} text-right font-mono`}>{r.qty}</td>
                  <td className={cell} style={textCell}>{r.unit_code ?? ""}</td>
                </tr>
              ))}
              {/* Blank ruled rows — the signed paper form always looks the same
                  height whether it carries 1 unit or 20. */}
              {Array.from({ length: filler }, (_, i) => (
                <tr key={`blank-${i}`}>
                  {Array.from({ length: 7 }, (_, c) => <td key={c} className={cell}>&nbsp;</td>)}
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className={cell} colSpan={5}>ລວມ</td>
                <td className={`${cell} text-right font-mono`}>{totalQty}</td>
                <td className={cell}>{printRows[0]?.unit_code ?? ""}</td>
              </tr>
            </tbody>
          </table>

          {notes.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
              <div className="mb-1 font-bold text-amber-800">ໝາຍເຫດ — ຮັບ/ຈ່າຍ ບໍ່ຄົບ</div>
              <ul className="list-disc pl-5">
                {notes.map((n, i) => (
                  <li key={i}><span className="font-mono">{n.item_code}</span> — {REASON_LABEL[n.reason_code ?? ""] ?? n.reason_code}{n.short_qty ? ` (ຂາດ ${Number.parseFloat(n.short_qty)})` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Signatures pinned to the page bottom (see the transfer-request slip
              for the same 100vh + flex-1 + mt-auto trick). */}
          <div className="mt-auto pt-8" style={{ breakInside: "avoid" }}>
            <div className="grid grid-cols-4 gap-4 text-center text-[11px]">
              {["ລູກຄ້າ/ຜູ້ຮັບ", "ຮັບເຄື່ອງ", "ຜູ້ກວດສອບ/ນາຍສາງ", "ຜູ້ຈ່າຍເຄື່ອງ"].map((s) => (
                <div key={s} className="underline underline-offset-2">{s}</div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-4 gap-4 text-center text-[11px]">
              <div>.....................</div>
              <div>.....................</div>
              <div>.....................</div>
              {/* The operator's employee code, pre-filled like the paper form. */}
              <div className="font-mono">{h.user_created ?? "....................."}</div>
            </div>
            {h.user_name && <div className="mt-1 text-right text-[9px] text-slate-500">{h.user_name}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
