import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { BuildingIcon, PackageIcon } from "@/components/ui/Icons";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";

type PalletRow = { wh: string; nm: string | null; total: number; used: number };
type NeedRow = {
  wh: string;
  nm: string | null;
  palletsNeeded: number;
  noPh: number;
  items: number;
};
type Row = PalletRow & { palletsNeeded: number; noPh: number; items: number };

// Warehouse storage overview: configured pallet positions versus the positions
// required by current stock, using the canonical PH units-per-pallet matcher.
declare global {
  // eslint-disable-next-line no-var
  var __whCapacityCacheV4:
    | { pallets: PalletRow[]; needs: NeedRow[]; ts: number }
    | undefined;
}
const TTL_MS = 5 * 60_000;

async function getData(): Promise<{ pallets: PalletRow[]; needs: NeedRow[] }> {
  const hit = globalThis.__whCapacityCacheV4;
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;
  const [pallets, needRaw] = await Promise.all([
    query<PalletRow>(
      `WITH cap AS (
         SELECT wh_code, count(*)::int total FROM public.odg_wms_pallet GROUP BY wh_code
       ),
       used AS (
         SELECT wh_code, count(*)::int used FROM (
           SELECT wh_code, pallet FROM public.odg_wms_trans_detail
           WHERE COALESCE(pallet,'') <> ''
           GROUP BY wh_code, pallet HAVING SUM(qty * COALESCE(calc_flag,1)) > 0
         ) s GROUP BY wh_code
       )
       SELECT w.code AS wh, w.name_1 AS nm, cap.total, COALESCE(used.used,0) AS used
       FROM public.ic_warehouse w
       JOIN cap ON cap.wh_code = w.code
       LEFT JOIN used ON used.wh_code = w.code
       ORDER BY w.code`,
    ),
    query<{
      wh: string;
      nm: string | null;
      pallets_needed: string;
      no_ph: number;
      items: number;
    }>(
      `WITH bal AS (
         SELECT wh_code, item_code, SUM(qty * COALESCE(calc_flag,1)) bal
         FROM public.odg_wms_trans_detail
         GROUP BY wh_code, item_code HAVING SUM(qty * COALESCE(calc_flag,1)) > 0
       )
       SELECT b.wh_code AS wh,
              max(w.name_1) AS nm,
              round(SUM(CASE WHEN ph.pallet > 0 THEN b.bal / ph.pallet ELSE 0 END)::numeric, 1)::numeric AS pallets_needed,
              count(*) FILTER (WHERE ph.pallet IS NULL)::int AS no_ph,
              count(*)::int AS items
       FROM bal b
       LEFT JOIN public.ic_inventory inv ON inv.code = b.item_code
       ${phDimensionLateralJoin("inv")}
       LEFT JOIN public.ic_warehouse w ON w.code = b.wh_code
       GROUP BY b.wh_code`,
    ),
  ]);
  const needs: NeedRow[] = needRaw.map((row) => ({
    wh: row.wh,
    nm: row.nm,
    palletsNeeded: Number.parseFloat(row.pallets_needed) || 0,
    noPh: row.no_ph,
    items: row.items,
  }));
  globalThis.__whCapacityCacheV4 = { pallets, needs, ts: Date.now() };
  return { pallets, needs };
}

