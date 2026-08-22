"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "@/components/ui/Icons";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";

export type WarehouseOption = { code: string; name: string | null };
type Bin = { wh_code: string; location: string; name: string | null; rack: string | null; items: number; qty: string; empty: boolean };
type Kpi = { total: number; empty: number; occupied: number; utilization: number };

function fmt(v: string | number) {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

export default function PutawayClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [rows, setRows] = useState<Bin[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  // ບໍ່ມີການເລືອກສາງ — ໂຫຼດ bin ຂອງທຸກສາງທີ່ມີສິດ ແລ້ວແຍກກຸ່ມຕາມສາງ → rack.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/movements/putaway`);
        const data = (await res.json()) as { rows?: Bin[]; kpi?: Kpi };
        if (!cancelled) { setRows(data.rows ?? []); setKpi(data.kpi ?? null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!onlyEmpty || r.empty) &&
      (!ql || r.location.toLowerCase().includes(ql) || (r.rack ?? "").toLowerCase().includes(ql) || (r.name ?? "").toLowerCase().includes(ql)),
    );
  }, [rows, q, onlyEmpty]);

  /** ສາງ → rack → bin */
  const byWh = useMemo(() => {
    return groupByWarehouse(filtered, (r) => r.wh_code, warehouses).map((g) => {
      const m = new Map<string, Bin[]>();
      for (const r of g.rows) {
        const k = r.rack ?? "—";
        (m.get(k) ?? m.set(k, []).get(k)!).push(r);
      }
      return { code: g.code, bins: g.rows.length, racks: [...m.entries()] };
    });
  }, [filtered, warehouses]);

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <div className={`${inputCls} flex items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{warehouses.length}</span>
            </div>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຄົ້ນຫາ bin / rack</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ລະຫັດ location..." className={`${inputCls} w-full pl-8`} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="h-4 w-4 rounded accent-emerald-500" />
            ສະແດງແຕ່ບ່ອນວ່າງ
          </label>
        </div>
      </section>

      {kpi && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kard label="location ທັງໝົດ" value={kpi.total} tone="zinc" />
          <Kard label="ວ່າງ (ໃສ່ໄດ້)" value={kpi.empty} tone="emerald" />
          <Kard label="ມີສິນຄ້າ" value={kpi.occupied} tone="navy" />
          <Kard label="ໃຊ້ໄປ %" value={`${kpi.utilization}%`} tone="amber" />
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
      ) : (
        <div className="space-y-7">
          {byWh.map((g) => (
            <WarehouseGroup
              key={g.code}
              code={g.code}
              name={warehouses.find((w) => w.code === g.code)?.name}
              count={g.bins}
              countLabel="location"
              tone="emerald"
            >
        <div className="space-y-4">
          {g.racks.map(([rack, bins]) => (
            <section key={`${g.code}-${rack}`} className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/60 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
                <span className="font-mono text-sm font-bold text-zinc-700 dark:text-zinc-200">Rack {rack}</span>
                <span className="text-[11px] text-zinc-500">{bins.filter((b) => b.empty).length} ວ່າງ / {bins.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
                {bins.map((b) => (
                  <div key={b.location} className={`rounded-lg px-3 py-2 ring-1 ${b.empty ? "bg-emerald-50/60 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900/50" : "bg-white ring-zinc-200 dark:bg-zinc-950/40 dark:ring-zinc-800"}`}>
                    <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{b.name?.trim() || b.location}</div>
                    {b.name?.trim() && b.name.trim() !== b.location && (
                      <div className="font-mono text-[10px] text-zinc-400">{b.location}</div>
                    )}
                    {b.empty ? (
                      <div className="mt-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">ວ່າງ — ໃສ່ໄດ້</div>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-zinc-500">{b.items} ສິນຄ້າ · {fmt(b.qty)}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
            </WarehouseGroup>
          ))}
          {byWh.length === 0 && <div className="py-12 text-center text-sm text-zinc-400">ບໍ່ພົບ location</div>}
        </div>
      )}
    </div>
  );
}

function Kard({ label, value, tone }: { label: string; value: string | number; tone: "zinc" | "emerald" | "navy" | "amber" }) {
  const t = {
    zinc: "text-zinc-700 dark:text-zinc-200",
    emerald: "text-emerald-600 dark:text-emerald-400",
    navy: "text-brand-600 dark:text-brand-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <div className="shadow-card rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${t}`}>{value}</div>
    </div>
  );
}
