"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "@/components/ui/Icons";
import { WarehouseGroup } from "@/components/ui/WarehouseGroup";
import { DataList } from "@/components/ui/DataList";

export type WarehouseOption = { code: string; name: string | null };

type Buckets = { d0_30: number; d31_60: number; d61_90: number; d91_180: number; d180: number };
type Kpi = { total_items: number; total_qty: number; idle90_items: number; idle90_qty: number; buckets: Buckets };
type Row = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  wms: string;
  last_out: string | null;
  last_in: string | null;
  days_idle: number | null;
};

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
function bucketOf(d: number) {
  if (d <= 30) return "0_30";
  if (d <= 60) return "31_60";
  if (d <= 90) return "61_90";
  if (d <= 180) return "91_180";
  return "180";
}
const BUCKET_DEF: { key: keyof Buckets; id: string; label: string; tone: string }[] = [
  { key: "d0_30", id: "0_30", label: "0–30 ມື້", tone: "emerald" },
  { key: "d31_60", id: "31_60", label: "31–60", tone: "teal" },
  { key: "d61_90", id: "61_90", label: "61–90", tone: "amber" },
  { key: "d91_180", id: "91_180", label: "91–180", tone: "orange" },
  { key: "d180", id: "180", label: "180+ ມື້", tone: "rose" },
];
const TONE: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
  rose: "text-rose-600 dark:text-rose-400",
};

type WhAging = { code: string; name: string | null; kpi: Kpi | null; rows: Row[]; err: string | null };

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-amber-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

