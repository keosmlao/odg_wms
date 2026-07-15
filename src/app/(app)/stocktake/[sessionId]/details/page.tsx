import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import StocktakeLayout from "../../_components/StocktakeLayout";

type SessionInfo = {
  session_id: number;
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  name: string | null;
  status: "open" | "pending_approval" | "closed";
  count_date: string;
};

type DetailRow = {
  line_id: number;
  label_id: number;
  label_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
  counted_at: string;
  counted_employee: string | null;
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default async function DetailsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return <NoticeCard text="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" tone="amber" />;
  }
  const { sessionId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(sid)) notFound();

  const info = (
    await query<SessionInfo>(
      `SELECT s.session_id, s.session_code, s.wh_code,
              w.name_1 AS wh_name,
              s.name, s.status, s.count_date::text
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
       WHERE s.session_id = $1`,
      [sid],
    )
  )[0];
  if (!info) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(info.wh_code)) {
    return <NoticeCard text="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" tone="red" />;
  }

  const rows = await query<DetailRow>(
    `SELECT
       ln.line_id,
       ln.label_id,
       l.label_code,
       ln.item_code,
       ln.item_name,
       ln.unit_code,
       ln.qty::text AS qty,
       ln.note,
       ln.rack_code,
       ln.location_code,
       ln.counted_at::text AS counted_at,
       e.fullname_lo AS counted_employee
     FROM public.wms_stocktake_line ln
     JOIN public.wms_stocktake_label l ON l.label_id = ln.label_id
     LEFT JOIN public.odg_employee   e ON e.employee_id = ln.counted_by
     WHERE ln.session_id = $1
     ORDER BY l.label_code, ln.counted_at, ln.line_id`,
    [sid],
  );

  const groups = new Map<string, DetailRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.label_code) ?? [];
    arr.push(r);
    groups.set(r.label_code, arr);
  }
  const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <StocktakeLayout wide>
    <div className="w-full space-y-6 pb-8">
      <header>
        <Link
          href={`/stocktake/${sid}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← {info.session_code}
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          ລາຍລະອຽດການນັບ
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {info.name ?? info.session_code} · {info.wh_code}
          {info.wh_name ? ` · ${info.wh_name}` : ""} · {rows.length} ລາຍການ ·{" "}
          {orderedGroups.length} ປ້າຍ
        </p>
      </header>

      {orderedGroups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            ຍັງບໍ່ມີລາຍການກວດນັບ
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedGroups.map(([labelCode, items]) => {
            const total = items.reduce(
              (s, r) => s + (Number.parseFloat(r.qty) || 0),
              0,
            );
            const labelId = items[0]?.label_id;
            const first = items[0];
            const hasLocation = first?.rack_code || first?.location_code;
            return (
              <article
                key={labelCode}
                className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold text-zinc-900 dark:text-zinc-50">
                      {labelCode}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {items.length} ລາຍການ
                    </span>
                    {hasLocation && (
                      <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                        📍 {first.rack_code ?? "—"}
                        {first.location_code && ` / ${first.location_code}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatQty(total)}
                    </span>
                    {info.status === "open" && labelId !== undefined && (
                      <Link
                        href={`/stocktake/${sid}/count/${labelId}`}
                        className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        ແກ້ໄຂ
                      </Link>
                    )}
                  </div>
                </header>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {items.map((r) => (
                    <li
                      key={r.line_id}
                      className="grid grid-cols-[1fr_auto] gap-3 px-5 py-2.5 sm:grid-cols-[1fr_140px_80px]"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                          {r.item_code}
                        </div>
                        <div
                          className="truncate text-sm text-zinc-700 dark:text-zinc-300"
                          title={r.item_name ?? ""}
                        >
                          {r.item_name ?? "—"}
                        </div>
                        {r.note && (
                          <div className="mt-0.5 truncate text-xs text-zinc-500">
                            {r.note}
                          </div>
                        )}
                      </div>
                      <div className="hidden text-xs text-zinc-500 sm:block">
                        {r.counted_at?.slice(0, 16) ?? ""}
                        {r.counted_employee && (
                          <div className="truncate">{r.counted_employee}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                          {formatQty(r.qty)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {r.unit_code ?? ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </div>
    </StocktakeLayout>
  );
}

function NoticeCard({
  text,
  tone,
}: {
  text: string;
  tone: "amber" | "red";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
  return (
    <div
      className={`mx-auto mt-12 max-w-md rounded-2xl border p-6 text-center ${cls}`}
    >
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
