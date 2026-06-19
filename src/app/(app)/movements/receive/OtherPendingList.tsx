import Link from "next/link";
import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { ArrowLeftRightIcon, BuildingIcon, CalendarIcon, UserIcon } from "@/components/ui/Icons";
import Countdown from "./Countdown";

type SearchParams = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return v?.trim() ?? "";
}
function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

type OtherRow = {
  doc_no: string;
  type: "transfer" | "sales_return" | "issue_return";
  wh_code: string | null;
  wh_name: string | null;
  cust_code: string | null;
  doc_date: string | null;
  lines: number;
  remaining: string;
};

const TYPE_LABEL: Record<OtherRow["type"], string> = {
  transfer: "ໃບໂອນ",
  sales_return: "ຮັບคืนขาย",
  issue_return: "ຮັບคืนเบิก",
};

// Pending transfer (72) + sales/issue returns (48/58) not yet received into WMS.
// Cached 5 min (aggregates ic_trans); scoped per-request in JS.
declare global {
  // eslint-disable-next-line no-var
  var __otherPendingCache: { rows: OtherRow[]; ts: number } | undefined;
}
const TTL_MS = 5 * 60_000;
const LIMIT = 60;

async function getOtherPending(): Promise<OtherRow[]> {
  const hit = globalThis.__otherPendingCache;
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.rows;
  const rows = await query<OtherRow>(
    `WITH src AS (
       SELECT t.doc_no, 'transfer' AS type, t.wh_to AS wh_code, t.cust_code, t.doc_date, d.item_code, abs(d.qty) AS qty
       FROM public.ic_trans t
       JOIN public.ic_trans_detail d ON d.doc_no = t.doc_no AND d.trans_flag = 72
       WHERE t.trans_flag = 72 AND t.doc_date >= CURRENT_DATE - 90 AND abs(d.qty) > 0
       UNION ALL
       SELECT t.doc_no, CASE WHEN d.trans_flag = 48 THEN 'sales_return' ELSE 'issue_return' END,
              d.wh_code, t.cust_code, t.doc_date, d.item_code, abs(d.qty)
       FROM public.ic_trans_detail d
       JOIN public.ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = d.trans_flag
       WHERE d.trans_flag IN (48,58) AND COALESCE(d.calc_flag,0) >= 0
         AND t.doc_date >= CURRENT_DATE - 90 AND abs(d.qty) > 0
     ),
     rcv AS (
       SELECT h.ref_doc_no AS doc_no, SUM(d.qty) AS received
       FROM public.wms_product_receive h
       JOIN public.wms_product_receive_detail d ON d.doc_no = h.doc_no
       WHERE h.ref_doc_no IS NOT NULL AND (h.status = 0 OR h.status IS NULL)
       GROUP BY h.ref_doc_no
     )
     SELECT s.doc_no, s.type, s.wh_code, w.name_1 AS wh_name, s.cust_code,
            to_char(MAX(s.doc_date),'YYYY-MM-DD') AS doc_date,
            count(DISTINCT s.item_code)::int AS lines,
            (SUM(s.qty) - COALESCE(MAX(r.received),0))::text AS remaining
     FROM src s
     LEFT JOIN rcv r ON r.doc_no = s.doc_no
     LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
     GROUP BY s.doc_no, s.type, s.wh_code, w.name_1, s.cust_code
     HAVING (SUM(s.qty) - COALESCE(MAX(r.received),0)) > 0
     ORDER BY MAX(s.doc_date) ASC NULLS LAST`,
  );
  globalThis.__otherPendingCache = { rows, ts: Date.now() };
  return rows;
}

/** ໂອນ / ຮັບคืน ຄ້າງຮັບ — direct receive (no count sheet). */
export default async function OtherPendingList({ session, params }: { session: Session; params: SearchParams }) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return null;
  const allowed = Array.isArray(accessible) ? new Set(accessible) : null;
  const q = pickStr(params.q).toLowerCase();

  const all = await getOtherPending();
  let rows = all.filter((r) => (!allowed || (r.wh_code !== null && allowed.has(r.wh_code))));
  if (q) rows = rows.filter((r) => `${r.doc_no} ${r.cust_code ?? ""}`.toLowerCase().includes(q));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, LIMIT);

  return (
    <section className="space-y-2.5">
      <div className="space-y-3">
        {shown.map((r) => (
          <div key={`${r.type}-${r.doc_no}`} className="shadow-card flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3.5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
              <ArrowLeftRightIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{r.doc_no}</span>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">{TYPE_LABEL[r.type]}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {r.doc_date ? (
                  <span className="inline-flex items-center gap-1 font-bold text-red-600 dark:text-red-400">
                    <CalendarIcon className="h-3 w-3" />{r.doc_date} · <Countdown target={r.doc_date} />
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />—</span>
                )}
                {r.cust_code && <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{r.cust_code}</span>}
                {r.wh_code && <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{r.wh_code}{r.wh_name ? ` · ${r.wh_name}` : ""}</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase text-zinc-400">ຄ້າງຮັບ</div>
              <div className="font-mono text-sm font-bold tabular-nums text-sky-600 dark:text-sky-400">{fmt(r.remaining)}</div>
              <div className="text-[10px] text-zinc-400">{r.lines} ລາຍການ</div>
            </div>
            <Link
              href={`/movements/receive?tab=receive&type=${r.type}${r.wh_code ? `&wh=${encodeURIComponent(r.wh_code)}` : ""}&q=${encodeURIComponent(r.doc_no)}`}
              className="rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
            >
              ໄປຮັບ
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
