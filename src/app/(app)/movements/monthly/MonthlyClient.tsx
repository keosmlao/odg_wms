"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { WarehouseGroup } from "@/components/ui/WarehouseGroup";

export type WarehouseOption = { code: string; name: string | null };

type MonthItemRow = {
  item_code: string;
  item_name: string | null;
  brand: string | null;
  unit_code: string | null;
  opening: number;
  qty_in: number;
  qty_out: number;
  closing: number;
  docs: number;
};
type Totals = { items: number; opening: number; qty_in: number; qty_out: number; closing: number };
type Payload = { month: string; from: string; to: string; rows: MonthItemRow[]; brands: string[]; totals: Totals; truncated: boolean };

/** ຄໍລຳທີ່ຮຽງໄດ້ — ກົດຫົວຕາຕະລາງເພື່ອສະຫຼັບ. */
type SortKey = "item_code" | "brand" | "opening" | "qty_in" | "qty_out" | "closing";

function fmt(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}
function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

/**
 * ຕົວກອງຢູ່ຊັ້ນນອກຮ່ວມກັນທຸກສາງ ແລ້ວແຕ່ລະສາງທີ່ຜູ້ໃຊ້ມີສິດ ມີບລັອກຂອງໂຕເອງ —
 * ຮູບແບບດຽວກັນກັບ /movements/daily ແລະ /movements/daily-location.
 */
export default function MonthlyClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  /** "" = ທຸກສາງ (ໜຶ່ງບລັອກຕໍ່ໜຶ່ງສາງ) — ຕັ້ງຕົ້ນເປັນສາງທຳອິດ ເພື່ອບໍ່ໃຫ້ໂຫລດທຸກສາງພ້ອມກັນ. */
  const [wh, setWh] = useState(warehouses[0]?.code ?? "");
  const [month, setMonth] = useState(thisMonth());
  const [idle, setIdle] = useState(true);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  /** ລາຍຊື່ຍີ່ຫໍ້ຂອງທຸກສາງລວມກັນ — ແຕ່ລະບລັອກສາງສົ່ງຂຶ້ນມາເມື່ອໂຫລດແລ້ວ. */
  const [brands, setBrands] = useState<string[]>([]);
  const addBrands = useCallback((list: string[]) => {
    setBrands((prev) => {
      const merged = [...new Set([...prev, ...list])].sort((a, b) => a.localeCompare(b, "lo"));
      return merged.length === prev.length ? prev : merged;
    });
  }, []);

  /** ສາງທີ່ຈະສະແດງ — ສາງດຽວທີ່ເລືອກ ຫຼື ທຸກສາງທີ່ມີສິດ. */
  const shown = wh ? warehouses.filter((w) => w.code === wh) : warehouses;

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${inputCls} w-full font-bold`}>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code}{w.name ? ` — ${w.name}` : ""}
                </option>
              ))}
              <option value="">ທຸກສາງ ({warehouses.length})</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເດືອນ</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800">
              ເດືອນກ່ອນ
            </button>
            <button type="button" onClick={() => setMonth(thisMonth())}
              className="rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800">
              ເດືອນນີ້
            </button>
          </div>
          <div className="min-w-[200px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຄົ້ນຫາສິນຄ້າ</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ລະຫັດ / ຊື່ / ຍີ່ຫໍ້" className={`${inputCls} w-full`} />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຍີ່ຫໍ້</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} list="monthly-brands" placeholder="ທຸກຍີ່ຫໍ້" className={`${inputCls} w-full`} />
            <datalist id="monthly-brands">
              {brands.map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
          <button type="button" onClick={() => setIdle((v) => !v)}
            className={`rounded-lg px-3 py-2.5 text-xs font-semibold ring-1 transition ${idle ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800" : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}>
            ລວມສິນຄ້າທີ່ບໍ່ເຄື່ອນໄຫວ
          </button>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg">
            <SearchIcon className="h-4 w-4" />
            ກວດລາຍງານ
          </button>
        </div>
      </section>

      {shown.map((w) => (
        <WarehouseGroup key={w.code} code={w.code} name={w.name} tone="violet">
          <MonthlyWarehouse whCode={w.code} month={month} idle={idle} q={q} brand={brand} reloadKey={reloadKey} onBrands={addBrands} />
        </WarehouseGroup>
      ))}
    </div>
  );
}

