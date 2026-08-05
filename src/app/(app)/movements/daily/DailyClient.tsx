"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, ListIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };

type DayStock = {
  date: string; opening: number; qty_in: number; qty_out: number;
  in_docs: number; out_docs: number; bill_qty: number; bill_docs: number; closing: number;
};
type DayBills = { date: string; carry_in: number; opened: number; closed: number; carry_out: number };
type Totals = {
  opening: number; closing: number; qty_in: number; qty_out: number;
  bill_qty: number; bill_docs: number; opened: number; closed: number; carry_in: number; carry_out: number;
};
type Payload = { from: string; to: string; stock: DayStock[]; bills: DayBills[]; totals: Totals };

type DayItem = { item_code: string; item_name: string | null; unit_code: string | null; qty_in: number; qty_out: number };
type DayBill = { doc_no: string; trans_flag: number; cust_name: string | null; transport_name: string | null; lines: number; qty: number; note: string | null };
type DayDetail = { date: string; items: DayItem[]; bills: DayBill[] };

const TYPES = [
  { key: "req", flag: 122, label: "ໃບເບີກ" },
  { key: "transfer", flag: 124, label: "ໃບໂອນ" },
  { key: "sale", flag: 44, label: "ບິນຂາຍ" },
];
const LABEL_BY_FLAG: Record<number, string> = Object.fromEntries(TYPES.map((t) => [t.flag, t.label]));

const RANGES = [
  { key: "7", label: "7 ມື້", days: 6 },
  { key: "14", label: "14 ມື້", days: 13 },
  { key: "30", label: "30 ມື້", days: 29 },
];