export default async function WarehouseCapacity({ session }: { session: Session }) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return null;
  const allowed = Array.isArray(accessible) ? new Set(accessible) : null;
  const inScope = (wh: string) => !allowed || allowed.has(wh);

  const { pallets, needs } = await getData();

  // Show warehouses the user is responsible for that have pallet capacity OR stock.
  const byWh = new Map<string, Row>();
  for (const r of pallets) {
    if (!inScope(r.wh)) continue;
    byWh.set(r.wh, {
      ...r,
      palletsNeeded: 0,
      noPh: 0,
      items: 0,
    });
  }
  for (const need of needs) {
    if (!inScope(need.wh)) continue;
    const row = byWh.get(need.wh) ?? {
      wh: need.wh,
      nm: need.nm,
      total: 0,
      used: 0,
      palletsNeeded: 0,
      noPh: 0,
      items: 0,
    };
    row.nm = row.nm ?? need.nm;
    row.palletsNeeded = need.palletsNeeded;
    row.noPh = need.noPh;
    row.items = need.items;
    byWh.set(need.wh, row);
  }
  const rows = [...byWh.values()].sort((a, b) => a.wh.localeCompare(b.wh));
  if (rows.length === 0) return null;

  const grandPallets = rows.reduce((s, r) => s + r.palletsNeeded, 0);
  const nf = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  // Aggregate across warehouses that have configured capacity.
  const sumTotal = rows.reduce((s, r) => s + r.total, 0);
  const sumUsed = rows.reduce((s, r) => s + r.used, 0);
  const overallPct =
    sumTotal > 0 ? Math.min(100, Math.round((sumUsed / sumTotal) * 100)) : 0;

  const barFor = (pct: number) =>
    pct >= 85
      ? "bg-gradient-to-r from-rose-500 to-red-600"
      : pct >= 60
        ? "bg-gradient-to-r from-amber-500 to-orange-500"
        : "bg-gradient-to-r from-emerald-500 to-teal-500";

  return (
    <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 pt-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
          <BuildingIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            ຄວາມຈຸ &amp; ພື້ນທີ່ຈັດເກັບ
          </h2>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            ຕຳແໜ່ງພາເລດໃນແຕ່ລະສາງ
          </p>
        </div>
      </div>

      {/* Overall summary */}
      {sumTotal > 0 && (
        <div className="mx-5 mt-4 rounded-xl bg-gradient-to-br from-brand-50/80 to-aqua-50/50 p-3.5 ring-1 ring-brand-100/50 dark:from-brand-950/30 dark:to-aqua-950/20 dark:ring-brand-900/40">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
              ລວມທຸກສາງ
            </span>
            <span className="font-mono text-lg font-bold tabular-nums text-brand-900 dark:text-brand-200">
              {overallPct}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-zinc-800/70">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barFor(overallPct)}`}
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums text-zinc-600 dark:text-zinc-400">
            <span>
              ໃຊ້ <span className="font-bold text-zinc-800 dark:text-zinc-200">{nf(sumUsed)}</span>
            </span>
            <span>
              ວ່າງ <span className="font-bold text-emerald-600 dark:text-emerald-400">{nf(Math.max(0, sumTotal - sumUsed))}</span>
            </span>
            <span>
              ທັງໝົດ <span className="font-bold text-zinc-800 dark:text-zinc-200">{nf(sumTotal)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Warehouse rows */}
      <div className="space-y-2.5 p-5">
        {rows.map((r) => {
          const hasCap = r.total > 0;
          const free = Math.max(0, r.total - r.used);
          const pct = hasCap ? Math.min(100, Math.round((r.used / r.total) * 100)) : 0;

          if (!hasCap) {
            return (
              <div
                key={r.wh}
                className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-200/80 px-3 py-2.5 text-zinc-400 dark:border-zinc-800/80"
              >
                <span className="rounded bg-zinc-200/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {r.wh}
                </span>
                <span className="truncate text-[11px]" title={r.nm ?? ""}>
                  {r.nm ?? ""}
                </span>
                <span className="ml-auto shrink-0 text-[10px]">
                  ບໍ່ໄດ້ຕັ້ງຄ່າ
                </span>
              </div>
            );
          }

          return (
            <div
              key={r.wh}
              className="group rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-3 transition-all duration-200 hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-zinc-200/80 dark:border-zinc-800/60 dark:bg-zinc-800/20 dark:hover:bg-zinc-900 dark:hover:ring-zinc-800"
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-zinc-200/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.wh}
                </span>
                <span
                  className="min-w-0 truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
                  title={r.nm ?? ""}
                >
                  {r.nm ?? ""}
                </span>
                <span
                  className={`ml-auto shrink-0 font-mono text-xs font-bold tabular-nums ${
                    pct >= 85
                      ? "text-red-600 dark:text-red-400"
                      : pct >= 60
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {pct}%
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200/60 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barFor(pct)} ${pct >= 85 ? "animate-pulse" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                <span>
                  ໃຊ້ <span className="font-semibold text-zinc-700 dark:text-zinc-300">{nf(r.used)}</span>
                </span>
                <span>
                  ວ່າງ <span className="font-semibold text-emerald-600 dark:text-emerald-400">{nf(free)}</span>
                </span>
                <span>
                  ທັງໝົດ <span className="font-semibold text-zinc-700 dark:text-zinc-300">{nf(r.total)}</span>
                </span>
              </div>

              {r.palletsNeeded > 0 && (
                <div
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-50/60 px-2.5 py-1.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100/40 dark:bg-brand-950/20 dark:text-brand-400 dark:ring-brand-900/20"
                  title={
                    r.noPh > 0
                      ? `${r.noPh}/${r.items} SKU ຈັບຄູ່ PH ບໍ່ໄດ້`
                      : undefined
                  }
                >
                  <PackageIcon className="h-3 w-3 text-brand-500" />
                  <span>
                    ຕ້ອງການ ~<span className="font-bold">{nf(r.palletsNeeded)}</span> ພາເລດ
                  </span>
                  {r.noPh > 0 && (
                    <span className="ml-auto text-[9px] font-normal text-zinc-400">
                      *{r.noPh} SKU ບໍ່ມີ PH
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: total pallets needed */}
      {grandPallets > 0 && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 text-center text-[10px] font-semibold text-brand-700 dark:border-zinc-800/60 dark:bg-zinc-800/20 dark:text-brand-400">
          ສິນຄ້າຄົງເຫຼືອຕ້ອງໃຊ້ ~{nf(grandPallets)} ພາເລດ
        </div>
      )}
    </section>
  );
}
