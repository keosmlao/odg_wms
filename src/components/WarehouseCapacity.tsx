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

  return (
    <section className="shadow-card rounded-2xl bg-white p-6 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
            <BuildingIcon className="h-5 w-5" />
          </span>
          ຄວາມຈຸ &amp; ພື້ນທີ່ຈັດເກັບ
        </span>
        {grandPallets > 0 && (
          <span className="rounded-full bg-indigo-50 px-3.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/50 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900/50">
            ສິນຄ້າຄົງເຫຼືອຕ້ອງໃຊ້ ~{nf(grandPallets)} ພາເລດ
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const hasCap = r.total > 0;
          const free = Math.max(0, r.total - r.used);
          const pct = hasCap ? Math.min(100, Math.round((r.used / r.total) * 100)) : 0;
          const bar =
            pct >= 85
              ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
              : pct >= 60
                ? "bg-gradient-to-r from-amber-500 to-orange-500"
                : "bg-gradient-to-r from-emerald-500 to-teal-500";

          return (
            <div
              key={r.wh}
              className={`group flex flex-col justify-between rounded-2xl border p-4.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                hasCap
                  ? "border-zinc-200/60 bg-gradient-to-br from-zinc-50 to-zinc-100/30 hover:from-white hover:to-white hover:ring-1 hover:ring-zinc-200/80 dark:border-zinc-800/60 dark:from-zinc-900/40 dark:to-zinc-900/10 dark:hover:from-zinc-900 dark:hover:to-zinc-900"
                  : "border-dashed border-zinc-200/80 bg-zinc-50/20 text-zinc-400 dark:border-zinc-800/80 dark:bg-zinc-900/5"
              }`}
            >
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                    title={r.nm ?? ""}
                  >
                    <span className="mr-1.5 rounded bg-zinc-200/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-850 dark:text-zinc-300">
                      {r.wh}
                    </span>
                    {r.nm ? ` · ${r.nm}` : ""}
                  </span>
                  {hasCap && (
                    <span className="shrink-0 text-xs font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
                      {pct}%
                    </span>
                  )}
                </div>

                {hasCap ? (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-200/60 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${bar} ${pct >= 85 ? "animate-pulse" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-200/40 pt-2.5 text-center text-[10px] tabular-nums text-zinc-500 dark:border-zinc-800/40 dark:text-zinc-400">
                      <div className="text-left">
                        <span className="block text-[9px] uppercase tracking-wider text-zinc-400">ໃຊ້</span>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{nf(r.used)}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] uppercase tracking-wider text-zinc-400">ເຫຼືອ</span>
                        <span className="text-xs font-bold text-emerald-650 dark:text-emerald-400">{nf(free)}</span>
                      </div>
                      <div className="text-right">
                        <span className="block text-[9px] uppercase tracking-wider text-zinc-400">ທັງໝົດ</span>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{nf(r.total)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-center rounded-xl border border-dashed border-zinc-250 py-5 text-center text-xs text-zinc-400 dark:border-zinc-800">
                    ບໍ່ໄດ້ຕັ້ງຄ່າຕຳແໜ່ງພາເລທ
                  </div>
                )}
              </div>

              {r.palletsNeeded > 0 && (
                <div
                  className="mt-3 flex items-center gap-1.5 rounded-xl bg-indigo-50/50 px-3 py-2 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400 ring-1 ring-indigo-100/30 dark:ring-indigo-900/10"
                  title={
                    r.noPh > 0
                      ? `${r.noPh}/${r.items} SKU ຈັບຄູ່ PH ບໍ່ໄດ້`
                      : undefined
                  }
                >
                  <PackageIcon className="h-3.5 w-3.5 text-indigo-500" />
                  <span>
                    ຕ້ອງການໃຊ້ ~<span className="font-bold">{nf(r.palletsNeeded)}</span> ພາເລດ
                  </span>
                  {r.noPh > 0 && (
                    <span className="ml-auto text-[9px] text-zinc-400 font-normal">
                      * ມີ {r.noPh} SKU ບໍ່ມີ PH
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