function fmt(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}` : s;
}
/** ວັນຂອງອາທິດ ເປັນພາສາລາວ — ຊ່ວຍເຫັນຮູບແບບການເຄື່ອນໄຫວລາຍອາທິດ. */
const DOW = ["ອາ", "ຈ", "ອ", "ພ", "ພຫ", "ສຸ", "ສ"];
function dow(s: string) {
  const d = new Date(`${s}T00:00:00Z`);
  return DOW[d.getUTCDay()] ?? "";
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DailyClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(shift(today(), -6));
  const [types, setTypes] = useState<string[]>(TYPES.map((t) => t.key));
  const [tab, setTab] = useState<"stock" | "bills">("stock");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ wh: whCode, from, to });
    if (types.length > 0 && types.length < TYPES.length) p.set("type", types.join(","));
    return p;
  }, [whCode, from, to, types]);

  async function load() {
    if (!whCode) return;
    setLoading(true);
    setErr(null);
    setOpenDay(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/movements/daily?${params}`);
      const json = (await res.json()) as Partial<Payload> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      setData(json as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (whCode) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ກົດແຖວວັນທີ່ → ໂຫລດລາຍລະອຽດຂອງມື້ນັ້ນ (ສິນຄ້າ + ໃບບິນ). */
  async function toggleDay(date: string) {
    if (openDay === date) {
      setOpenDay(null);
      return;
    }
    setOpenDay(date);
    setDetail(null);
    setDetailLoading(true);
    try {
      const p = new URLSearchParams({ wh: whCode, date });
      if (types.length > 0 && types.length < TYPES.length) p.set("type", types.join(","));
      const res = await fetch(`/api/movements/daily/day?${p}`);
      const json = (await res.json()) as DayDetail & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      setDetail(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setDetailLoading(false);
    }
  }

  function setRange(days: number) {
    const t = today();
    setTo(t);
    setFrom(shift(t, -days));
  }
  function toggleType(key: string) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const inputCls =
    "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const printParams = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("view", tab);
    return p;
  }, [params, tab]);

  return (
    <div className="space-y-5">
      {/* ── ຕົວກອງ ─────────────────────────────────────────── */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ *</label>
            <select value={whCode} onChange={(e) => { setWhCode(e.target.value); setData(null); }} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (<option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>))}
            </select>
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
              <button key={r.key} type="button" onClick={() => setRange(r.days)}
                className="rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800">
                {r.label}
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ປະເພດເອກະສານ</label>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => {
                const on = types.includes(t.key);
                return (
                  <button key={t.key} type="button" onClick={() => toggleType(t.key)}
                    className={`rounded-lg px-3 py-2.5 text-xs font-semibold ring-1 transition ${on ? "bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800" : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" onClick={load} disabled={loading || !whCode}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:opacity-50">
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດລາຍງານ"}
          </button>
          <a href={whCode ? `/api/movements/daily/export?${printParams}` : undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg ${whCode ? "" : "pointer-events-none opacity-50"}`}>
            Excel
          </a>
          <a href={whCode ? `/print/daily?${printParams}` : undefined} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg ${whCode ? "" : "pointer-events-none opacity-50"}`}>
            ເອກະສານ / ພິມ
          </a>
        </div>
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
      </section>

      {data && (
        <>
          {/* ── ສະຫຼຸບຊ່ວງ ────────────────────────────────────── */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 print:hidden">
            <Kpi label="ຍອດຍົກມາ" value={fmt(data.totals.opening)} sub={fmtDate(data.from)} />
            <Kpi label="ເປີດບິນ" value={fmt(data.totals.bill_qty)} sub={`${fmt(data.totals.bill_docs)} ໃບ`} tone="amber" />
            <Kpi label="ຮັບເຂົ້າ" value={fmt(data.totals.qty_in)} sub="ລວມທັງຊ່ວງ" tone="emerald" />
            <Kpi label="ຈ່າຍອອກ" value={fmt(data.totals.qty_out)} sub="ລວມທັງຊ່ວງ" tone="rose" />
            <Kpi label="ຍົກໄປ" value={fmt(data.totals.closing)} sub={fmtDate(data.to)} tone="navy" />
          </section>

          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800 print:hidden">
                {([["stock", "ຈຳນວນສິນຄ້າ", <PackageIcon key="a" className="h-3.5 w-3.5" />], ["bills", "ຈຳນວນໃບ", <ListIcon key="b" className="h-3.5 w-3.5" />]] as const).map(([k, label, icon]) => (
                  <button key={k} type="button" onClick={() => setTab(k)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${tab === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
                    {icon}{label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-zinc-500">{data.from} → {data.to} · {data.stock.length} ມື້</span>
            </div>

            <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              {tab === "stock" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-3 py-2.5">ວັນທີ່</th>
                      <th className="px-3 py-2.5 text-right">ຍອດຍົກມາ</th>
                      <th className="px-3 py-2.5 text-right">ເປີດບິນ</th>
                      <th className="px-3 py-2.5 text-right">ຮັບເຂົ້າ</th>
                      <th className="px-3 py-2.5 text-right">ຈ່າຍອອກ</th>
                      <th className="px-3 py-2.5 text-right">ຍົກໄປ</th>
                      <th className="px-3 py-2.5 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.stock.map((d) => [
                      <tr key={d.date} className={openDay === d.date ? "bg-brand-50/50 dark:bg-brand-950/10" : undefined}>
                        <td className="px-3 py-2.5">
                          <button type="button" onClick={() => toggleDay(d.date)} className="font-mono text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">
                            {fmtDate(d.date)} <span className="text-[10px] font-normal text-zinc-400">{dow(d.date)}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(d.opening)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-amber-600 dark:text-amber-400">
                          {fmt(d.bill_qty)}{d.bill_docs > 0 && <span className="ml-1 text-[10px] text-zinc-400">({d.bill_docs})</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{d.qty_in ? fmt(d.qty_in) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-rose-600 dark:text-rose-400">{d.qty_out ? fmt(d.qty_out) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt(d.closing)}</td>
                        <td className="px-3 py-2.5 print:hidden">
                          <ChevronRightIcon className={`h-4 w-4 text-zinc-400 transition-transform ${openDay === d.date ? "rotate-90" : ""}`} />
                        </td>
                      </tr>,
                      openDay === d.date ? <DetailRow key={`${d.date}-x`} colSpan={7} loading={detailLoading} detail={detail} /> : null,
                    ])}
                    <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/50">
                      <td className="px-3 py-2.5 text-xs">ລວມ</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(data.totals.opening)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(data.totals.bill_qty)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(data.totals.qty_in)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmt(data.totals.qty_out)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">{fmt(data.totals.closing)}</td>
                      <td className="print:hidden" />
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-3 py-2.5">ວັນທີ່</th>
                      <th className="px-3 py-2.5 text-right">ໃບຄ້າງຍົກມາ</th>
                      <th className="px-3 py-2.5 text-right">ເປີດບິນ</th>
                      <th className="px-3 py-2.5 text-right">ຈ່າຍຄົບ</th>
                      <th className="px-3 py-2.5 text-right">ຄ້າງຍົກໄປ</th>
                      <th className="px-3 py-2.5 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.bills.map((d) => [
                      <tr key={d.date} className={openDay === d.date ? "bg-brand-50/50 dark:bg-brand-950/10" : undefined}>
                        <td className="px-3 py-2.5">
                          <button type="button" onClick={() => toggleDay(d.date)} className="font-mono text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">
                            {fmtDate(d.date)} <span className="text-[10px] font-normal text-zinc-400">{dow(d.date)}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{d.carry_in}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-amber-600 dark:text-amber-400">{d.opened}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{d.closed}</td>
                        <td className={`px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${d.carry_out > d.carry_in ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                          {d.carry_out}
                        </td>
                        <td className="px-3 py-2.5 print:hidden">
                          <ChevronRightIcon className={`h-4 w-4 text-zinc-400 transition-transform ${openDay === d.date ? "rotate-90" : ""}`} />
                        </td>
                      </tr>,
                      openDay === d.date ? <DetailRow key={`${d.date}-x`} colSpan={6} loading={detailLoading} detail={detail} /> : null,
                    ])}
                    <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/50">
                      <td className="px-3 py-2.5 text-xs">ລວມ</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{data.totals.carry_in}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{data.totals.opened}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{data.totals.closed}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">{data.totals.carry_out}</td>
                      <td className="print:hidden" />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            <p className="mt-3 text-[11px] text-zinc-400">
              ⓘ ຍົກໄປ = ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ · ບໍ່ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງ (ບໍ່ແມ່ນການເຄື່ອນໄຫວຈິງ) ·
              ຄ້າງຍົກໄປ = ໃບຄ້າງຍົກມາ + ເປີດບິນ − ຈ່າຍຄົບ · ບໍ່ນັບບໍລິການ ແລະ ບິນຮັບຄືນ/ຍົກເລີກ
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

