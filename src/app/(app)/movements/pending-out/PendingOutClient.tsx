"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertIcon, ChevronRightIcon, ListIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };

type Line = {
  doc_no: string;
  trans_flag: number;
  wh_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  issued: number;
  picking: number;
  returned: number;
  remaining: number;
  aging_days: number;
};
type Doc = {
  doc_no: string;
  trans_flag: number;
  type_label: string;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  doc_ts: string | null;
  want_date: string | null;
  aging_days: number;
  aging_seconds: number;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  transport_code: string | null;
  transport_name: string | null;
  remark: string | null;
  note: string | null;
  lines: number;
  ordered: number;
  issued: number;
  picking: number;
  returned: number;
  remaining: number;
  partial: boolean;
};
type Item = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  docs: number;
  remaining: number;
  picking: number;
  on_hand: number;
  shortfall: number;
  oldest_days: number;
  oldest_seconds: number;
};
type Kpi = {
  docs: number;
  items: number;
  remaining_qty: number;
  picking_qty: number;
  shortfall_items: number;
  overdue_docs: number;
  oldest_days: number;
  buckets: Record<string, number>;
};
type Payload = { kpi: Kpi; docs: Doc[]; items: Item[]; lines: Line[]; truncated: boolean };

/** Source-doc kinds, mirroring PENDING_OUT_TYPES on the server. */
const TYPES = [
  { key: "req", flag: 122, label: "ໃບເບີກ" },
  { key: "transfer", flag: 124, label: "ໃບໂອນ" },
  { key: "sale", flag: 44, label: "ບິນຂາຍ" },
];
const TYPE_KEY_BY_FLAG: Record<number, string> = Object.fromEntries(TYPES.map((t) => [t.flag, t.key]));

const DAY_OPTIONS = [
  { v: 30, label: "30 ມື້" },
  { v: 90, label: "90 ມື້" },
  { v: 180, label: "180 ມື້" },
  { v: 365, label: "1 ປີ" },
];

const BUCKETS = [
  { id: "0_7", label: "0–7 ມື້", max: 7, tone: "emerald" },
  { id: "8_30", label: "8–30 ມື້", max: 30, tone: "teal" },
  { id: "31_60", label: "31–60 ມື້", max: 60, tone: "amber" },
  { id: "61_90", label: "61–90 ມື້", max: 90, tone: "orange" },
  { id: "90p", label: "90+ ມື້", max: Number.POSITIVE_INFINITY, tone: "rose" },
];
const TONE: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
  rose: "text-rose-600 dark:text-rose-400",
};