export default function AgingClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [results, setResults] = useState<WhAging[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<string | null>(null);

  /** ບໍ່ມີການເລືອກສາງ — ກວດທຸກສາງທີ່ມີສິດ ແລ້ວສະແດງເປັນກຸ່ມຕໍ່ສາງ. */
  async function load() {
    setLoading(true);
    try {
      const all = await Promise.all(
        warehouses.map(async (w): Promise<WhAging> => {
          try {
            const res = await fetch(`/api/movements/aging?wh=${encodeURIComponent(w.code)}`);
            const data = (await res.json()) as { kpi?: Kpi; rows?: Row[]; error?: string };
            if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
            return { code: w.code, name: w.name, kpi: data.kpi ?? null, rows: data.rows ?? [], err: null };
          } catch (e) {
            return { code: w.code, name: w.name, kpi: null, rows: [], err: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" };
          }
        }),
      );
      setResults(all);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <div className={`${inputCls} flex w-full items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{warehouses.length}</span>
            </div>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ກອງສິນຄ້າ..." className={`${inputCls} py-2 pl-8 text-xs`} />
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition hover:shadow-lg disabled:opacity-50">
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດສິນຄ້າຄ້າງ"}
          </button>
        </div>
      </section>

      {results.map((r) => (
        <WarehouseGroup key={r.code} code={r.code} name={r.name} tone="amber">
          <WhAgingBlock r={r} q={q} bucket={bucket} setBucket={setBucket} />
        </WarehouseGroup>
      ))}
    </div>
  );
}

/** KPI + ໄລຍະຄ້າງ + ຕາຕະລາງ ຂອງສາງໜຶ່ງ. */
function WhAgingBlock({ r, q, bucket, setBucket }: { r: WhAging; q: string; bucket: string | null; setBucket: (b: string | null) => void }) {
  const { kpi, rows } = r;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((x) => {
      if (bucket && bucketOf(x.days_idle ?? 0) !== bucket) return false;
      if (s && !x.item_code.toLowerCase().includes(s) && !(x.item_name ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, q, bucket]);

  if (r.err) return <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{r.err}</p>;
  if (!kpi) return <p className="text-xs text-zinc-400">ກຳລັງກວດ...</p>;

  return (
    <div className="space-y-5">
      {kpi && (
        <>
          {/* KPI */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ສິນຄ້າມີ stock</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{kpi.total_items.toLocaleString("en-US")}</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ຄ້າງ &gt; 90 ມື້</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{kpi.idle90_items.toLocaleString("en-US")}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">{kpi.total_items > 0 ? Math.round((kpi.idle90_items / kpi.total_items) * 100) : 0}% ຂອງສິນຄ້າ</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ຈຳນວນຄ້າງ &gt;90 ມື້</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(kpi.idle90_qty)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ໜ່ວຍ (ທຶນຈົມ)</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">stock ລວມ</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt(kpi.total_qty)}</div>
            </div>
          </section>

          {/* aging buckets (clickable filter) */}
          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300">ໄລຍະຄ້າງ (ກົດເພື່ອກອງ)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {BUCKET_DEF.map((b) => {
                const n = kpi.buckets[b.key];
                const isActive = bucket === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBucket(isActive ? null : b.id)}
                    className={`rounded-xl px-3 py-3 text-center ring-1 transition ${isActive ? "bg-amber-50 ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-800" : "bg-white ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:ring-zinc-800"}`}
                  >
                    <div className={`font-mono text-2xl font-bold tabular-nums ${TONE[b.tone]}`}>{n}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{b.label}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* table */}
          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {bucket ? `ໄລຍະ ${BUCKET_DEF.find((b) => b.id === bucket)?.label}` : "ທັງໝົດ"} · {filtered.length} ລາຍການ
              </div>
            </div>
            {/* ≥md ເປັນຕາຕະລາງເຕັມ, <md ກາຍເປັນບັດລະລາຍການ — ຫົວໜ້າຍັງໄດ້
                ຂໍ້ມູນຄົບເທິງຄອມ ແລະ ຄົນເປີດເທິງມືຖືບໍ່ຕ້ອງເລື່ອນຊ້າຍຂວາ. */}
            <DataList
              rows={filtered.slice(0, 500)}
              rowKey={(r) => r.item_code}
              empty="ບໍ່ມີສິນຄ້າໃນໄລຍະນີ້"
              columns={[
                {
                  header: "ສິນຄ້າ",
                  card: "title",
                  cell: (r) => (
                    <>
                      <div className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">{r.item_code}</div>
                      <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.item_name ?? ""}>{r.item_name ?? "—"}</div>
                    </>
                  ),
                },
                {
                  header: "ຄ້າງ (ມື້)",
                  align: "right",
                  card: "value",
                  cell: (r) => {
                    const d = r.days_idle ?? 0;
                    const tone = d > 180 ? "text-rose-600 dark:text-rose-400" : d > 90 ? "text-orange-600 dark:text-orange-400" : d > 60 ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300";
                    return <span className={`font-mono font-bold tabular-nums ${tone}`}>{d.toLocaleString("en-US")}</span>;
                  },
                },
                {
                  header: "stock",
                  align: "right",
                  cell: (r) => (
                    <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                      {fmt(r.wms)}
                      <span className="ml-1 text-[10px] uppercase text-zinc-400">{r.unit_code}</span>
                    </span>
                  ),
                },
                {
                  header: "ຈ່າຍອອກລ່າສຸດ",
                  cell: (r) =>
                    r.last_out ? (
                      <span className="font-mono text-[11px] text-zinc-500">{fmtDate(r.last_out)}</span>
                    ) : (
                      <span className="text-rose-500">ບໍ່ເຄີຍຈ່າຍ</span>
                    ),
                },
                {
                  header: "ຮັບລ່າສຸດ",
                  cell: (r) => <span className="font-mono text-[11px] text-zinc-500">{fmtDate(r.last_in)}</span>,
                },
              ]}
            />
            <p className="mt-3 text-[11px] text-zinc-400">ⓘ "ຄ້າງ (ມື້)" = ມື້ນັບແຕ່ຈ່າຍອອກລ່າສຸດ; ຖ້າບໍ່ເຄີຍຈ່າຍ = ນັບແຕ່ຮັບເຂົ້າຄັ້ງທຳອິດ. ສິນຄ້າ 180+ ມື້ = ຄວນພິຈາລະນາລະບາຍ/ຫຼຸດລາຄາ.</p>
          </section>
        </>
      )}
    </div>
  );
}