/** ລາຍລະອຽດຂອງມື້ທີ່ກົດ: ສິນຄ້າທີ່ເຄື່ອນໄຫວ ແລະ ໃບບິນທີ່ເປີດ. */
function DetailRow({ colSpan, loading, detail }: { colSpan: number; loading: boolean; detail: DayDetail | null }) {
  return (
    <tr className="bg-zinc-50/60 dark:bg-zinc-950/40">
      <td colSpan={colSpan} className="px-3 py-3">
        {loading ? (
          <div className="py-4 text-center text-xs text-zinc-400">ກຳລັງໂຫລດ...</div>
        ) : !detail ? (
          <div className="py-4 text-center text-xs text-zinc-400">ບໍ່ມີຂໍ້ມູນ</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="flex items-center gap-1.5 bg-white px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <PackageIcon className="h-3.5 w-3.5" /> ສິນຄ້າທີ່ເຄື່ອນໄຫວ ({detail.items.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase text-zinc-400 dark:bg-zinc-800/50">
                    <th className="px-3 py-1.5">ສິນຄ້າ</th>
                    <th className="px-3 py-1.5 text-right"><ArrowDownIcon className="ml-auto h-3 w-3" /></th>
                    <th className="px-3 py-1.5 text-right"><ArrowUpIcon className="ml-auto h-3 w-3" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {detail.items.slice(0, 200).map((it) => (
                    <tr key={it.item_code} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-[10px] font-bold text-zinc-600 dark:text-zinc-300">{it.item_code}</div>
                        <div className="max-w-xs truncate text-[11px] text-zinc-500" title={it.item_name ?? ""}>{it.item_name ?? "—"}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{it.qty_in ? fmt(it.qty_in) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{it.qty_out ? fmt(it.qty_out) : "—"}</td>
                    </tr>
                  ))}
                  {detail.items.length === 0 && <tr><td colSpan={3} className="bg-white px-3 py-4 text-center text-zinc-400 dark:bg-zinc-900">ບໍ່ມີການເຄື່ອນໄຫວ</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="flex items-center gap-1.5 bg-white px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <ListIcon className="h-3.5 w-3.5" /> ໃບບິນທີ່ເປີດ ({detail.bills.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase text-zinc-400 dark:bg-zinc-800/50">
                    <th className="px-3 py-1.5">ເອກະສານ</th>
                    <th className="px-3 py-1.5">ລູກຄ້າ / ຂົນສົ່ງ</th>
                    <th className="px-3 py-1.5 text-right">ຈຳນວນ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {detail.bills.slice(0, 200).map((b) => (
                    <tr key={`${b.doc_no}-${b.trans_flag}`} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-[10px] font-bold text-brand-700 dark:text-brand-400">{b.doc_no}</div>
                        <div className="text-[10px] text-zinc-400">{LABEL_BY_FLAG[b.trans_flag] ?? b.trans_flag} · {b.lines} ລາຍການ</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="max-w-[200px] truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={b.cust_name ?? ""}>{b.cust_name ?? "—"}</div>
                        {b.transport_name && <div className="text-[10px] text-zinc-400">{b.transport_name}</div>}
                        {b.note && <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{b.note}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(b.qty)}</td>
                    </tr>
                  ))}
                  {detail.bills.length === 0 && <tr><td colSpan={3} className="bg-white px-3 py-4 text-center text-zinc-400 dark:bg-zinc-900">ບໍ່ມີໃບເປີດ</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
