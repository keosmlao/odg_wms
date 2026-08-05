import Link from "next/link";
import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { DOC_TYPE, RECEIVE_STATUS } from "@/lib/receive";
import { BuildingIcon, CalendarIcon, CheckIcon, PackageIcon, UserIcon } from "@/components/ui/Icons";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";

type SearchParams = Record<string, string | string[] | undefined>;
function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

type SheetRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  wh_code: string | null;
  wh_name: string | null;
  supplier_code: string | null;
  po_no: string | null;
  po_list: string[] | null;
  pack_no: string | null;
  remark: string | null;
  creator_name: string | null;
  creator_code: string | null;
  line_count: number;
  total_qty: string;
  pallet_positions: string | null;
  sn_count: number;
};

/** ໃບກວດນັບ (draft count sheets, status=9) awaiting WMS receipt. */
export default async function CountSheetList({ session }: { session: Session; params: SearchParams }) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ</div>;
  }
  const scoped = Array.isArray(accessible);

  const sheets = await query<SheetRow>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no,
            COALESCE(pos.po_list, CASE WHEN h.ref_doc_no IS NULL THEN ARRAY[]::text[] ELSE ARRAY[h.ref_doc_no] END) AS po_list,
            r.ref_doc_no AS pack_no, h.remark,
            h.creator_code, e.fullname_lo AS creator_name,
            COALESCE(agg.line_count,0) AS line_count, COALESCE(agg.total_qty,0)::text AS total_qty,
            agg.pallet_positions::text AS pallet_positions, COALESCE(sn.sn_count,0) AS sn_count
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     LEFT JOIN public.wms_product_receive_ref r ON r.doc_no = h.doc_no AND r.line_order = 1
     LEFT JOIN (SELECT doc_no, array_agg(po_no ORDER BY line_order, roworder) AS po_list
                FROM public.wms_product_receive_po GROUP BY doc_no) pos ON pos.doc_no = h.doc_no
     LEFT JOIN (SELECT d.doc_no, count(*)::int AS line_count, SUM(d.qty) AS total_qty,
                       SUM(CASE WHEN ph.pallet>0 THEN ceil(d.qty/ph.pallet) ELSE 0 END)::int AS pallet_positions
                FROM public.wms_product_receive_detail d
                LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
                ${phDimensionLateralJoin("inv")}
                GROUP BY d.doc_no) agg ON agg.doc_no = h.doc_no
     LEFT JOIN (SELECT ref_rec_doc, count(*)::int AS sn_count
                FROM public.wms_product_receive_serial_detail WHERE COALESCE(ignore_sync,0) <> 2 GROUP BY ref_rec_doc) sn ON sn.ref_rec_doc = h.doc_no
     WHERE h.doc_type = $1 AND h.status = $2
       ${scoped ? "AND h.warehouse_code = ANY($3)" : ""}
     ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC`,
    scoped ? [DOC_TYPE.count, RECEIVE_STATUS.draft, accessible] : [DOC_TYPE.count, RECEIVE_STATUS.draft],
  );

  if (sheets.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <CheckIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
        <p className="mt-2 text-sm font-semibold text-zinc-500">ຍັງບໍ່ມີໃບກວດນັບຄ້າງ</p>
        <p className="mt-1 text-xs text-zinc-400">ສ້າງໃບກວດນັບໄດ້ຈາກແທັບ “ລາຍການຄ້າງຮັບ”</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="px-1 text-xs text-zinc-500 dark:text-zinc-400">ໃບກວດນັບຄ້າງ {sheets.length} ໃບ</div>
      {sheets.map((s) => (
        <Link key={s.doc_no} href={`/movements/receive/count/${encodeURIComponent(s.doc_no)}`} className="shadow-card flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3.5 ring-1 ring-zinc-200 transition hover:ring-emerald-400 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-aqua-50 font-mono text-[10px] font-bold text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">
            {(s.wh_code ?? "?").slice(-2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{s.doc_no}</span>
              <span className="rounded-full bg-aqua-100 px-2 py-0.5 text-[10px] font-semibold text-aqua-700 dark:bg-aqua-950/50 dark:text-aqua-300">ກວດນັບ</span>
              {(s.po_list && s.po_list.length > 0 ? s.po_list : s.po_no ? [s.po_no] : []).slice(0, 3).map((po) => (
                <span key={po} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">PO {po}</span>
              ))}
              {s.po_list && s.po_list.length > 3 && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">+{s.po_list.length - 3} PO</span>
              )}
              {s.pack_no && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{s.pack_no}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{s.doc_date ?? "—"}{s.doc_time ? ` ${s.doc_time}` : ""}</span>
              <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{s.creator_name ?? s.creator_code ?? "—"}</span>
              {s.wh_code && <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{s.wh_code}{s.wh_name ? ` · ${s.wh_name}` : ""}</span>}
              {s.pallet_positions && Number.parseFloat(s.pallet_positions) > 0 && <span className="inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-400"><PackageIcon className="h-3 w-3" />ຕ້ອງໃຊ້ ~{fmt(s.pallet_positions)} ພາເລດ</span>}
              {s.sn_count > 0 && <span className="inline-flex items-center gap-1"><PackageIcon className="h-3 w-3" />SN {s.sn_count}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm font-bold tabular-nums text-aqua-600 dark:text-aqua-400">{fmt(s.total_qty)}</div>
            <div className="text-[10px] text-zinc-400">{s.line_count} ລາຍການ</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