/** ລາຍງານລາຍເດືອນຂອງສາງໜຶ່ງ. */
function MonthlyWarehouse({ whCode, month, idle, q, brand, reloadKey, onBrands }: {
  whCode: string; month: string; idle: boolean; q: string; brand: string; reloadKey: number;
  onBrands: (brands: string[]) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "qty_out", dir: -1 });

  const params = useMemo(() => {
    const p = new URLSearchParams({ wh: whCode, month });
    if (idle) p.set("idle", "1");
    return p;
  }, [whCode, month, idle]);

  /** ພາຣາມິເຕີສຳລັບ Excel / ໜ້າພິມ — ພາຕົວກອງໄປນຳ ໃຫ້ໄດ້ແຖວຄືກັນກັບໜ້າຈໍ. */
  const outParams = useMemo(() => {
    const p = new URLSearchParams(params);
    if (q.trim()) p.set("q", q.trim());
    if (brand.trim()) p.set("brand", brand.trim());
    return p;
  }, [params, q, brand]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/movements/monthly?${params}`);
        const json = (await res.json()) as Partial<Payload> & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
        setData(json as Payload);
        onBrands(json.brands ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params, reloadKey, onBrands]);

  /** ກອງ ແລະ ຮຽງ ຢູ່ຝັ່ງ client — ຂໍ້ມູນຂອງສາງໂຫລດມາຄົບແລ້ວ. */
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const b = brand.trim();
    const list = (data?.rows ?? []).filter(
      (r) =>
        (!b || (r.brand ?? "") === b) &&
        (!needle || `${r.item_code} ${r.item_name ?? ""} ${r.brand ?? ""}`.toLowerCase().includes(needle)),
    );
    const { key, dir } = sort;
    return [...list].sort((a, x) => {
      const va = a[key], vx = x[key];
      if (typeof va === "number" && typeof vx === "number") return (va - vx) * dir;
      return String(va ?? "").localeCompare(String(vx ?? ""), "lo") * dir;
    });
  }, [data, q, brand, sort]);

  const shown = useMemo(() => {
    if (!data) return null;
    if (rows.length === data.rows.length) return data.totals;
    return {
      items: rows.length,
      opening: rows.reduce((s, r) => s + r.opening, 0),
      qty_in: rows.reduce((s, r) => s + r.qty_in, 0),
      qty_out: rows.reduce((s, r) => s + r.qty_out, 0),
      closing: rows.reduce((s, r) => s + r.closing, 0),
    } satisfies Totals;
  }, [data, rows]);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "item_code" || key === "brand" ? 1 : -1 }));
  }
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <a href={`/api/movements/monthly/export?${outParams}`}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow">
          Excel
        </a>
        <a href={`/print/monthly?${outParams}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow">
          ເອກະສານ / ພິມ
        </a>
        {loading && <span className="text-xs text-zinc-400">ກຳລັງກວດ...</span>}
        {err && <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</span>}
      </div>

      {data && shown && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 print:hidden">
            <Kpi label="ລາຍການສິນຄ້າ" value={fmt(shown.items)} sub={`ເດືອນ ${data.month}`} />
            <Kpi label="ຍອດຍົກມາ" value={fmt(shown.opening)} sub={data.from} />
            <Kpi label="ເຂົ້າ" value={fmt(shown.qty_in)} sub="ລວມທັງເດືອນ" tone="emerald" />
            <Kpi label="ອອກ" value={fmt(shown.qty_out)} sub="ລວມທັງເດືອນ" tone="rose" />
            <Kpi label="ຄົງເຫຼືອ" value={fmt(shown.closing)} sub={data.to} tone="navy" />
          </section>

          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-zinc-500">
                {data.from} → {data.to} · {rows.length} ລາຍການ
                {data.truncated && <span className="ml-1 font-semibold text-amber-600">(ຕັດທ້າຍ)</span>}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <Th onClick={() => sortBy("item_code")}>ລະຫັດສິນຄ້າ{arrow("item_code")}</Th>
                    <th className="px-3 py-2.5">ຊື່ສິນຄ້າ</th>
                    <Th onClick={() => sortBy("brand")}>ຍີ່ຫໍ້{arrow("brand")}</Th>
                    <th className="px-3 py-2.5">ຫົວໜ່ວຍ</th>
                    <Th right onClick={() => sortBy("opening")}>ຍອດຍົກມາ{arrow("opening")}</Th>
                    <Th right onClick={() => sortBy("qty_in")}>ເຂົ້າ{arrow("qty_in")}</Th>
                    <Th right onClick={() => sortBy("qty_out")}>ອອກ{arrow("qty_out")}</Th>
                    <Th right onClick={() => sortBy("closing")}>ຄົງເຫຼືອ{arrow("closing")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.map((r) => (
                    <tr key={r.item_code}>
                      <td className="px-3 py-2.5 font-mono text-xs font-bold text-zinc-700 dark:text-zinc-200">{r.item_code}</td>
                      <td className="max-w-[420px] px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300" title={r.item_name ?? ""}>
                        <span className="line-clamp-2">{r.item_name ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{r.brand ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{r.unit_code ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(r.opening)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{r.qty_in ? fmt(r.qty_in) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-rose-600 dark:text-rose-400">{r.qty_out ? fmt(r.qty_out) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${r.closing < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                        {fmt(r.closing)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && !loading && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-zinc-400">ບໍ່ມີການເຄື່ອນໄຫວໃນເດືອນນີ້</td></tr>
                  )}
                  <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/50">
                    <td className="px-3 py-2.5 text-xs">ລວມ</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500">{rows.length} ລາຍການ</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.opening)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.qty_in)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.qty_out)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">{fmt(shown.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-zinc-400">
              ⓘ ຄົງເຫຼືອ = ຍອດຍົກມາ + ເຂົ້າ − ອອກ (ຕໍ່ສິນຄ້າ ໃນສາງນີ້) ·
              ບໍ່ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງ ເພາະຍອດສາງບໍ່ປ່ຽນ ·
              ຍີ່ຫໍ້ ແລະ ຫົວໜ່ວຍ ມາຈາກແຟ້ມສິນຄ້າ ERP
            </p>
          </section>
        </>
      )}

      {!data && !loading && !err && (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <PackageIcon className="h-4 w-4" /> ຍັງບໍ່ມີຂໍ້ມູນ
        </p>
      )}
    </div>
  );
}

function Th({ children, right, onClick }: { children: React.ReactNode; right?: boolean; onClick: () => void }) {
  return (
    <th className={`px-3 py-2.5 ${right ? "text-right" : ""}`}>
      <button type="button" onClick={onClick} className="uppercase transition hover:text-brand-600 dark:hover:text-brand-400">
        {children}
      </button>
    </th>
  );
}

function Kpi({ label, value, sub, tone = "zinc" }: { label: string; value: string; sub?: string; tone?: string }) {
  const color =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "rose" ? "text-rose-600 dark:text-rose-400"
    : tone === "navy" ? "text-brand-600 dark:text-brand-400"
    : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}
