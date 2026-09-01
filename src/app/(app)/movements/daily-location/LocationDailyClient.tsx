"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, ChevronRightIcon, MapPinIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { WarehouseGroup } from "@/components/ui/WarehouseGroup";

export type WarehouseOption = { code: string; name: string | null };

type LocRow = {
  rack: string; rack_name: string | null; loc: string; loc_name: string | null;
  opening: number; qty_in: number; qty_out: number; move_in: number; move_out: number;
  closing: number; items: number; docs: number;
};
type Totals = {
  locations: number; opening: number; qty_in: number; qty_out: number;
  closing: number; move_in: number; move_out: number;
};
type Payload = { from: string; to: string; rows: LocRow[]; totals: Totals; truncated: boolean };

type LocDay = { date: string; opening: number; qty_in: number; qty_out: number; closing: number };
type LocItem = {
  item_code: string; item_name: string | null; unit_code: string | null;
  opening: number; qty_in: number; qty_out: number; closing: number;
};
type Detail = { rack: string; loc: string; days: LocDay[]; items: LocItem[] };

const RANGES = [
  { key: "d0", label: "ມື້ນີ້", from: 0, to: 0 },
  { key: "d1", label: "ມື້ວານ", from: -1, to: -1 },
  { key: "d7", label: "7 ມື້", from: -6, to: 0 },
  { key: "d30", label: "30 ມື້", from: -29, to: 0 },
];

