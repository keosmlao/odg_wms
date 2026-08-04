import Link from "next/link";
import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { PACKING_STATUS } from "@/lib/packingList";
import { AlertIcon, BuildingIcon, CalendarIcon, CheckIcon, UserIcon } from "@/components/ui/Icons";
import PackingImport, { type WarehouseOption } from "./PackingImport";

type SearchParams = Record<string, string | string[] | undefined>;

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  wh_code: string;
  wh_name: string | null;
  ref_no: string | null;
  supplier_name: string | null;
  status: number;
  line_count: number;
  total_qty: string;
  error_count: number;
  warn_count: number;
  count_doc_no: string | null;
  creator_name: string | null;
  po_list: string[] | null;
  file_count: number;
};

function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

const STATUS_LABEL: Record<number, { text: string; cls: string }> = {
  [PACKING_STATUS.draft]: { text: "ນຳເຂົ້າແລ້ວ", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  [PACKING_STATUS.verified]: { text: "ກວດສອບຜ່ານ", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  [PACKING_STATUS.used]: { text: "ສ້າງໃບກວດນັບແລ້ວ", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" },
  [PACKING_STATUS.cancelled]: { text: "ຍົກເລີກ", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
};

/** ຂັ້ນ ① — ໃບ packing: ນຳເຂົ້າ Excel/PDF ແລ້ວກວດສອບ ສິນຄ້າ · PO · ການອະນຸມັດ. */
export default async function PackingListTab({ session, params }: { session: Session; params: SearchParams }) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ</div>;
  }
  const scoped = Array.isArray(accessible);
  const showAll = (Array.isArray(params.all) ? params.all[0] : params.all) === "1";

  const warehouses = scoped
    ? await query<WarehouseOption>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`, [accessible])
    : await query<WarehouseOption>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`);

  const statusFilter = showAll
    ? [PACKING_STATUS.draft, PACKING_STATUS.verified, PACKING_STATUS.used, PACKING_STATUS.cancelled]
    : [PACKING_STATUS.draft, PACKING_STATUS.verified];

  const docs = await query<DocRow>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.wh_code, w.name_1 AS wh_name,
            h.ref_no, h.supplier_name, h.status, h.line_count, h.total_qty::text AS total_qty,
            h.error_count, h.warn_count, h.count_doc_no, e.fullname_lo AS creator_name,
            COALESCE(po.po_list, ARRAY[]::text[]) AS po_list,
            COALESCE(f.file_count, 0) AS file_count
       FROM public.wms_packing_list h
       LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
       LEFT JOIN (SELECT doc_no, array_agg(DISTINCT po_no) AS po_list
                    FROM public.wms_packing_list_detail WHERE po_no IS NOT NULL GROUP BY doc_no) po
              ON po.doc_no = h.doc_no
       LEFT JOIN (SELECT doc_no, count(*)::int AS file_count FROM public.wms_packing_list_file GROUP BY doc_no) f
              ON f.doc_no = h.doc_no
      WHERE h.status = ANY($1) ${scoped ? "AND h.wh_code = ANY($2)" : ""}
      ORDER BY h.doc_date DESC, h.doc_no DESC
      LIMIT 100`,
    scoped ? [statusFilter, accessible] : [statusFilter],
  );

  return (
    <div className="space-y-5">
      <PackingImport warehouses={warehouses} defaultWh={warehouses[0]?.code ?? ""} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ໃບ packing ({docs.length})</h2>
        <Link
          href={showAll ? "/movements/receive?tab=packing" : "/movements/receive?tab=packing&all=1"}
          className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {showAll ? "ສະແດງສະເພາະທີ່ຍັງໃຊ້ໄດ້" : "ສະແດງທັງໝົດ"}
        </Link>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400 dark:border-zinc-800">
          ຍັງບໍ່ມີໃບ packing — ນຳເຂົ້າໄຟລ໌ດ້ານເທິງເພື່ອເລີ່ມ
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const st = STATUS_LABEL[d.status] ?? STATUS_LABEL[PACKING_STATUS.draft];
            return (
              <Link
                key={d.doc_no}
                href={`/movements/receive/packing/${encodeURIComponent(d.doc_no)}`}
                className="shadow-card block rounded-2xl bg-white px-5 py-4 ring-1 ring-zinc-200 transition hover:ring-emerald-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-emerald-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">{d.doc_no}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.text}</span>
                  {d.error_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      <AlertIcon className="h-3 w-3" />ບລັອກ {d.error_count}
                    </span>
                  )}
                  {d.warn_count > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">ເຕືອນ {d.warn_count}</span>
                  )}
                  {d.count_doc_no && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                      <CheckIcon className="h-3 w-3" />{d.count_doc_no}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                    {d.line_count} ລາຍການ · {fmt(d.total_qty)}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3.5 w-3.5" />{d.doc_date ?? "—"}</span>
                  <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3.5 w-3.5" />{d.wh_code}{d.wh_name ? ` · ${d.wh_name}` : ""}</span>
                  {d.ref_no && <span>ໃບ: {d.ref_no}</span>}
                  {d.supplier_name && <span className="truncate">{d.supplier_name}</span>}
                  {d.creator_name && <span className="inline-flex items-center gap-1"><UserIcon className="h-3.5 w-3.5" />{d.creator_name}</span>}
                  {d.file_count > 0 && <span>📎 {d.file_count}</span>}
                </div>

                {(d.po_list ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(d.po_list ?? []).slice(0, 8).map((p) => (
                      <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{p}</span>
                    ))}
                    {(d.po_list ?? []).length > 8 && <span className="text-[10px] text-zinc-400">+{(d.po_list ?? []).length - 8}</span>}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
