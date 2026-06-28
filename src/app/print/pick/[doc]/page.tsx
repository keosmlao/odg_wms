import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import AutoPrint from "../../wms/[doc]/AutoPrint";

/**
 * Forklift PICK slip for a pending issue draft (wms_product_out). Tells the picker
 * WHERE to collect each item, how many, and which serials to grab — ordered by
 * location for one walk. No stock movement; the issue is finalized later at confirm.
 */
const SRC_LABEL: Record<number, string> = { 122: "ໃບຂໍເບີກ", 124: "ໃບຂໍໂອນ", 44: "ບິນຂາຍ" };

function parseNode(shelf: string | null): string {
  const [rack = "", location = "", pallet = ""] = (shelf ?? "").split("|");
  return [rack, location, pallet].filter(Boolean).join(" / ") || "(ສາງ)";
}

export default async function PrintPickPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { doc } = await params;
  const sp = await searchParams;
  const docNo = decodeURIComponent(doc).trim();

  const head = await query<{ doc_no: string; warehouse_code: string | null; ref_doc_no: string | null; doc_type: number | null; wh_name: string | null; remark: string | null }>(
    `SELECT o.doc_no, o.warehouse_code, o.ref_doc_no, o.doc_type, w.name_1 AS wh_name, o.remark
     FROM public.wms_product_out o
     LEFT JOIN public.ic_warehouse w ON w.code = o.warehouse_code
     WHERE o.doc_no = $1 LIMIT 1`,
    [docNo],
  );
  const h = head[0];

  const rows = h ? await query<{ item_code: string; item_name: string | null; unit_code: string | null; qty: string; shelf_code: string | null }>(
    `SELECT item_code, item_name, unit_code, qty::numeric::text AS qty, shelf_code
     FROM public.wms_product_out_detail WHERE doc_no = $1 ORDER BY shelf_code, item_code`,
    [docNo],
  ) : [];

  const serials = h ? await query<{ item_code: string; serial_number: string }>(
    `SELECT item_code, serial_number FROM public.wms_product_out_serial_detail WHERE ref_out_doc = $1 ORDER BY serial_number`,
    [docNo],
  ) : [];
  const snByItem = new Map<string, string[]>();
  for (const s of serials) { const a = snByItem.get(s.item_code) ?? []; a.push(s.serial_number); snByItem.set(s.item_code, a); }

  // Walk order: sort by location label.
  const walk = rows.map((r) => ({ ...r, loc: parseNode(r.shelf_code) })).sort((a, b) => a.loc.localeCompare(b.loc));

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif" }}>
      <style>{`@media print { .no-print { display:none !important } @page { margin: 14mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບໃບ pick {docNo}</p>
      ) : (
        <>
          <div className="mb-1 text-center text-lg font-black">ODIEN GROUP</div>
          <div className="mb-4 text-center text-base font-bold">ໃບ PICK ສິນຄ້າ (ສຳລັບ forklift)</div>

          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><b>ເລກທີ່ pick:</b> <span className="font-mono">{h.doc_no}</span></div>
            <div><b>ສາງ:</b> {h.warehouse_code} {h.wh_name ?? ""}</div>
            <div><b>ອ້າງອີງ:</b> {SRC_LABEL[h.doc_type ?? 0] ?? ""} {h.ref_doc_no ?? "—"}</div>
            <div><b>ຜູ້ສ້າງ:</b> {session.nickname?.trim() || session.employee_code || "—"}</div>
            {h.remark && <div className="col-span-2"><b>🚜 ມອບໝາຍ ຜູ້ເກັບ:</b> {h.remark}</div>}
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-2 py-1 w-8">#</th>
                <th className="border border-slate-300 px-2 py-1">ບ່ອນเก็บ (walk order)</th>
                <th className="border border-slate-300 px-2 py-1">ສິນຄ້າ</th>
                <th className="border border-slate-300 px-2 py-1 text-right w-24">ຈຳນວນ</th>
                <th className="border border-slate-300 px-2 py-1 w-10 text-center">✓</th>
              </tr>
            </thead>
            <tbody>
              {walk.map((r, i) => {
                const sns = snByItem.get(r.item_code) ?? [];
                return (
                  <tr key={`${r.item_code}-${i}`} className="align-top">
                    <td className="border border-slate-300 px-2 py-1.5 text-center">{i + 1}</td>
                    <td className="border border-slate-300 px-2 py-1.5 font-mono font-bold">{r.loc}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      <div className="font-mono text-xs font-bold">{r.item_code}</div>
                      <div>{r.item_name}</div>
                      {sns.length > 0 && <div className="mt-0.5 text-[10px] text-slate-500">SN: {sns.join(", ")}</div>}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-base font-bold">{Number.parseFloat(r.qty || "0")} {r.unit_code ?? ""}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-lg">☐</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-12 grid grid-cols-2 gap-6 text-center text-sm">
            {["ຜູ້ເກັບ (forklift)", "ຜູ້ກວດສອບ"].map((s) => (
              <div key={s}>
                <div className="mb-10 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[10px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
          <p className="no-print mt-6 text-center text-xs text-slate-400">* ໃບนี้ໃຫ້ forklift ໄປເກັບກ່ອນ — ກັບมาຢືນຢັນ "② จ่าย" เพื่อตัด stock จริง</p>
        </>
      )}
    </div>
  );
}