function fmt(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}` : s;
}
const DOW = ["ອາ", "ຈ", "ອ", "ພ", "ພຫ", "ສຸ", "ສ"];
function dow(s: string) {
  return DOW[new Date(`${s}T00:00:00Z`).getUTCDay()] ?? "";
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

/**
 * ຕົວກອງຢູ່ຊັ້ນນອກຮ່ວມກັນທຸກສາງ ແລ້ວແຕ່ລະສາງທີ່ຜູ້ໃຊ້ມີສິດ ມີບລັອກຂອງໂຕເອງ —
 * ຮູບແບບດຽວກັນກັບ /movements/daily.
 */
export default function LocationDailyClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(today());
  const [idle, setIdle] = useState(false);
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  function setRange(r: { from: number; to: number }) {
    const t = today();
    setFrom(shift(t, r.from));
    setTo(shift(t, r.to));
  }

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <div className={`${inputCls} flex w-full items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {warehouses.length}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ແຕ່ວັນທີ່</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຫາວັນທີ່</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-1.5">
            {RANGES.map((r) => (
              <button key={r.key} type="button" onClick={() => setRange(r)}
                className="rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800">
                {r.label}
              </button>
            ))}
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຄົ້ນຫາບ່ອນເກັບ</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຊັ້ນວາງ / ບ່ອນເກັບ" className={`${inputCls} w-full`} />
          </div>
          <button type="button" onClick={() => setIdle((v) => !v)}
            className={`rounded-lg px-3 py-2.5 text-xs font-semibold ring-1 transition ${idle ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800" : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}>
            ລວມບ່ອນເກັບທີ່ບໍ່ເຄື່ອນໄຫວ
          </button>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg">
            <SearchIcon className="h-4 w-4" />
            ກວດລາຍງານ
          </button>
        </div>
      </section>

      {warehouses.map((w) => (
        <WarehouseGroup key={w.code} code={w.code} name={w.name} tone="aqua">
          <LocationWarehouse whCode={w.code} from={from} to={to} idle={idle} q={q} reloadKey={reloadKey} />
        </WarehouseGroup>
      ))}
    </div>
  );
}

/** ລາຍງານຕາມບ່ອນເກັບຂອງສາງໜຶ່ງ. */
function LocationWarehouse({ whCode, from, to, idle, q, reloadKey }: {
  whCode: string; from: string; to: string; idle: boolean; q: string; reloadKey: number;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ wh: whCode, from, to });
    if (idle) p.set("idle", "1");
    return p;
  }, [whCode, from, to, idle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setOpenKey(null);
      setDetail(null);
      try {
        const res = await fetch(`/api/movements/daily-location?${params}`);
        const json = (await res.json()) as Partial<Payload> & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
        setData(json as Payload);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params, reloadKey]);

  /** ກົດແຖວບ່ອນເກັບ → ໂຫລດໄຫຼຕາມມື້ ແລະ ຍອດຕາມສິນຄ້າ. */
  async function toggle(row: LocRow) {
    const key = `${row.rack}|${row.loc}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setDetail(null);
    setDetailLoading(true);
    try {
      const p = new URLSearchParams({ wh: whCode, rack: row.rack, loc: row.loc, from, to });
      const res = await fetch(`/api/movements/daily-location/detail?${p}`);
      const json = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      setDetail(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setDetailLoading(false);
    }
  }

  /** ຄົ້ນຫາເຮັດຢູ່ຝັ່ງ client — ຂໍ້ມູນຂອງສາງໂຫລດມາຄົບແລ້ວ. */
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.rows ?? [];
    return (data?.rows ?? []).filter((r) =>
      `${r.rack} ${r.rack_name ?? ""} ${r.loc} ${r.loc_name ?? ""}`.toLowerCase().includes(needle),
    );
  }, [data, q]);

  /** ຈັດເປັນກຸ່ມຕາມຊັ້ນວາງ ພ້ອມຍອດລວມຂອງແຕ່ລະຊັ້ນ. */
  const racks = useMemo(() => {
    const map = new Map<string, { rack: string; rack_name: string | null; rows: LocRow[] }>();
    for (const r of rows) {
      const g = map.get(r.rack);
      if (g) g.rows.push(r);
      else map.set(r.rack, { rack: r.rack, rack_name: r.rack_name, rows: [r] });
    }
    return [...map.values()].map((g) => ({
      ...g,
      opening: g.rows.reduce((s, r) => s + r.opening, 0),
      qty_in: g.rows.reduce((s, r) => s + r.qty_in, 0),
      qty_out: g.rows.reduce((s, r) => s + r.qty_out, 0),
      closing: g.rows.reduce((s, r) => s + r.closing, 0),
    }));
  }, [rows]);

  const shown = useMemo(() => {
    if (!data) return null;
    if (rows.length === data.rows.length) return data.totals;
    return {
      locations: rows.length,
      opening: rows.reduce((s, r) => s + r.opening, 0),
      qty_in: rows.reduce((s, r) => s + r.qty_in, 0),
      qty_out: rows.reduce((s, r) => s + r.qty_out, 0),
      closing: rows.reduce((s, r) => s + r.closing, 0),
      move_in: rows.reduce((s, r) => s + r.move_in, 0),
      move_out: rows.reduce((s, r) => s + r.move_out, 0),
    } satisfies Totals;
  }, [data, rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <a href={`/api/movements/daily-location/export?${params}`}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow">
          Excel
        </a>
        <a href={`/print/daily-location?${params}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow">
          ເອກະສານ / ພິມ
        </a>
        {loading && <span className="text-xs text-zinc-400">ກຳລັງກວດ...</span>}
        {err && <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</span>}
      </div>

      {data && shown && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 print:hidden">
            <Kpi label="ບ່ອນເກັບ" value={fmt(shown.locations)} sub={`${racks.length} ຊັ້ນວາງ`} />
            <Kpi label="ຍອດຍົກມາ" value={fmt(shown.opening)} sub={fmtDate(data.from)} />
            <Kpi label="ຮັບເຂົ້າ" value={fmt(shown.qty_in)} sub={shown.move_in ? `ໃນນັ້ນຍ້າຍຊັ້ນ ${fmt(shown.move_in)}` : "ລວມທັງຊ່ວງ"} tone="emerald" />
            <Kpi label="ຈ່າຍອອກ" value={fmt(shown.qty_out)} sub={shown.move_out ? `ໃນນັ້ນຍ້າຍຊັ້ນ ${fmt(shown.move_out)}` : "ລວມທັງຊ່ວງ"} tone="rose" />
            <Kpi label="ຄົງເຫຼືອ" value={fmt(shown.closing)} sub={fmtDate(data.to)} tone="navy" />
          </section>

          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-zinc-500">
                {data.from} → {data.to} · {rows.length} ບ່ອນເກັບ
                {data.truncated && <span className="ml-1 font-semibold text-amber-600">(ຕັດທ້າຍ)</span>}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <th className="px-3 py-2.5">ບ່ອນເກັບ</th>
                    <th className="px-3 py-2.5 text-right">ຍອດຍົກມາ</th>
                    <th className="px-3 py-2.5 text-right">ຮັບເຂົ້າ</th>
                    <th className="px-3 py-2.5 text-right">ຈ່າຍອອກ</th>
                    <th className="px-3 py-2.5 text-right">ຄົງເຫຼືອ</th>
                    <th className="px-3 py-2.5 text-right">ລາຍການ</th>
                    <th className="px-3 py-2.5 print:hidden"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {racks.map((g) => [
                    <tr key={`r-${g.rack}`} className="bg-zinc-50/70 dark:bg-zinc-800/30">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs font-black text-zinc-700 dark:text-zinc-200">{g.rack || "ບໍ່ລະບຸຊັ້ນວາງ"}</span>
                        {g.rack_name && <span className="ml-2 text-[11px] text-zinc-500">{g.rack_name}</span>}
                        <span className="ml-2 text-[10px] text-zinc-400">{g.rows.length} ບ່ອນ</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(g.opening)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{g.qty_in ? fmt(g.qty_in) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">{g.qty_out ? fmt(g.qty_out) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-black tabular-nums text-zinc-800 dark:text-zinc-100">{fmt(g.closing)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 print:hidden" />
                    </tr>,
                    ...g.rows.map((r) => {
                      const key = `${r.rack}|${r.loc}`;
                      return [
                        <tr key={key} className={openKey === key ? "bg-brand-50/50 dark:bg-brand-950/10" : undefined}>
                          <td className="px-3 py-2.5 pl-8">
                            <button type="button" onClick={() => toggle(r)} className="text-left">
                              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">
                                <MapPinIcon className="h-3.5 w-3.5" />
                                {r.loc || "ບໍ່ລະບຸບ່ອນເກັບ"}
                              </span>
                              {r.loc_name && <div className="text-[11px] text-zinc-500">{r.loc_name}</div>}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(r.opening)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                            {r.qty_in ? fmt(r.qty_in) : "—"}
                            {r.move_in > 0 && <div className="text-[10px] font-normal text-zinc-400">ຍ້າຍ {fmt(r.move_in)}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-rose-600 dark:text-rose-400">
                            {r.qty_out ? fmt(r.qty_out) : "—"}
                            {r.move_out > 0 && <div className="text-[10px] font-normal text-zinc-400">ຍ້າຍ {fmt(r.move_out)}</div>}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${r.closing < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                            {fmt(r.closing)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">{r.items || "—"}</td>
                          <td className="px-3 py-2.5 print:hidden">
                            <ChevronRightIcon className={`h-4 w-4 text-zinc-400 transition-transform ${openKey === key ? "rotate-90" : ""}`} />
                          </td>
                        </tr>,
                        openKey === key ? <DetailRow key={`${key}-x`} loading={detailLoading} detail={detail} /> : null,
                      ];
                    }),
                  ])}
                  {rows.length === 0 && !loading && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-zinc-400">ບໍ່ມີການເຄື່ອນໄຫວໃນຊ່ວງນີ້</td></tr>
                  )}
                  <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/50">
                    <td className="px-3 py-2.5 text-xs">ລວມ</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.opening)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.qty_in)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(shown.qty_out)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">{fmt(shown.closing)}</td>
                    <td className="px-3 py-2.5" />
                    <td className="print:hidden" />
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-zinc-400">
              ⓘ ຄົງເຫຼືອ = ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ (ຕໍ່ບ່ອນເກັບ) ·
              ລະດັບບ່ອນເກັບ ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງນຳ ເພາະຊັ້ນຕົ້ນທາງໜ້ອຍລົງ ຊັ້ນປາຍທາງເພີ່ມຂຶ້ນຈິງ —
              ສ່ວນທີ່ເປັນການຍ້າຍສະແດງໄວ້ໃຕ້ຕົວເລກ (ຍອດລວມທັງສາງຢູ່ໜ້າ ເຄື່ອນໄຫວປະຈຳວັນ ຈຶ່ງບໍ່ນັບສ່ວນນີ້)
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone = "zinc" }: { label: string; value: string; sub?: string; tone?: string }) {
  const color =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "rose" ? "text-rose-600 dark:text-rose-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
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

/** ລາຍລະອຽດຂອງບ່ອນເກັບທີ່ກົດ: ໄຫຼຕາມມື້ ແລະ ຍອດຕາມສິນຄ້າ. */
function DetailRow({ loading, detail }: { loading: boolean; detail: Detail | null }) {
  return (
    <tr className="bg-zinc-50/60 dark:bg-zinc-950/40">
      <td colSpan={7} className="px-3 py-3">
        {loading ? (
          <div className="py-4 text-center text-xs text-zinc-400">ກຳລັງໂຫລດ...</div>
        ) : !detail ? (
          <div className="py-4 text-center text-xs text-zinc-400">ບໍ່ມີຂໍ້ມູນ</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="flex items-center gap-1.5 bg-white px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <CalendarIcon className="h-3.5 w-3.5" /> ຕາມມື້ ({detail.days.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase text-zinc-400 dark:bg-zinc-800/50">
                    <th className="px-3 py-1.5">ວັນທີ່</th>
                    <th className="px-3 py-1.5 text-right">ຍົກມາ</th>
                    <th className="px-3 py-1.5 text-right">ຮັບ</th>
                    <th className="px-3 py-1.5 text-right">ຈ່າຍ</th>
                    <th className="px-3 py-1.5 text-right">ຄົງເຫຼືອ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {detail.days.map((d) => (
                    <tr key={d.date} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-1.5 font-mono text-[10px] font-bold text-zinc-600 dark:text-zinc-300">
                        {fmtDate(d.date)} <span className="font-normal text-zinc-400">{dow(d.date)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-400">{fmt(d.opening)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{d.qty_in ? fmt(d.qty_in) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{d.qty_out ? fmt(d.qty_out) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(d.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="flex items-center gap-1.5 bg-white px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <PackageIcon className="h-3.5 w-3.5" /> ຕາມສິນຄ້າ ({detail.items.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase text-zinc-400 dark:bg-zinc-800/50">
                    <th className="px-3 py-1.5">ສິນຄ້າ</th>
                    <th className="px-3 py-1.5 text-right">ຍົກມາ</th>
                    <th className="px-3 py-1.5 text-right">ຮັບ</th>
                    <th className="px-3 py-1.5 text-right">ຈ່າຍ</th>
                    <th className="px-3 py-1.5 text-right">ຄົງເຫຼືອ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {detail.items.map((it) => (
                    <tr key={it.item_code} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-[10px] font-bold text-zinc-600 dark:text-zinc-300">{it.item_code}</div>
                        <div className="max-w-[220px] truncate text-[11px] text-zinc-500" title={it.item_name ?? ""}>{it.item_name ?? "—"}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-400">{fmt(it.opening)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{it.qty_in ? fmt(it.qty_in) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{it.qty_out ? fmt(it.qty_out) : "—"}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold tabular-nums ${it.closing < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-700 dark:text-zinc-200"}`}>{fmt(it.closing)}</td>
                    </tr>
                  ))}
                  {detail.items.length === 0 && (
                    <tr><td colSpan={5} className="bg-white px-3 py-4 text-center text-zinc-400 dark:bg-zinc-900">ບໍ່ມີສິນຄ້າ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
