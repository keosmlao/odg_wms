import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import PrintLetterhead from "@/components/PrintLetterhead";
import AutoPrint from "../../wms/[doc]/AutoPrint";

/**
 * Printable ໃບຂໍໂອນສິນຄ້າ (transfer-request slip) for an ic_trans trans_flag 124
 * document (format FR). This is the REQUEST itself, before any stock movement —
 * distinct from /print/wms which prints the posted movement doc.
 */
const FLAG = 124;

type Header = {
  doc_no: string; doc_date: string | null; doc_time: string | null; remark: string | null;
  wh_from: string | null; wh_from_name: string | null; wh_to: string | null; wh_to_name: string | null;
  creator_code: string | null; creator_name: string | null;
};
type Line = { item_code: string; item_name: string | null; unit_code: string | null; qty: string };

function whLabel(code: string | null, name: string | null) {
  if (!code) return "—";
  return name ? `${code} ${name}` : code;
}

export default async function PrintTransferRequestPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { doc } = await params;
  const sp = await searchParams;
  const docNo = decodeURIComponent(doc).trim();

  const head = await query<Header>(
    `SELECT h.doc_no, to_char(h.doc_date,'DD/MM/YYYY') AS doc_date, h.doc_time, h.remark,
            h.wh_from, wf.name_1 AS wh_from_name, h.wh_to, wt.name_1 AS wh_to_name,
            h.creator_code, e.fullname_lo AS creator_name
     FROM public.ic_trans h
     LEFT JOIN public.ic_warehouse wf ON wf.code = h.wh_from
     LEFT JOIN public.ic_warehouse wt ON wt.code = h.wh_to
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     WHERE h.doc_no = $1 AND h.trans_flag = ${FLAG} LIMIT 1`,
    [docNo],
  );
  const h = head[0];

  const lines = h ? await query<Line>(
    `SELECT item_code, item_name, unit_code, qty::numeric::text AS qty
     FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = ${FLAG} ORDER BY line_number, item_code`,
    [docNo],
  ) : [];
  const totalQty = lines.reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0);

  return (
    <div className="mx-auto flex max-w-[190mm] flex-col bg-white p-5 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif", minHeight: "100vh" }}>
      <style>{`@media print { .no-print { display:none !important } @page { size: A4; margin: 8mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບເອກະສານ {docNo}</p>
      ) : (
        <div className="flex flex-1 flex-col">
          <PrintLetterhead docNo={h.doc_no} />

          <div className="mb-3 text-center text-base font-bold">ໃບຂໍໂອນສິນຄ້າ</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ຈາກສາງ:</b> {whLabel(h.wh_from, h.wh_from_name)}</div>
            <div><b>ເລກທີ່ເອກະສານ:</b> <span className="font-mono">{h.doc_no}</span></div>
            <div><b>ເຖິງສາງ:</b> {whLabel(h.wh_to, h.wh_to_name)}</div>
            <div><b>ວັນທີ:</b> {h.doc_date} {h.doc_time}</div>
            {h.remark && <div className="col-span-2"><b>ໝາຍເຫດ:</b> {h.remark}</div>}
          </div>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col className="w-[6%]" /><col className="w-[18%]" /><col className="w-[48%]" />
              <col className="w-[13%]" /><col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-1.5 py-1">#</th>
                <th className="border border-slate-300 px-1.5 py-1">ລະຫັດສິນຄ້າ</th>
                <th className="border border-slate-300 px-1.5 py-1">ລາຍການສິນຄ້າ</th>
                <th className="border border-slate-300 px-1.5 py-1">ໜ່ວຍ</th>
                <th className="border border-slate-300 px-1.5 py-1 text-right">ຈຳນວນ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.item_code}>
                  <td className="border border-slate-300 px-1.5 py-1 text-center">{i + 1}</td>
                  {/* wrap, never clip — a printed code ending in "…" is unusable */}
                  <td className="border border-slate-300 px-1.5 py-1 align-top font-mono font-bold" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{l.item_code}</td>
                  <td className="border border-slate-300 px-1.5 py-1 align-top leading-tight" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{l.item_name}</td>
                  <td className="border border-slate-300 px-1.5 py-1">{l.unit_code ?? ""}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right font-mono">{Number.parseFloat(l.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex items-center justify-between text-xs">
            <div><b>ພະນັກງານ:</b> {h.creator_name?.trim() || h.creator_code || "—"}</div>
            <div><b>ຈຳນວນ:</b> <span className="font-bold">{totalQty.toFixed(2)}</span></div>
          </div>

          {/* Pinned to the page bottom: 100vh min-height + this flex-1 wrapper + mt-auto here means
              a short doc leaves blank space above the signatures on page 1, while a doc long enough
              to spill onto page 2+ just has the signatures follow the table on that last page. */}
          <div className="mt-auto grid grid-cols-2 gap-10 pt-10 text-center text-xs" style={{ breakInside: "avoid" }}>
            {["ຜູ້ຂໍໂອນ", "ຜູ້ອະນຸມັດ"].map((s) => (
              <div key={s}>
                <div className="mb-10 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[9px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
