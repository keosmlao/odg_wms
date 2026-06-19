import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { BuildingIcon, PackageIcon } from "@/components/ui/Icons";

type PalletRow = { wh: string; nm: string | null; total: number; used: number };
type AreaRow = { wh: string; nm: string | null; m2: number; palletsNeeded: number; noDim: number; items: number };
type Row = { wh: string; nm: string | null; total: number; used: number; m2: number; palletsNeeded: number; noDim: number; items: number };

// Warehouse storage overview: pallet positions (capacity vs occupied) + the
// floor area (m²) and pallets the on-hand stock needs, estimated from item
// dimensions. Cached 5 min — the area query aggregates a large movement table.
declare global {
  // eslint-disable-next-line no-var
  var __whCapacityCacheV2: { pallets: PalletRow[]; areas: AreaRow[]; ts: number } | undefined;
}
const TTL_MS = 5 * 60_000;

async function getData(): Promise<{ pallets: PalletRow[]; areas: AreaRow[] }> {
  const hit = globalThis.__whCapacityCacheV2;
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;
  const [pallets, areaRaw] = await Promise.all([
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
    query<{ wh: string; nm: string | null; m2: string; pallets_needed: number; no_dim: number; items: number }>(
      `WITH bal AS (
         SELECT wh_code, item_code, SUM(qty * COALESCE(calc_flag,1)) bal
         FROM public.odg_wms_trans_detail WHERE (status = 0 OR status IS NULL)
         GROUP BY wh_code, item_code HAVING SUM(qty * COALESCE(calc_flag,1)) > 0
       ),
       dim AS (
         SELECT DISTINCT ON (ic_code) ic_code,
                (NULLIF(width,0)::numeric * NULLIF(length,0)::numeric / 10000) foot,
                NULLIF(stack,0)::numeric stack,
                NULLIF(pallet,0)::numeric pallet
         FROM public.odg_wms_product_dimension ORDER BY ic_code, roworder
       )
       SELECT b.wh_code AS wh,
              max(w.name_1) AS nm,
              round(SUM(CASE WHEN d.foot > 0 THEN ceil(b.bal / COALESCE(NULLIF(d.stack,0),1)) * d.foot ELSE 0 END)::numeric, 1)::text AS m2,
              SUM(CASE WHEN d.pallet > 0 THEN ceil(b.bal / d.pallet) ELSE 0 END)::int AS pallets_needed,
              count(*) FILTER (WHERE d.foot IS NULL OR d.foot <= 0)::int AS no_dim,
              count(*)::int AS items
       FROM bal b
       LEFT JOIN dim d ON d.ic_code = b.item_code
       LEFT JOIN public.ic_warehouse w ON w.code = b.wh_code
       GROUP BY b.wh_code`,
    ),
  ]);
  const areas: AreaRow[] = areaRaw.map((a) => ({ wh: a.wh, nm: a.nm, m2: Number.parseFloat(a.m2) || 0, palletsNeeded: a.pallets_needed, noDim: a.no_dim, items: a.items }));
  globalThis.__whCapacityCacheV2 = { pallets, areas, ts: Date.now() };
  return { pallets, areas };
}

export default async function WarehouseCapacity({ session }: { session: Session }) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return null;
  const allowed = Array.isArray(accessible) ? new Set(accessible) : null;
  const inScope = (wh: string) => !allowed || allowed.has(wh);

  const { pallets, areas } = await getData();

  // Show warehouses the user is responsible for that have pallet capacity OR stock.
  const byWh = new Map<string, Row>();
  for (const r of pallets) {
    if (!inScope(r.wh)) continue;
    byWh.set(r.wh, { wh: r.wh, nm: r.nm, total: r.total, used: r.used, m2: 0, palletsNeeded: 0, noDim: 0, items: 0 });
  }
  for (const a of areas) {
    if (!inScope(a.wh)) continue;
    const g = byWh.get(a.wh) ?? { wh: a.wh, nm: a.nm, total: 0, used: 0, m2: 0, palletsNeeded: 0, noDim: 0, items: 0 };
    g.nm = g.nm ?? a.nm;
    g.m2 = a.m2; g.palletsNeeded = a.palletsNeeded; g.noDim = a.noDim; g.items = a.items;
    byWh.set(a.wh, g);
  }
  const rows = [...byWh.values()].sort((a, b) => a.wh.localeCompare(b.wh));
  if (rows.length === 0) return null;

  const grandM2 = rows.reduce((s, r) => s + r.m2, 0);
  const grandPallets = rows.reduce((s, r) => s + r.palletsNeeded, 0);
  const nf = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-base font-semibold text-zinc-800 dark:text-zinc-100">
          <BuildingIcon className="h-5 w-5 text-indigo-500" /> ຄວາມຈຸ &amp; ພື້ນທີ່ຈັດເກັບ
        </span>
        {(grandM2 > 0 || grandPallets > 0) && (
          <span className="ml-auto rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900/50">
            ສິນຄ້າຄົງເຫຼືອລວມ {grandM2 > 0 ? `~${nf(grandM2)} m²` : ""}{grandM2 > 0 && grandPallets > 0 ? " · " : ""}{grandPallets > 0 ? `~${nf(grandPallets)} ພາເລທ` : ""}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const hasCap = r.total > 0;
          const free = Math.max(0, r.total - r.used);
          const pct = hasCap ? Math.min(100, Math.round((r.used / r.total) * 100)) : 0;
          const bar = pct >= 85 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={r.wh} className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-800">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200" title={r.nm ?? ""}>
                  <span className="font-mono">{r.wh}</span>{r.nm ? ` · ${r.nm}` : ""}
                </span>
                {hasCap && <span className="shrink-0 text-[11px] font-bold tabular-nums text-zinc-600 dark:text-zinc-300">{pct}%</span>}
              </div>
              {hasCap ? (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    <span>ໃຊ້ <span className="font-bold text-zinc-700 dark:text-zinc-200">{nf(r.used)}</span></span>
                    <span>ເຫຼືອ <span className="font-bold text-emerald-600 dark:text-emerald-400">{nf(free)}</span></span>
                    <span>ທັງໝົດ <span className="font-bold text-zinc-700 dark:text-zinc-200">{nf(r.total)}</span> ພາເລທ</span>
                  </div>
                </>
              ) : (
                <div className="mt-1 text-[11px] text-zinc-400">ບໍ່ໄດ້ຕັ້ງຄ່າຕຳແໜ່ງພາເລທ</div>
              )}
              {(r.m2 > 0 || r.palletsNeeded > 0) && (
                <div className="mt-1.5 flex items-center gap-1 border-t border-zinc-200 pt-1.5 text-[11px] font-semibold text-indigo-600 dark:border-zinc-700 dark:text-indigo-400" title={r.noDim > 0 ? `${r.noDim}/${r.items} ລາຍການບໍ່ມີຂໍ້ມູນຂະໜາດ` : undefined}>
                  <PackageIcon className="h-3 w-3" />ສິນຄ້າຄົງເຫຼືອ {r.m2 > 0 ? `~${r.m2.toLocaleString("en-US", { maximumFractionDigits: 1 })} m²` : ""}{r.m2 > 0 && r.palletsNeeded > 0 ? " · " : ""}{r.palletsNeeded > 0 ? `~${nf(r.palletsNeeded)} ພາເລທ` : ""}{r.noDim > 0 ? " *" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
