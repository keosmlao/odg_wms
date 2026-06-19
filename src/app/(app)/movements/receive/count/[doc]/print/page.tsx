import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
import PrintButton from "@/components/ui/PrintButton";
import { DOC_TYPE } from "@/lib/receive";

type HeaderRow = {
  doc_no: string; doc_date: string | null; status: number | null;
  wh_code: string | null; wh_name: string | null; supplier_code: string | null;
  po_no: string | null; pack_no: string | null; remark: string | null; creator: string | null;
};
type LineRow = { item_code: string; item_name: string | null; unit_code: string | null; qty: string; foot: string | null; stack: string | null; sn_count: number };

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function areaM2(qty: number, foot: number, stack: number): number {
  if (!(foot > 0) || qty <= 0) return 0;
  return Math.ceil(qty / (stack > 0 ? stack : 1)) * foot;
}

export default async function CountPrintPage({ params }: { params: Promise<{ doc: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;

  const { doc } = await params;
  const docNo = decodeURIComponent(doc).trim();

  const header = (await query<HeaderRow>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.status,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no, r.ref_doc_no AS pack_no, h.remark,
            e.fullname_lo AS creator
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.wms_product_receive_ref r ON r.doc_no = h.doc_no AND r.line_order = 1
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     WHERE h.doc_no = $1 AND h.doc_type = $2`,
    [docNo, DOC_TYPE.count],
  ))[0];
  if (!header) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && (header.wh_code === null || !accessible.includes(header.wh_code))) {
    return <Notice tone="red" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" />;
  }

  const lines = await query<LineRow>(
    `SELECT d.item_code, d.item_name, d.unit_code, d.qty::text AS qty,
            dm.foot::text AS foot, dm.stack::text AS stack,
            COALESCE(sn.n,0)::int AS sn_count
     FROM public.wms_product_receive_detail d
     LEFT JOIN (SELECT DISTINCT ON (ic_code) ic_code, (NULLIF(width,0)::numeric*NULLIF(length,0)::numeric/10000) foot, NULLIF(stack,0)::numeric stack FROM public.odg_wms_product_dimension ORDER BY ic_code, roworder) dm ON dm.ic_code = d.item_code
     LEFT JOIN (SELECT item_code, count(*) n FROM public.wms_product_receive_serial_detail WHERE ref_rec_doc = $1 AND COALESCE(ignore_sync,0) <> 2 GROUP BY item_code) sn ON sn.item_code = d.item_code
     WHERE d.doc_no = $1 ORDER BY d.roworder`,
    [docNo],
  );

  const totalQty = lines.reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0);
  const totalArea = lines.reduce((s, l) => s + areaM2(Number.parseFloat(l.qty) || 0, Number.parseFloat(l.foot ?? "") || 0, Number.parseFloat(l.stack ?? "") || 0), 0);

  return (
    <>
      <style>{`
        @media print {
          aside, header, .no-print { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          /* Fill the A4 content area — the on-screen max-width / card padding
             would otherwise shrink the document and leave it off-centre. */
          .print-wrap { max-width: none !important; width: 100% !important; margin: 0 !important; }
          .print-doc { box-shadow: none !important; border: none !important; border-radius: 0 !important; padding: 0 !important; }
        }
        @page { size: A4; margin: 14mm; }
      `}</style>

      <div className="print-wrap mx-auto w-full max-w-3xl">
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">ພິມໃບກວດນັບ · {header.doc_no}</div>
          <div className="flex gap-2">
            <Link href={`/movements/receive/count/${encodeURIComponent(docNo)}`} className="rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">← ກັບໄປ</Link>
            <PrintButton />
          </div>
        </div>

        <div className="print-doc rounded-2xl bg-white p-8 text-zinc-900 shadow-card ring-1 ring-zinc-200" style={{ color: "#000" }}>
          <div className="flex items-start justify-between border-b-2 border-zinc-800 pb-3">
            <div>
              <h1 className="text-2xl font-bold">ໃບກວດນັບ</h1>
              <div className="mt-0.5 text-sm text-zinc-600">Count Sheet</div>
            </div>
            <div className="text-right text-sm">
              <div className="font-mono text-lg font-bold">{header.doc_no}</div>
              <div className="text-zinc-600">ວັນທີ {header.doc_date ?? "—"}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div><span className="text-zinc-500">ສາງ:</span> <b>{header.wh_code}</b>{header.wh_name ? ` · ${header.wh_name}` : ""}</div>
            <div><span className="text-zinc-500">Packing:</span> {header.pack_no ?? "—"}</div>
            {header.remark && <div className="col-span-2"><span className="text-zinc-500">ໝາຍເຫດ:</span> {header.remark}</div>}
          </div>

          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y-2 border-zinc-800 text-left">
                <th className="py-2 pr-2" style={{ width: "32px" }}>#</th>
                <th className="py-2 pr-2">ສິນຄ້າ</th>
                <th className="py-2 pr-2 text-right">ກວດນັບ</th>
                <th className="py-2 pr-2 text-center">SN</th>
                <th className="py-2 pl-2 text-right">ພື້ນທີ່ m²</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const q = Number.parseFloat(l.qty) || 0;
                const a = areaM2(q, Number.parseFloat(l.foot ?? "") || 0, Number.parseFloat(l.stack ?? "") || 0);
                return (
                  <tr key={l.item_code} className="border-b border-zinc-200 align-top">
                    <td className="py-1.5 pr-2 text-zinc-500">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <div className="font-mono font-semibold">{l.item_code}</div>
                      <div className="text-xs text-zinc-600">{l.item_name ?? "—"}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono font-semibold">{fmt(q)}<span className="ml-1 text-xs text-zinc-500">{l.unit_code}</span></td>
                    <td className="py-1.5 pr-2 text-center font-mono">{l.sn_count > 0 ? l.sn_count : "—"}</td>
                    <td className="py-1.5 pl-2 text-right font-mono">{a > 0 ? `~${a.toFixed(2)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-800 font-bold">
                <td className="py-2 pr-2" colSpan={2}>ລວມ {lines.length} ລາຍການ</td>
                <td className="py-2 pr-2 text-right font-mono">{fmt(totalQty)}</td>
                <td className="py-2 pr-2" />
                <td className="py-2 pl-2 text-right font-mono">~{totalArea.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-1 border-t border-zinc-200 pt-3 text-sm">
            <div><span className="text-zinc-500">ໃບສັ່ງຊື້:</span> <b>{header.po_no ?? "—"}</b></div>
            <div><span className="text-zinc-500">ຜູ້ສ້າງ:</span> {header.creator ?? "—"}</div>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-6 text-center text-sm">
            {["ຜູ້ກວດນັບ", "ຜູ້ກວດສອບ", "ຜູ້ອະນຸມັດ"].map((role) => (
              <div key={role}>
                <div className="border-t border-zinc-400 pt-1 text-zinc-600">{role}</div>
                <div className="mt-1 text-xs text-zinc-400">ວັນທີ ........./........./.........</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