function bucketOf(days: number) {
  return (BUCKETS.find((b) => days <= b.max) ?? BUCKETS[BUCKETS.length - 1]).id;
}
function fmt(v: number | null | undefined) {
  return Number.isFinite(v ?? NaN) ? (v as number).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
/** Document date + clock, e.g. "06/07/2026 14:32:05". */
function fmtStamp(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : fmtDate(s);
}
/** Waiting time to the second — "12 ມື້ 04:07:33". */
function fmtWait(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return days > 0 ? `${days} ມື້ ${clock}` : clock;
}

/** ຄ້າງເກີນ 5 ມື້ = ຊ້າເກີນໄປ — ຂຶ້ນສີແດງ ແລະ ກະພິບ. */
const ALERT_SECONDS = 5 * 86400;

/**
 * Live waiting clock: keeps counting from the value the query returned, so the
 * seconds actually move on screen instead of freezing at load time. Past the
 * 5-day mark it turns red and pulses.
 */
function WaitClock({ baseSeconds, elapsed, prefix }: { baseSeconds: number; elapsed: number; prefix?: string }) {
  const secs = baseSeconds + elapsed;
  const alert = secs >= ALERT_SECONDS;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold tabular-nums ${
        alert ? "animate-pulse text-rose-600 dark:text-rose-400" : ageTone(Math.floor(secs / 86400))
      }`}
      title={alert ? "ຄ້າງເກີນ 5 ມື້" : undefined}
    >
      {alert && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />}
      {prefix}{fmtWait(secs)}
    </span>
  );
}
/** Older = hotter, so a late document reads as late at a glance. */
function ageTone(d: number) {
  if (d > 90) return "text-rose-600 dark:text-rose-400";
  if (d > 60) return "text-orange-600 dark:text-orange-400";
  if (d > 30) return "text-amber-600 dark:text-amber-400";
  return "text-zinc-600 dark:text-zinc-300";
}

export default function PendingOutClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [days, setDays] = useState(30);
  const [types, setTypes] = useState<string[]>(TYPES.map((t) => t.key));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"docs" | "items">("docs");
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  // Seconds since this result set was loaded — added to every stored waiting time
  // so the clocks tick live. One timer for the whole table, not one per row.
  const [elapsed, setElapsed] = useState(0);
  const loadedAtRef = useRef(Date.now());

  const params = useMemo(() => {
    const p = new URLSearchParams({ days: String(days), wh: whCode });
    if (types.length > 0 && types.length < TYPES.length) p.set("type", types.join(","));
    return p;
  }, [whCode, days, types]);

  /** Same filters plus the on-screen view/search/bucket, so the document matches the screen. */
  const printParams = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("view", tab);
    if (q.trim()) p.set("q", q.trim());
    if (bucket) p.set("bucket", bucket);
    return p;
  }, [params, tab, q, bucket]);

  async function load() {
    if (!whCode) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/movements/pending-out?${params}`);
      const json = (await res.json()) as Partial<Payload> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      setData({
        kpi: json.kpi as Kpi,
        docs: json.docs ?? [],
        items: json.items ?? [],
        lines: json.lines ?? [],
        truncated: json.truncated ?? false,
      });
      setOpenDoc(null);
      loadedAtRef.current = Date.now();
      setElapsed(0);
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

  // Tick the waiting clocks once a second while a result set is on screen.
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - loadedAtRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [data]);

  function toggleType(key: string) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /** doc key → its lines, for the expandable detail row. */
  const linesByDoc = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of data?.lines ?? []) {
      const k = `${l.doc_no}|${l.trans_flag}|${l.wh_code}`;
      const arr = m.get(k);
      if (arr) arr.push(l);
      else m.set(k, [l]);
    }
    return m;
  }, [data]);

  /** A document matches the search when its own fields OR any of its items do. */
  const docsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.docs ?? []).filter((d) => {
      if (bucket && bucketOf(d.aging_days) !== bucket) return false;
      if (!s) return true;
      if (
        d.doc_no.toLowerCase().includes(s) ||
        (d.cust_name ?? "").toLowerCase().includes(s) ||
        (d.cust_code ?? "").toLowerCase().includes(s) ||
        d.wh_code.toLowerCase().includes(s)
      ) return true;
      const ls = linesByDoc.get(`${d.doc_no}|${d.trans_flag}|${d.wh_code}`) ?? [];
      return ls.some((l) => l.item_code.toLowerCase().includes(s) || (l.item_name ?? "").toLowerCase().includes(s));
    });
  }, [data, q, bucket, linesByDoc]);

  const itemsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.items ?? []).filter((it) => {
      if (bucket && bucketOf(it.oldest_days) !== bucket) return false;
      if (!s) return true;
      return it.item_code.toLowerCase().includes(s) || (it.item_name ?? "").toLowerCase().includes(s);
    });
  }, [data, q, bucket]);

  /** ໃບທີ່ຄ້າງເກີນ 5 ມື້ — ຕົວເລກທີ່ຕ້ອງຮີບຈັດການ. */
  const alertDocs = useMemo(
    () => (data?.docs ?? []).filter((d) => d.aging_seconds + elapsed >= ALERT_SECONDS).length,
    [data, elapsed],
  );

  const shownQty = useMemo(
    () =>
      tab === "docs"
        ? docsFiltered.reduce((a, d) => a + d.remaining, 0)
        : itemsFiltered.reduce((a, i) => a + i.remaining, 0),
    [tab, docsFiltered, itemsFiltered],
  );

  const inputCls =
    "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-amber-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const whName = warehouses.find((w) => w.code === whCode)?.name;
  const whLabel = whCode ? `${whCode}${whName ? ` · ${whName}` : ""}` : "—";

  return (
    <div className="space-y-5">
      {/* ── ຕົວກອງ ─────────────────────────────────────────── */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ *</label>
            <select value={whCode} onChange={(e) => { setWhCode(e.target.value); setData(null); }} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[130px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຍ້ອນຫຼັງ</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-full`}>
              {DAY_OPTIONS.map((d) => (<option key={d.v} value={d.v}>{d.label}</option>))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ປະເພດເອກະສານ</label>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => {
                const on = types.includes(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => toggleType(t.key)}
                    className={`rounded-lg px-3 py-2.5 text-xs font-semibold ring-1 transition ${on ? "bg-amber-50 text-amber-700 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800" : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading || !whCode || types.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition hover:shadow-lg disabled:opacity-50"
          >
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດລາຍງານ"}
          </button>
          <a
            href={whCode ? `/api/movements/pending-out/export?${params}` : undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg ${whCode ? "" : "pointer-events-none opacity-50"}`}
          >
            Excel
          </a>
          {/* ເປີດເປັນເອກະສານ A4 (ຫົວຈົດໝາຍ + ສະຫຼຸບ + ບ່ອນເຊັນ) ພ້ອມພິມ */}
          <a
            href={whCode ? `/print/pending-out?${printParams}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg ${whCode ? "" : "pointer-events-none opacity-50"}`}
          >
            ເອກະສານ / ພິມ
          </a>
        </div>
        {types.length === 0 && <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400">ເລືອກຢ່າງໜ້ອຍ 1 ປະເພດເອກະສານ</p>}
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
      </section>

      {data && (
        <>
          {/* ── KPI ──────────────────────────────────────────── */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ໃບຄ້າງຈ່າຍ</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt(data.kpi.docs)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ຄ້າງ &gt; 30 ມື້ · {fmt(data.kpi.overdue_docs)} ໃບ</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ຈຳນວນຄ້າງຈ່າຍ</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(data.kpi.remaining_qty)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">{fmt(data.kpi.items)} ລະຫັດສິນຄ້າ</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ສິນຄ້າຂາດ stock</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{fmt(data.kpi.shortfall_items)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ຈ່າຍບໍ່ໄດ້ດຽວນີ້ — ຕ້ອງເຕີມ stock</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ຄ້າງເກີນ 5 ມື້</div>
              <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${alertDocs > 0 ? "animate-pulse text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {fmt(alertDocs)}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ໃບ · ຄ້າງດົນສຸດ {fmt(data.kpi.oldest_days)} ມື້</div>
            </div>
          </section>

          {/* ── ໄລຍະຄ້າງ (ກົດເພື່ອກອງ) ────────────────────────── */}
          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
            <div className="mb-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300">ໄລຍະຄ້າງ (ຈຳນວນໃບ — ກົດເພື່ອກອງ)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {BUCKETS.map((b) => {
                const on = bucket === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBucket(on ? null : b.id)}
                    className={`rounded-xl px-3 py-3 text-center ring-1 transition ${on ? "bg-amber-50 ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-800" : "bg-white ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}
                  >
                    <div className={`font-mono text-2xl font-bold tabular-nums ${TONE[b.tone]}`}>{data.kpi.buckets[b.id] ?? 0}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{b.label}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── ຕາຕະລາງ (ພິມສະເພາະສ່ວນນີ້) ─────────────────────── */}
          <section className="print-sheet shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            {/* ຫົວລາຍງານ — ເຫັນສະເພາະຕອນພິມ */}
            <div className="mb-3 hidden print:block">
              <div className="text-lg font-bold">ລາຍງານສິນຄ້າຄ້າງຈ່າຍອອກສາງ ({tab === "docs" ? "ຕາມໃບເອກະສານ" : "ຕາມສິນຄ້າ"})</div>
              <div className="text-xs">
                ສາງ: {whLabel} · ຍ້ອນຫຼັງ {days} ມື້ · ປະເພດ: {TYPES.filter((t) => types.includes(t.key)).map((t) => t.label).join(", ")}
                {bucket ? ` · ໄລຍະ ${BUCKETS.find((b) => b.id === bucket)?.label}` : ""}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800 print:hidden">
                {([["docs", "ຕາມໃບເອກະສານ", <ListIcon key="a" className="h-3.5 w-3.5" />], ["items", "ຕາມສິນຄ້າ", <PackageIcon key="b" className="h-3.5 w-3.5" />]] as const).map(([k, label, icon]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${tab === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">
                  {tab === "docs" ? `${docsFiltered.length} ໃບ` : `${itemsFiltered.length} ລາຍການ`} · ຄ້າງ {fmt(shownQty)}
                </span>
                <div className="relative print:hidden">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ເລກໃບ / ລູກຄ້າ / ສິນຄ້າ..." className={`${inputCls} py-2 pl-8 text-xs`} />
                </div>
              </div>
            </div>

            {data.truncated && (
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                <AlertIcon className="h-3.5 w-3.5" /> ຂໍ້ມູນຫຼາຍເກີນ — ສະແດງບໍ່ຄົບ, ກະລຸນາຫຼຸດຊ່ວງວັນທີ່ ຫຼື ເລືອກສາງດຽວ
              </p>
            )}

            {tab === "docs" ? (
              <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-3 py-2.5">ເອກະສານ</th>
                      <th className="px-3 py-2.5">ວັນທີ່ / ຄ້າງມາແລ້ວ</th>
                      <th className="px-3 py-2.5">ລູກຄ້າ / ປາຍທາງ</th>
                      <th className="px-3 py-2.5">ຂົນສົ່ງ</th>
                      <th className="px-3 py-2.5">ສາງ</th>
                      <th className="px-3 py-2.5 text-right">ສັ່ງ</th>
                      <th className="px-3 py-2.5 text-right">ຈ່າຍແລ້ວ</th>
                      <th className="px-3 py-2.5 text-right">ຄ້າງຈ່າຍ</th>
                      <th className="px-3 py-2.5 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {docsFiltered.slice(0, 500).map((d) => {
                      const key = `${d.doc_no}|${d.trans_flag}|${d.wh_code}`;
                      const open = openDoc === key;
                      const dLines = linesByDoc.get(key) ?? [];
                      return [
                        <tr
                          key={key}
                          className={
                            open
                              ? "bg-amber-50/50 dark:bg-amber-950/10"
                              : d.aging_seconds + elapsed >= ALERT_SECONDS
                                ? "bg-rose-50/60 dark:bg-rose-950/10"
                                : undefined
                          }
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ring-zinc-200 text-zinc-600 dark:ring-zinc-700 dark:text-zinc-300">{d.type_label}</span>
                              <button type="button" onClick={() => setOpenDoc(open ? null : key)} className="font-mono text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400">
                                {d.doc_no}
                              </button>
                            </div>
                            <div className="mt-0.5 text-[11px] text-zinc-400">
                              {d.lines} ລາຍການ{d.partial ? " · ຈ່າຍບາງສ່ວນແລ້ວ" : ""}{d.picking > 0.0001 ? ` · ຢູ່ໃບເກັບ ${fmt(d.picking)}` : ""}{d.returned > 0.0001 ? ` · ຮັບຄືນ ${fmt(d.returned)}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-[11px] text-zinc-500">{fmtStamp(d.doc_ts) === "—" ? fmtDate(d.doc_date) : fmtStamp(d.doc_ts)}</div>
                            {/* ຄ້າງມາແລ້ວ ນັບເຖິງວິນາທີ — ຢູ່ຫ້ອງດຽວກັບວັນທີ່, ເດີນເວລາຈິງ */}
                            <div><WaitClock baseSeconds={d.aging_seconds} elapsed={elapsed} prefix="ຄ້າງ " /></div>
                            {d.want_date && <div className="text-[10px] text-zinc-400">ຕ້ອງການ {fmtDate(d.want_date)}</div>}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="max-w-[260px] truncate text-xs text-zinc-700 dark:text-zinc-300" title={d.cust_name ?? ""}>{d.cust_name ?? d.cust_code ?? "—"}</div>
                            {d.sale_name && <div className="text-[10px] text-zinc-400">{d.sale_name}</div>}
                            {/* ໝາຍເຫດພະນັກງານ (remark_4) — ບອກເຫດຜົນທີ່ຍັງຈ່າຍບໍ່ໄດ້ ເຊັ່ນ ເຄື່ອງໝົດ */}
                            {d.note && (
                              <div className="mt-0.5 inline-block max-w-[260px] truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900" title={d.note}>
                                {d.note}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="max-w-[150px] truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={d.transport_name ?? ""}>{d.transport_name ?? "—"}</div>
                            {d.transport_code && <div className="font-mono text-[10px] text-zinc-400">{d.transport_code}</div>}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-500">{d.wh_code}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(d.ordered)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(d.issued)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(d.remaining)}</td>
                          <td className="px-3 py-2.5 print:hidden">
                            <Link
                              href={`/movements/issue?type=${TYPE_KEY_BY_FLAG[d.trans_flag] ?? "req"}&wh=${encodeURIComponent(d.wh_code)}&doc=${encodeURIComponent(d.doc_no)}`}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              ຈ່າຍອອກ<ChevronRightIcon className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>,
                        open ? (
                          <tr key={`${key}-lines`} className="bg-zinc-50/60 dark:bg-zinc-950/40">
                            <td colSpan={9} className="px-3 py-3">
                              <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-white text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
                                      <th className="px-3 py-2">ສິນຄ້າ</th>
                                      <th className="px-3 py-2 text-right">ສັ່ງ</th>
                                      <th className="px-3 py-2 text-right">ຈ່າຍແລ້ວ</th>
                                      <th className="px-3 py-2 text-right">ຢູ່ໃບເກັບ</th>
                                      <th className="px-3 py-2 text-right">ຮັບຄືນ</th>
                                      <th className="px-3 py-2 text-right">ຄ້າງຈ່າຍ</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {dLines.map((l) => (
                                      <tr key={`${key}-${l.item_code}`} className="bg-white dark:bg-zinc-900">
                                        <td className="px-3 py-2">
                                          <div className="font-mono text-[11px] font-bold text-zinc-600 dark:text-zinc-300">{l.item_code}</div>
                                          <div className="max-w-lg truncate text-[11px] text-zinc-500" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-500">{fmt(l.ordered)}</td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(l.issued)}</td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-500">{fmt(l.picking)}</td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-aqua-600 dark:text-aqua-400">{l.returned ? fmt(l.returned) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                          {fmt(l.remaining)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                    {docsFiltered.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-zinc-400">ບໍ່ມີໃບຄ້າງຈ່າຍ</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-3 py-2.5">ສິນຄ້າ</th>
                      <th className="px-3 py-2.5 text-right">ຈຳນວນໃບ</th>
                      <th className="px-3 py-2.5 text-right">ຄ້າງຈ່າຍ</th>
                      <th className="px-3 py-2.5 text-right">stock ໃນສາງ</th>
                      <th className="px-3 py-2.5 text-right">ຂາດ</th>
                      <th className="px-3 py-2.5 text-right">ຄ້າງດົນສຸດ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {itemsFiltered.slice(0, 1000).map((it) => (
                      <tr
                        key={it.item_code}
                        className={
                          it.oldest_seconds + elapsed >= ALERT_SECONDS
                            ? "bg-rose-50/60 dark:bg-rose-950/10"
                            : it.shortfall > 0.0001
                              ? "bg-amber-50/40 dark:bg-amber-950/10"
                              : undefined
                        }
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">{it.item_code}</div>
                          <div className="max-w-lg truncate text-xs text-zinc-700 dark:text-zinc-300" title={it.item_name ?? ""}>{it.item_name ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{it.docs}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                          {fmt(it.remaining)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{it.unit_code}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{fmt(it.on_hand)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${it.shortfall > 0.0001 ? "text-rose-600 dark:text-rose-400" : "text-zinc-300 dark:text-zinc-600"}`}>
                          {it.shortfall > 0.0001 ? fmt(it.shortfall) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right"><WaitClock baseSeconds={it.oldest_seconds} elapsed={elapsed} /></td>
                      </tr>
                    ))}
                    {itemsFiltered.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-zinc-400">ບໍ່ມີສິນຄ້າຄ້າງຈ່າຍ</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-3 text-[11px] text-zinc-400 print:hidden">
              ⓘ ຄ້າງຈ່າຍ = ຈຳນວນສັ່ງ (ຫັກຍົກເລີກ) − ຈ່າຍອອກແລ້ວ − ຈຳນວນທີ່ຢູ່ໃນໃບເກັບທີ່ຍັງບໍ່ຢືນຢັນ ·
              ຄ້າງມາແລ້ວ ນັບແຕ່ເວລາສ້າງໃບ ເດີນເວລາຈິງທຸກວິນາທີ · <span className="font-semibold text-rose-600 dark:text-rose-400">ສີແດງກະພິບ = ຄ້າງເກີນ 5 ມື້</span> ·
              ບໍ່ນັບບໍລິການ (ລະຫັດຂຶ້ນຕົ້ນດ້ວຍ 9, notcount) ແລະ ຫັກຈຳນວນທີ່ອອກໃບຮັບຄືນ (CN) ແລ້ວ.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
