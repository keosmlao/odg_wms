"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  AbcClass,
  CoverageItem,
  CoverageStatus,
  DemandPattern,
  DemandTrend,
  WarehouseSummary,
} from "@/lib/coverage";

/** ປ້າຍ ABC — A ຄືກຸ່ມທີ່ສ້າງມູນຄ່າຂາຍ 80% ທຳອິດ. */
const ABC_CHIP: Record<AbcClass, string> = {
  A: "bg-brand-500 text-white",
  B: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  C: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  none: "bg-transparent text-zinc-300 dark:text-zinc-600",
};

/** ໄອຄອນ + ສີ ຂອງແນວໂນ້ມ. */
const TREND_VIEW: Record<DemandTrend, { icon: string; cls: string; label: string }> = {
  rising: { icon: "▲", cls: "text-emerald-600 dark:text-emerald-400", label: "ຂາຍດີຂຶ້ນ" },
  flat: { icon: "=", cls: "text-zinc-400", label: "ຄົງທີ່" },
  falling: { icon: "▼", cls: "text-amber-600 dark:text-amber-400", label: "ຫຼຸດລົງ" },
  stopped: { icon: "■", cls: "text-red-600 dark:text-red-400", label: "ເຊົາຂາຍ" },
  none: { icon: "", cls: "text-zinc-300", label: "ບໍ່ຂາຍ" },
};

const PATTERN_VIEW: Record<DemandPattern, { label: string; cls: string; hint: string }> = {
  steady: {
    label: "ສະໝ່ຳສະເໝີ",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    hint: "ຂາຍຢ່າງໜ້ອຍ 1 ໃນ 4 ມື້ — ຄ່າສະເລ່ຍຕໍ່ມື້ເຊື່ອຖືໄດ້",
  },
  intermittent: {
    label: "ຂາດໆ",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    hint: "ຂາຍເປັນຊ່ວງ — ໃຊ້ຄ່າສະເລ່ຍຢ່າງລະມັດລະວັງ",
  },
  single: {
    label: "ຂາຍເທື່ອດຽວ",
    cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    hint: "ຂາຍພຽງມື້ດຽວໃນຊ່ວງນີ້ — ຢ່າໃຊ້ຄ່າສະເລ່ຍວາງແຜນ",
  },
  none: { label: "ບໍ່ຂາຍ", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800", hint: "ບໍ່ມີການຂາຍໃນຊ່ວງ" },
};

export type WarehouseOption = { code: string; name: string | null };

type Thresholds = { critical: number; low: number; over: number };

type ApiResult = {
  days: number;
  thresholds: Thresholds;
  warehouse: WarehouseSummary | null;
  items: CoverageItem[];
  error?: string;
};

/** ຜົນຂອງໜຶ່ງສາງໃນໜ້າຈໍ — ລວມສະຖານະການໂຫຼດ ເພື່ອສະແດງເທື່ອລະສາງ. */
type WhResult = {
  code: string;
  name: string | null;
  state: "loading" | "done" | "error";
  summary: WarehouseSummary | null;
  items: CoverageItem[];
  error?: string;
};

/**
 * ຍິງເທື່ອລະ `limit` ວຽກ — ຄ່າເລີ່ມຕົ້ນ 1 ຄື **ຍິງເທື່ອລະສາງ**.
 *
 * ບໍ່ແມ່ນຄວາມລະມັດລະວັງເກີນເຫດ: ວັດແທ້ກັບ 5 ສາງ (1203 + ໂພນສະອາດ) — ຍິງເທື່ອລະ
 * ສາງໃຊ້ 8.2 ວິນາທີ ແຕ່ຍິງເທື່ອລະ 2 ສາງໃຊ້ 16.9 ວິນາທີ ເພາະການຄິດຄົງເຫຼືອ ERP
 * ກິນ CPU ຂອງ DB ຢູ່ແລ້ວ ການຍິງພ້ອມກັນຈຶ່ງມີແຕ່ແຍ່ງກັນ. ຍິງເທື່ອລະສາງຍັງກິນ
 * connection ຂອງ pool ໜ້ອຍກວ່າ ຈຶ່ງບໍ່ໄປລົບກວນຜູ້ໃຊ້ຄົນອື່ນຂອງລະບົບ.
 */
async function pool<T>(jobs: (() => Promise<T>)[], limit = 1): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      await jobs[i]();
    }
  });
  await Promise.all(runners);
}

/** ລຳດັບການສະແດງ + ສີ ຂອງແຕ່ລະສະຖານະ (ຮ້າຍແຮງສຸດກ່ອນ). */
const STATUS_VIEW: {
  key: CoverageStatus;
  label: string;
  hint: string;
  dot: string;
  chip: string;
}[] = [
  { key: "out", label: "ໝົດ", hint: "ຂາຍຢູ່ ແຕ່ບໍ່ມີຂອງ — ເສຍໂອກາດຂາຍທັນທີ", dot: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900" },
  { key: "critical", label: "ວິກິດ", hint: "ພໍໃຊ້ບໍ່ເຖິງຂີດວິກິດ — ຕ້ອງເຕີມດ່ວນ", dot: "bg-orange-500", chip: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900" },
  { key: "low", label: "ສ່ຽງ", hint: "ພໍໃຊ້ບໍ່ເຖິງຂີດຕ່ຳ — ຄວນສັ່ງເພີ່ມ", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900" },
  { key: "ok", label: "ພຽງພໍ", hint: "ຢູ່ໃນຊ່ວງທີ່ເໝາະສົມ", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900" },
  { key: "over", label: "ເກີນ", hint: "ພໍໃຊ້ດົນເກີນຂີດ — ເງິນຈົມຢູ່ໃນສາງ", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900" },
  { key: "idle", label: "ບໍ່ເຄື່ອນໄຫວ", hint: "ມີຂອງ ແຕ່ບໍ່ມີການຂາຍເລີຍໃນຊ່ວງ", dot: "bg-zinc-400", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700" },
  { key: "negative", label: "ຕິດລົບ", hint: "ຄົງເຫຼືອຕິດລົບ — ຂໍ້ມູນຜິດ ຕ້ອງກວດ", dot: "bg-fuchsia-500", chip: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:ring-fuchsia-900" },
];

const VIEW_BY_STATUS = new Map(STATUS_VIEW.map((s) => [s.key, s]));

const inputCls =
  "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

function fmt(v: number, digits = 0) {
  return Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "0";
}

/** ຫຍໍ້ເງິນກີບ ໃຫ້ອ່ານໄວ (ລ້ານ / ພັນ). */
function money(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} ຕື້`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} ລ້ານ`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} ພັນ`;
  return fmt(v);
}

/** ໂຊນຂອງລະຫັດສາງ — ໃຊ້ເຮັດປຸ່ມເລືອກໄວ. */
const ZONES: { prefix: string; label: string }[] = [
  { prefix: "11", label: "ຂົວຫຼວງ" },
  { prefix: "12", label: "ດອນຕີ້ວ" },
  { prefix: "13", label: "ໂພນສະອາດ" },
  { prefix: "14", label: "ປາກເຊ" },
];

export default function CoverageClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const codes = useMemo(() => warehouses.map((w) => w.code), [warehouses]);

  /**
   * ບໍ່ເລືອກສາງໃຫ້ລ່ວງໜ້າ ແລະ ບໍ່ແລ່ນເອງຕອນເປີດໜ້າ.
   *
   * ການວິເຄາະສາງໜຶ່ງໃຊ້ 3–6 ວິນາທີ (ຄິດຄົງເຫຼືອ ERP) — ຖ້າຕັ້ງຄ່າເລີ່ມຕົ້ນເປັນ
   * ຫຼາຍສາງ ຄົນທີ່ຫາກໍ່ເປີດໜ້າຈະຖືກບັງຄັບໃຫ້ລໍຜົນທີ່ຕົນເອງອາດບໍ່ໄດ້ຢາກເບິ່ງ.
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [critical, setCritical] = useState(7);
  const [low, setLow] = useState(14);
  const [over, setOver] = useState(60);

  /** ລວມສາງທີ່ເລືອກເປັນກຸ່ມດຽວ — ເໝາະເມື່ອສາງເຫຼົ່ານັ້ນຢູ່ບ່ອນດຽວກັນ. */
  const [grouped, setGrouped] = useState(false);

  const [results, setResults] = useState<WhResult[]>([]);
  const [shownThresholds, setShownThresholds] = useState<Thresholds>({ critical, low, over });
  const [shownDays, setShownDays] = useState(days);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** tab ທີ່ກຳລັງເປີດ — `null` = ເອົາອັນທຳອິດ. */
  const [activeTab, setActiveTab] = useState<string | null>(null);

  /**
   * ຕົວກອງຕາຕະລາງ ຢູ່ລະດັບນີ້ ບໍ່ແມ່ນໃນ panel — ສະຫຼັບ tab ແລ້ວຄ່າກອງບໍ່ຫາຍ
   * ຈຶ່ງທຽບສາງຕໍ່ສາງດ້ວຍເງື່ອນໄຂດຽວກັນໄດ້ (ເຊັ່ນ ເບິ່ງສະເພາະ "ໝົດ" ທຸກສາງ).
   */
  const [fStatus, setFStatus] = useState<CoverageStatus | "all">("all");
  const [fq, setFq] = useState("");
  const [fSort, setFSort] = useState<SortKey>("risk");
  const [fAbc, setFAbc] = useState<AbcClass | "all">("all");
  const [fPattern, setFPattern] = useState<DemandPattern | "all">("all");
  const [fTrend, setFTrend] = useState<DemandTrend | "all">("all");

  const active = results.find((r) => r.code === activeTab) ?? results[0] ?? null;
  const activeCode = active?.code ?? null;
  const setActive = (code: string) => setActiveTab(code);

  async function load(refresh = false) {
    if (selected.length === 0) {
      setErr("ກະລຸນາເລືອກສາງຢ່າງໜ້ອຍ 1 ສາງ");
      return;
    }
    setLoading(true);
    setErr(null);
    setShownDays(days);
    setShownThresholds({ critical, low, over });

    const nameOf = (c: string) => warehouses.find((w) => w.code === c)?.name ?? null;
    // ລວມກຸ່ມ = ຄຳຮ້ອງດຽວທີ່ມີຫຼາຍລະຫັດ; ແຍກສາງ = ຄຳຮ້ອງລະສາງ
    const order = grouped
      ? [selected.slice().sort().join(",")]
      : selected.slice().sort();
    setResults(
      order.map((code) => ({
        code,
        name: grouped ? `ລວມ ${selected.length} ສາງ` : nameOf(code),
        state: "loading",
        summary: null,
        items: [],
      })),
    );

    const patch = (code: string, next: Partial<WhResult>) =>
      setResults((prev) => prev.map((r) => (r.code === code ? { ...r, ...next } : r)));

    try {
      await pool(
        order.map((code) => async () => {
          const p = new URLSearchParams({
            wh: code,
            days: String(days),
            critical: String(critical),
            low: String(low),
            over: String(over),
            ...(refresh ? { refresh: "1" } : {}),
          });
          try {
            const res = await fetch(`/api/movements/coverage?${p}`);
            const json = (await res.json()) as ApiResult;
            if (!res.ok) {
              patch(code, { state: "error", error: json.error ?? "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" });
              return;
            }
            patch(code, {
              state: "done",
              summary: json.warehouse,
              items: json.items,
              // ຊື່ຈິງຈາກ server (ໂໝດລວມກຸ່ມ ຈະເປັນລາຍຊື່ສາງທັງໝົດ) — ໃຊ້ເປັນ tooltip ຂອງ tab
              name: json.warehouse?.wh_name ?? null,
            });
          } catch {
            patch(code, { state: "error", error: "ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້" });
          }
        }),
      );
    } finally {
      setLoading(false);
    }
  }

  const toggle = (code: string) =>
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  const zones = ZONES.filter((z) => codes.some((c) => c.startsWith(z.prefix)));

  return (
    <div className="space-y-4">
      {/* ── ຕົວກອງ ─────────────────────────────────────────────── */}
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            {zones.map((z) => (
              <button
                key={z.prefix}
                type="button"
                onClick={() => setSelected(codes.filter((c) => c.startsWith(z.prefix)))}
                className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-bold text-zinc-600 transition hover:bg-brand-50 hover:text-brand-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {z.label}
              </button>
            ))}
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-bold text-zinc-500 transition hover:bg-red-50 hover:text-red-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                ລ້າງ ({selected.length})
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {warehouses.map((w) => {
              const on = selected.includes(w.code);
              return (
                <button
                  key={w.code}
                  type="button"
                  onClick={() => toggle(w.code)}
                  title={w.name ?? ""}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition ${
                    on
                      ? "bg-brand-500 text-white ring-brand-500"
                      : "bg-white text-zinc-600 ring-zinc-200 hover:ring-brand-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                  }`}
                >
                  <span className="font-mono">{w.code}</span>
                  <span className="ml-1.5 hidden max-w-[9rem] truncate align-middle sm:inline-block">
                    {w.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ລວມກຸ່ມ ຫຼື ແຍກສາງ — ຄົນລະຄຳຖາມ ຈຶ່ງໃຫ້ເລືອກຢ່າງຊັດເຈນ */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ມຸມມອງ</span>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px] dark:bg-zinc-800">
            {([[false, "ແຍກສາງ"], [true, "ລວມເປັນກຸ່ມດຽວ"]] as [boolean, string][]).map(([v, l]) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setGrouped(v)}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  grouped === v
                    ? "bg-white text-brand-600 shadow-sm dark:bg-zinc-950 dark:text-brand-400"
                    : "text-zinc-500"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {grouped && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              ບວກຄົງເຫຼືອ ແລະ ຍອດຂາຍຂອງ {selected.length} ສາງເຂົ້າກັນ ແລ້ວຄິດໃໝ່ —
              ຂອງທີ່ໝົດຢູ່ສາງໜຶ່ງ ແຕ່ນອນຢູ່ອີກສາງໜຶ່ງ ຈະບໍ່ຖືວ່າຂາດ
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="ຊ່ວງຂາຍຍ້ອນຫຼັງ">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={inputCls}
            >
              {[30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d} ວັນ</option>
              ))}
            </select>
          </Field>
          <Field label="ວິກິດ ຕ່ຳກວ່າ (ວັນ)">
            <input type="number" min={1} value={critical}
              onChange={(e) => setCritical(Number(e.target.value))}
              className={`${inputCls} w-24`} />
          </Field>
          <Field label="ສ່ຽງ ຕ່ຳກວ່າ (ວັນ)">
            <input type="number" min={1} value={low}
              onChange={(e) => setLow(Number(e.target.value))}
              className={`${inputCls} w-24`} />
          </Field>
          <Field label="ເກີນ ສູງກວ່າ (ວັນ)">
            <input type="number" min={1} value={over}
              onChange={(e) => setOver(Number(e.target.value))}
              className={`${inputCls} w-24`} />
          </Field>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
          >
            {loading ? "ກຳລັງວິເຄາະ..." : "ວິເຄາະ"}
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            title="ຂ້າມ cache — ດຶງຍອດສົດຈາກ ERP ໃໝ່ (ຊ້າກວ່າ)"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:ring-brand-300 disabled:opacity-50 dark:text-zinc-300 dark:ring-zinc-800"
          >
            ໂຫຼດໃໝ່
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          ວັນທີ່ພໍໃຊ້ = ຄົງເຫຼືອ ÷ ຍອດຂາຍສະເລ່ຍຕໍ່ມື້ (ຈາກບິນຂາຍຈິງ ຫັກໃບຮັບຄືນ).
          ຄົງເຫຼືອໃຊ້ຍອດ ERP ເພາະການຂາຍເປັນເຫດການຝັ່ງ ERP.
        </p>
      </section>

      {err && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
          {err}
        </div>
      )}

      {/* ── ແຖບສາງ (tab) ─────────────────────────────────────────── */}
      {/* ຍັງບໍ່ໄດ້ວິເຄາະ — ບອກສິ່ງທີ່ຕ້ອງເຮັດ ແທນທີ່ຈະປະໜ້າຫວ່າງ */}
      {results.length === 0 && !loading && !err && (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            ເລືອກສາງທີ່ຢາກວິເຄາະ ແລ້ວກົດ “ວິເຄາະ”
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            ເລືອກຫຼາຍສາງໄດ້ · ສາງທີ່ຢູ່ບ່ອນດຽວກັນ ຄວນເລືອກ “ລວມເປັນກຸ່ມດຽວ”
            {" · "}ແຕ່ລະສາງໃຊ້ເວລາ 3–6 ວິນາທີໃນຄັ້ງທຳອິດ
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-px dark:border-zinc-800">
          {results.map((r) => {
            const on = r.code === activeCode;
            const risky = r.summary
              ? r.summary.counts.out + r.summary.counts.critical + r.summary.counts.low
              : 0;
            return (
              <button
                key={r.code}
                type="button"
                onClick={() => setActive(r.code)}
                title={r.name ?? r.code}
                className={`-mb-px flex shrink-0 items-center gap-2 rounded-t-xl border-b-2 px-3.5 py-2.5 text-left transition ${
                  on
                    ? "border-brand-500 bg-white text-brand-600 dark:bg-zinc-900 dark:text-brand-400"
                    : "border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-300"
                }`}
              >
                <span className="font-mono text-[12px] font-black">
                  {/* ໂໝດລວມກຸ່ມ: ລະຫັດຕໍ່ກັນຍາວເກີນ ຈຶ່ງສະແດງເປັນຈຳນວນສາງແທນ */}
                  {r.code.includes(",") ? `${r.code.split(",").length} ສາງ` : r.code}
                </span>
                <span className="hidden max-w-[10rem] truncate text-[11px] sm:inline">
                  {r.name}
                </span>
                {r.state === "loading" && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500" />
                )}
                {r.state === "error" && <span className="text-[11px] text-red-500">!</span>}
                {r.state === "done" && risky > 0 && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-700 dark:bg-red-950/60 dark:text-red-300">
                    {risky}
                  </span>
                )}
                {r.state === "done" && risky === 0 && r.summary && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {active &&
        (active.state === "loading" ? (
          <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງວິເຄາະ...</div>
        ) : active.state === "error" ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
            {active.error}
          </div>
        ) : active.summary ? (
          <WarehousePanel
            warehouses={warehouses}
            summary={active.summary}
            items={active.items}
            days={shownDays}
            thresholds={shownThresholds}
            status={fStatus}
            setStatus={setFStatus}
            q={fq}
            setQ={setFq}
            sort={fSort}
            setSort={setFSort}
            abc={fAbc}
            setAbc={setFAbc}
            pattern={fPattern}
            setPattern={setFPattern}
            trend={fTrend}
            setTrend={setFTrend}
          />
        ) : (
          <div className="py-12 text-center text-sm text-zinc-400">
            ບໍ່ມີຄົງເຫຼືອ ແລະ ບໍ່ມີການຂາຍໃນຊ່ວງນີ້
          </div>
        ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

/** ຄຳຕັດສິນລວມຂອງສາງ — ອີງໃສ່ອັດຕາທີ່ໃຫ້ບໍລິການໄດ້. */
function verdict(rate: number, selling: number) {
  if (selling === 0)
    return { text: "ບໍ່ມີການຂາຍໃນຊ່ວງນີ້", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
  if (rate >= 0.9)
    return { text: "ພຽງພໍສຳລັບການຂາຍ", tone: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300" };
  if (rate >= 0.75)
    return { text: "ພໍໄດ້ ແຕ່ມີຈຸດສ່ຽງ", tone: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300" };
  return { text: "ບໍ່ພຽງພໍ — ຕ້ອງເຕີມ", tone: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300" };
}

type SortKey = "risk" | "shortfall" | "sold" | "cover" | "excess";

function WarehousePanel({
  warehouses,
  summary,
  items,
  days,
  thresholds,
  status,
  setStatus,
  q,
  setQ,
  sort,
  setSort,
  abc,
  setAbc,
  pattern,
  setPattern,
  trend,
  setTrend,
}: {
  warehouses: WarehouseOption[];
  summary: WarehouseSummary;
  items: CoverageItem[];
  days: number;
  thresholds: { critical: number; low: number; over: number };
  status: CoverageStatus | "all";
  setStatus: (s: CoverageStatus | "all") => void;
  q: string;
  setQ: (v: string) => void;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  abc: AbcClass | "all";
  setAbc: (v: AbcClass | "all") => void;
  pattern: DemandPattern | "all";
  setPattern: (v: DemandPattern | "all") => void;
  trend: DemandTrend | "all";
  setTrend: (v: DemandTrend | "all") => void;
}) {
  /** ຕາຕະລາງ ຫຼື ຕົ້ນໄມ້ຕາມໝວດສິນຄ້າ. */
  const [view, setView] = useState<"table" | "tree">("table");
  const [treeLevels, setTreeLevels] = useState<TreeLevelKey[]>([
    "group_name",
    "group_sub_name",
    "brand_name",
  ]);
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());

  /** ລາຍການທີ່ຕິກໄວ້ເພື່ອສ້າງໃບຂໍໂອນ. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (code: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const v = verdict(summary.service_rate, summary.selling_items);
  const risky = summary.counts.out + summary.counts.critical + summary.counts.low;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank: Record<CoverageStatus, number> = {
      out: 0, critical: 1, low: 2, negative: 3, ok: 4, over: 5, idle: 6,
    };
    const filtered = items.filter((i) => {
      if (status !== "all" && i.status !== status) return false;
      if (abc !== "all" && i.abc !== abc) return false;
      if (pattern !== "all" && i.pattern !== pattern) return false;
      if (trend !== "all" && i.trend !== trend) return false;
      if (!needle) return true;
      return (
        i.item_code.toLowerCase().includes(needle) ||
        (i.item_name ?? "").toLowerCase().includes(needle) ||
        (i.brand_name ?? "").toLowerCase().includes(needle)
      );
    });
    /**
     * "ຕ້ອງເຕີມ" ແລະ "ເງິນຈົມ" **ກອງນຳ ບໍ່ແມ່ນຮຽງຢ່າງດຽວ**.
     *
     * ຖ້າຮຽງຢ່າງດຽວ ລາຍການທີ່ບໍ່ຕ້ອງເຕີມ (ລວມທັງຕົວທີ່ເກີນ) ຈະຍັງລອຍຢູ່ໃນ
     * ບັນຊີ ພຽງແຕ່ຢູ່ລຸ່ມ — ຄົນເລືອກ "ຕ້ອງເຕີມ" ຕ້ອງການເຫັນສະເພາະຕົວທີ່ຕ້ອງເຕີມ.
     */
    const relevant = filtered.filter((i) => {
      if (sort === "shortfall") return i.shortfall > 0;
      if (sort === "excess") return i.excess > 0;
      return true;
    });

    const cmp: Record<SortKey, (a: CoverageItem, b: CoverageItem) => number> = {
      risk: (a, b) => rank[a.status] - rank[b.status] || b.shortfall * b.avg_cost - a.shortfall * a.avg_cost,
      shortfall: (a, b) => b.shortfall * b.avg_cost - a.shortfall * a.avg_cost,
      sold: (a, b) => b.sold - a.sold,
      cover: (a, b) => (a.days_cover ?? Infinity) - (b.days_cover ?? Infinity),
      excess: (a, b) => b.excess * b.avg_cost - a.excess * a.avg_cost,
    };
    return [...relevant].sort(cmp[sort]).slice(0, 300);
  }, [items, status, q, sort, abc, pattern, trend]);

  /**
   * ຕົ້ນໄມ້ໃຊ້ຜົນທີ່ **ກອງແລ້ວ ແຕ່ບໍ່ຕັດ 300 ແຖວ** — ຕົວເລກສະຫຼຸບຂອງແຕ່ລະໝວດ
   * ຕ້ອງນັບຄົບ ບໍ່ດັ່ງນັ້ນຍອດຂອງໝວດຈະໜ້ອຍກວ່າຄວາມຈິງແບບງຽບໆ.
   */
  const tree = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = items.filter((i) => {
      if (status !== "all" && i.status !== status) return false;
      if (abc !== "all" && i.abc !== abc) return false;
      if (pattern !== "all" && i.pattern !== pattern) return false;
      if (trend !== "all" && i.trend !== trend) return false;
      if (sort === "shortfall" && i.shortfall <= 0) return false;
      if (sort === "excess" && i.excess <= 0) return false;
      if (!needle) return true;
      return (
        i.item_code.toLowerCase().includes(needle) ||
        (i.item_name ?? "").toLowerCase().includes(needle) ||
        (i.brand_name ?? "").toLowerCase().includes(needle)
      );
    });
    return buildTree(base, treeLevels);
  }, [items, status, q, sort, abc, pattern, trend, treeLevels]);

  return (
    <div className="space-y-4">
      {/* ── ຄຳຕັດສິນ + KPI ─────────────────────────────────────── */}
      <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {/* ຫົວບອກວ່າກຳລັງເບິ່ງສາງ/ກຸ່ມໃດ — tab ຢູ່ເທິງອາດຖືກເລື່ອນພົ້ນຕາໄປ */}
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-2.5 dark:border-zinc-800">
          <span className="rounded-lg bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-black text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            {summary.wh_code}
          </span>
          <span className="truncate text-sm font-extrabold text-zinc-800 dark:text-zinc-100">
            {summary.wh_name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-xl px-3 py-1.5 text-sm font-black ${v.tone}`}>{v.text}</span>
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
            ໃຫ້ບໍລິການໄດ້{" "}
            <b className="font-mono text-zinc-800 dark:text-zinc-100">
              {(summary.service_rate * 100).toFixed(0)}%
            </b>{" "}
            ຂອງສິນຄ້າທີ່ຂາຍຢູ່ ({fmt(summary.selling_items)} ລາຍການ, ຊ່ວງ {days} ວັນ)
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kard label="ຕ້ອງເຕີມດ່ວນ" value={fmt(risky)} unit="ລາຍການ" tone="rose" />
          <Kard label="ມູນຄ່າທີ່ຕ້ອງເຕີມ" value={money(summary.shortfall_value)} unit="ກີບ" tone="rose" />
          <Kard label="ເກີນ / ບໍ່ເຄື່ອນໄຫວ" value={fmt(summary.counts.over + summary.counts.idle)} unit="ລາຍການ" tone="navy" />
          <Kard label="ເງິນຈົມ (ເກີນຂີດ)" value={money(summary.excess_value)} unit="ກີບ" tone="navy" />
        </div>

        <StatusBar counts={summary.counts} total={summary.items} onPick={setStatus} active={status} />

        {/* ຄວາມສອດຄ່ອງ WMS ↔ ERP: ຖ້າຫ່າງກັນຫຼາຍ ຕົວເລກຂ້າງເທິງເຊື່ອໄດ້ໜ້ອຍລົງ */}
        {summary.sync_gap_ratio > 0.1 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
            <b>ບັນຊີ WMS ກັບ ERP ບໍ່ກົງກັນ {(summary.sync_gap_ratio * 100).toFixed(0)}%</b> —
            ຄົງເຫຼືອ ERP {fmt(summary.on_hand_total)} ແຕ່ WMS {fmt(summary.wms_on_hand_total)}.
            ໜ້ານີ້ຄິດຈາກຄົງເຫຼືອ ERP; ສ່ວນຕ່າງນີ້ໝາຍວ່າການເຄື່ອນໄຫວບາງສ່ວນຂອງສາງນີ້
            ບໍ່ໄດ້ບັນທຶກຜ່ານ WMS ຈຶ່ງຄວນກວດສອບກ່ອນຕັດສິນໃຈສັ່ງຊື້.
          </div>
        )}
      </div>

      {/* ── ຕາຕະລາງລາຍການ ──────────────────────────────────────── */}
      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              ລາຍການ
              <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
                ({fmt(shown.length)}{shown.length === 300 ? "+" : ""} ຈາກ {fmt(items.length)})
              </span>
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* ຕາຕະລາງ ຫຼື ຕົ້ນໄມ້ຕາມໝວດສິນຄ້າ */}
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px] dark:bg-zinc-800">
              {([["table", "ຕາຕະລາງ"], ["tree", "ຕົ້ນໄມ້ໝວດ"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    view === k
                      ? "bg-white text-brand-600 shadow-sm dark:bg-zinc-950 dark:text-brand-400"
                      : "text-zinc-500"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            {view === "tree" && (
              <select
                value={treeLevels.join(">")}
                onChange={(e) => setTreeLevels(e.target.value.split(">") as TreeLevelKey[])}
                title="ຈັດຊັ້ນຕາມ"
                className={`${inputCls} py-1.5 text-[12px]`}
              >
                <option value="group_name>group_sub_name>brand_name">ໝວດໃຫຍ່ › ໝວດຍ່ອຍ › ຍີ່ຫໍ້</option>
                <option value="group_name>group_sub_name>group_sub2_name>brand_name">ໝວດໃຫຍ່ › ຍ່ອຍ › ຍ່ອຍ2 › ຍີ່ຫໍ້</option>
                <option value="group_name>group_sub_name>group_sub2_name">ໝວດໃຫຍ່ › ຍ່ອຍ › ຍ່ອຍ2</option>
                <option value="brand_name">ຍີ່ຫໍ້ ຢ່າງດຽວ</option>
                <option value="brand_name>group_sub_name">ຍີ່ຫໍ້ › ໝວດຍ່ອຍ</option>
              </select>
            )}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່ / ຍີ່ຫໍ້"
              className={`${inputCls} w-44 py-1.5 text-[12px]`}
            />
            <select
              value={abc}
              onChange={(e) => setAbc(e.target.value as AbcClass | "all")}
              title="ຈັດກຸ່ມຕາມມູນຄ່າຂາຍ: A = 80% ທຳອິດ, B = ຮອດ 95%, C = ທີ່ເຫຼືອ"
              className={`${inputCls} py-1.5 text-[12px]`}
            >
              <option value="all">ABC ທັງໝົດ</option>
              <option value="A">A (ສຳຄັນສຸດ)</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="none">ບໍ່ມີຍອດຂາຍ</option>
            </select>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value as DemandPattern | "all")}
              title="ຮູບແບບການຂາຍ — ‘ຂາຍເທື່ອດຽວ’ ຢ່າໃຊ້ຄ່າສະເລ່ຍວາງແຜນ"
              className={`${inputCls} py-1.5 text-[12px]`}
            >
              <option value="all">ຮູບແບບທັງໝົດ</option>
              <option value="steady">ສະໝ່ຳສະເໝີ</option>
              <option value="intermittent">ຂາດໆ</option>
              <option value="single">ຂາຍເທື່ອດຽວ</option>
              <option value="none">ບໍ່ຂາຍ</option>
            </select>
            <select
              value={trend}
              onChange={(e) => setTrend(e.target.value as DemandTrend | "all")}
              title="ຊ່ວງຫຼ້າສຸດ ທຽບ ຊ່ວງກ່ອນໜ້າ"
              className={`${inputCls} py-1.5 text-[12px]`}
            >
              <option value="all">ແນວໂນ້ມທັງໝົດ</option>
              <option value="rising">ຂາຍດີຂຶ້ນ ▲</option>
              <option value="flat">ຄົງທີ່ =</option>
              <option value="falling">ຫຼຸດລົງ ▼</option>
              <option value="stopped">ເຊົາຂາຍ ■</option>
            </select>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px] dark:bg-zinc-800">
              {([
                ["risk", "ຮ້າຍແຮງ"],
                ["shortfall", "ຕ້ອງເຕີມ"],
                ["cover", "ວັນນ້ອຍ"],
                ["sold", "ຂາຍຫຼາຍ"],
                ["excess", "ເງິນຈົມ"],
              ] as [SortKey, string][]).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    sort === k
                      ? "bg-white text-brand-600 shadow-sm dark:bg-zinc-950 dark:text-brand-400"
                      : "text-zinc-500"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {picked.size > 0 && (
          <TransferBar
            summary={summary}
            picked={[...picked]
              .map((c) => items.find((i) => i.item_code === c))
              .filter((i): i is CoverageItem => Boolean(i))}
            warehouses={warehouses}
            onClear={() => setPicked(new Set())}
            onRemove={(code) =>
              setPicked((s) => {
                const n = new Set(s);
                n.delete(code);
                return n;
              })
            }
          />
        )}

        {view === "tree" ? (
          <div className="max-h-[70vh] overflow-y-auto">
            {tree.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-400">ບໍ່ມີລາຍການ</div>
            ) : (
              tree.map((n) => (
                <TreeRow
                  key={n.key}
                  node={n}
                  open={openNodes}
                  onToggle={(k) =>
                    setOpenNodes((s) => {
                      const x = new Set(s);
                      if (x.has(k)) x.delete(k);
                      else x.add(k);
                      return x;
                    })
                  }
                  onPick={(list) =>
                    setPicked((s) => new Set([...s, ...list.map((i) => i.item_code)]))
                  }
                />
              ))
            )}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                <th className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    title="ເລືອກທັງໝົດທີ່ເຫັນ"
                    className="h-3.5 w-3.5 accent-brand-500"
                    checked={shown.length > 0 && shown.every((i) => picked.has(i.item_code))}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? new Set([...picked, ...shown.map((i) => i.item_code)])
                          : new Set([...picked].filter((c) => !shown.some((i) => i.item_code === c))),
                      )
                    }
                  />
                </th>
                <th className="px-3 py-2.5">ສະຖານະ</th>
                <th className="px-3 py-2.5">ສິນຄ້າ</th>
                <th className="px-3 py-2.5 text-right">ຄົງເຫຼືອ</th>
                <th className="px-3 py-2.5 text-right">ຂາຍ {days} ວັນ</th>
                <th className="px-3 py-2.5 text-right">ສະເລ່ຍ/ມື້</th>
                <th className="px-3 py-2.5 text-right">ວັນທີ່ພໍໃຊ້</th>
                <th className="px-3 py-2.5 text-right">ຕ້ອງເຕີມ</th>
                <th className="px-3 py-2.5 text-right">WMS ຕ່າງ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-zinc-400">
                    ບໍ່ມີລາຍການ
                  </td>
                </tr>
              )}
              {shown.map((i) => {
                const sv = VIEW_BY_STATUS.get(i.status);
                return (
                  <tr
                    key={i.item_code}
                    className={`transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${
                      picked.has(i.item_code) ? "bg-brand-50/60 dark:bg-brand-950/20" : ""
                    }`}
                  >
                    <td className="px-2 py-2.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-brand-500"
                        checked={picked.has(i.item_code)}
                        onChange={() => togglePick(i.item_code)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${sv?.chip ?? ""}`}
                        title={sv?.hint}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${sv?.dot ?? ""}`} />
                        {sv?.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {i.abc !== "none" && (
                          <span
                            title={`ກຸ່ມ ${i.abc} — ມູນຄ່າຂາຍ ${money(i.sale_amount)} ກີບ`}
                            className={`rounded px-1.5 py-0.5 text-[9px] font-black ${ABC_CHIP[i.abc]}`}
                          >
                            {i.abc}
                          </span>
                        )}
                        <span className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">
                          {i.item_code}
                        </span>
                      </div>
                      <div
                        className="max-w-sm truncate text-[13px] text-zinc-700 dark:text-zinc-300"
                        title={i.item_name ?? ""}
                      >
                        {i.item_name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {i.pattern !== "none" && (
                          <span
                            title={PATTERN_VIEW[i.pattern].hint}
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${PATTERN_VIEW[i.pattern].cls}`}
                          >
                            {PATTERN_VIEW[i.pattern].label}
                          </span>
                        )}
                        {i.last_sale && (
                          <span className="text-[10px] text-zinc-400">
                            ຂາຍລ່າສຸດ {i.last_sale} · {i.bills} ບິນ / {i.sale_days} ມື້
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-800 dark:text-zinc-100">
                      {fmt(i.on_hand, 2)}
                      <span className="ml-1 text-[10px] text-zinc-400">{i.unit_code}</span>
                      {/* ຕອນລວມກຸ່ມ: ບອກວ່າຍອດນີ້ນອນຢູ່ສາງໃດແດ່ */}
                      {i.by_wh && i.by_wh.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap justify-end gap-1">
                          {i.by_wh
                            .filter((b) => b.on_hand !== 0)
                            .sort((a, b) => b.on_hand - a.on_hand)
                            .map((b) => (
                              <span
                                key={b.wh_code}
                                title={`ສາງ ${b.wh_code}: ຄົງເຫຼືອ ${fmt(b.on_hand, 2)} · ຂາຍ ${fmt(b.sold, 2)}`}
                                className="rounded bg-zinc-100 px-1 py-0.5 text-[9px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                              >
                                {b.wh_code}:{fmt(b.on_hand, 0)}
                              </span>
                            ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                      {i.sold > 0 ? fmt(i.sold, 2) : "—"}
                      {/* ແນວໂນ້ມ: ຊ່ວງຫຼ້າສຸດ ທຽບ ຊ່ວງກ່ອນ */}
                      {i.trend !== "none" && (
                        <div
                          className={`text-[10px] font-bold ${TREND_VIEW[i.trend].cls}`}
                          title={`${TREND_VIEW[i.trend].label} — ຫຼ້າສຸດ ${fmt(i.recent_qty, 2)} ທຽບ ກ່ອນໜ້າ ${fmt(i.prior_qty, 2)}`}
                        >
                          {TREND_VIEW[i.trend].icon} {TREND_VIEW[i.trend].label}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">
                      {i.avg_daily > 0 ? i.avg_daily.toFixed(2) : "—"}
                      {/* ຄ່າຈາກຊ່ວງຫຼ້າສຸດ — ຕ່າງກັນຫຼາຍ = ຄ່າສະເລ່ຍທັງຊ່ວງເຊື່ອບໍ່ໄດ້ */}
                      {i.recent_avg_daily !== i.avg_daily && i.sold > 0 && (
                        <div className="text-[10px] text-zinc-400" title="ຂາຍຕໍ່ມື້ ຄິດຈາກຊ່ວງຫຼ້າສຸດເທົ່ານັ້ນ">
                          ຫຼ້າສຸດ {i.recent_avg_daily.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums">
                      {i.days_cover === null ? (
                        <span className="text-zinc-300 dark:text-zinc-600">∞</span>
                      ) : (
                        <span
                          className={
                            i.days_cover < thresholds.critical
                              ? "text-red-600 dark:text-red-400"
                              : i.days_cover < thresholds.low
                                ? "text-amber-600 dark:text-amber-400"
                                : i.days_cover > thresholds.over
                                  ? "text-sky-600 dark:text-sky-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {fmt(i.days_cover, 1)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {i.shortfall > 0 ? (
                        <>
                          <span className="font-bold text-red-600 dark:text-red-400">
                            {fmt(i.shortfall, 2)}
                          </span>
                          {i.avg_cost > 0 && (
                            <div className="text-[10px] text-zinc-400">
                              {money(i.shortfall * i.avg_cost)}
                            </div>
                          )}
                        </>
                      ) : i.excess > 0 ? (
                        <span className="text-[11px] text-sky-600 dark:text-sky-400">
                          ເກີນ {fmt(i.excess, 0)}
                        </span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums">
                      {Math.abs(i.sync_gap) < 0.001 ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (
                        <span
                          className="text-amber-600 dark:text-amber-400"
                          title={`WMS ${fmt(i.wms_on_hand, 2)} · ERP ${fmt(i.on_hand, 2)}`}
                        >
                          {i.sync_gap > 0 ? "+" : ""}
                          {fmt(i.sync_gap, 2)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </div>
  );
}

/** ຊັ້ນຂອງຕົ້ນໄມ້ໝວດສິນຄ້າ ຕາມ ic_inventory. */
const TREE_LEVELS = [
  { key: "group_name", label: "ໝວດໃຫຍ່" },
  { key: "group_sub_name", label: "ໝວດຍ່ອຍ" },
  { key: "group_sub2_name", label: "ໝວດຍ່ອຍ 2" },
  { key: "brand_name", label: "ຍີ່ຫໍ້" },
] as const;

type TreeLevelKey = (typeof TREE_LEVELS)[number]["key"];

type TreeNode = {
  key: string;
  label: string;
  depth: number;
  items: CoverageItem[];
  children: TreeNode[];
};

/** ຈັດເປັນຕົ້ນໄມ້ຕາມຊັ້ນທີ່ເລືອກ — ບໍ່ມີຄ່າ = ຈັດເຂົ້າ "(ບໍ່ລະບຸ)". */
function buildTree(items: CoverageItem[], levels: TreeLevelKey[], depth = 0): TreeNode[] {
  if (depth >= levels.length) return [];
  const key = levels[depth];
  const buckets = new Map<string, CoverageItem[]>();
  for (const it of items) {
    const v = (it[key] ?? "").toString().trim() || "(ບໍ່ລະບຸ)";
    const arr = buckets.get(v);
    if (arr) arr.push(it);
    else buckets.set(v, [it]);
  }
  return [...buckets.entries()]
    .map(([label, group]) => ({
      key: `${depth}|${label}`,
      label,
      depth,
      items: group,
      children: buildTree(group, levels, depth + 1),
    }))
    // ໝວດທີ່ຕ້ອງເຕີມມູນຄ່າສູງສຸດຢູ່ເທິງ — ບ່ອນທີ່ຄວນເບິ່ງກ່ອນ
    .sort((a, b) => sumShortfall(b.items) - sumShortfall(a.items));
}

const sumShortfall = (items: CoverageItem[]) =>
  items.reduce((s, i) => s + i.shortfall * i.avg_cost, 0);

/** ນັບສະຖານະຂອງກຸ່ມໜຶ່ງ. */
function countStatuses(items: CoverageItem[]) {
  let out = 0, critical = 0, low = 0, over = 0, idle = 0;
  for (const i of items) {
    if (i.status === "out") out++;
    else if (i.status === "critical") critical++;
    else if (i.status === "low") low++;
    else if (i.status === "over") over++;
    else if (i.status === "idle") idle++;
  }
  return { out, critical, low, over, idle };
}

/** ໜຶ່ງແຖວຂອງຕົ້ນໄມ້ — ພັບ/ຄີ່ໄດ້ ພ້ອມສະຫຼຸບຂອງກຸ່ມ. */
function TreeRow({
  node,
  open,
  onToggle,
  onPick,
}: {
  node: TreeNode;
  open: Set<string>;
  onToggle: (k: string) => void;
  onPick: (items: CoverageItem[]) => void;
}) {
  const isOpen = open.has(node.key);
  const c = countStatuses(node.items);
  const need = sumShortfall(node.items);
  const risky = c.out + c.critical + c.low;

  return (
    <>
      <div
        className="flex cursor-pointer items-center gap-2 border-b border-zinc-100 py-2 pr-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
        style={{ paddingLeft: `${node.depth * 18 + 12}px` }}
        onClick={() => onToggle(node.key)}
      >
        <span className="w-3 shrink-0 text-[10px] text-zinc-400">
          {node.children.length > 0 || node.items.length > 0 ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span
          className={`truncate text-[13px] ${node.depth === 0 ? "font-bold text-zinc-800 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}
          title={node.label}
        >
          {node.label}
        </span>
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500 dark:bg-zinc-800">
          {node.items.length}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px]">
          {risky > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-black text-red-700 dark:bg-red-950/60 dark:text-red-300">
              ຕ້ອງເຕີມ {risky}
            </span>
          )}
          {c.over + c.idle > 0 && (
            <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              ເກີນ/ນອນ {c.over + c.idle}
            </span>
          )}
          {need > 0 && (
            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
              {money(need)} ກີບ
            </span>
          )}
          {risky > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPick(node.items.filter((i) => i.shortfall > 0));
              }}
              className="rounded-md bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-brand-600"
            >
              ຕິກທັງໝວດ
            </button>
          )}
        </span>
      </div>

      {isOpen &&
        (node.children.length > 0 ? (
          node.children.map((ch) => (
            <TreeRow key={ch.key} node={ch} open={open} onToggle={onToggle} onPick={onPick} />
          ))
        ) : (
          // ຊັ້ນລຸ່ມສຸດ — ສະແດງລາຍການສິນຄ້າ
          <div style={{ paddingLeft: `${(node.depth + 1) * 18 + 12}px` }}>
            {node.items.slice(0, 100).map((i) => (
              <div
                key={i.item_code}
                className="flex items-center gap-2 border-b border-zinc-50 py-1.5 pr-3 text-[12px] dark:border-zinc-800/60"
              >
                <span className="font-mono text-[10px] font-bold text-brand-600 dark:text-brand-400">
                  {i.item_code}
                </span>
                <span className="truncate text-zinc-600 dark:text-zinc-400" title={i.item_name ?? ""}>
                  {i.item_name}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500">
                  ມີ {fmt(i.on_hand, 0)}
                </span>
                {i.shortfall > 0 && (
                  <span className="shrink-0 font-mono text-[11px] font-bold text-rose-600 dark:text-rose-400">
                    ຕ້ອງເຕີມ {fmt(i.shortfall, 0)}
                  </span>
                )}
              </div>
            ))}
            {node.items.length > 100 && (
              <div className="py-1.5 text-[11px] text-zinc-400">
                … ອີກ {node.items.length - 100} ລາຍການ (ໃຊ້ມຸມມອງຕາຕະລາງເພື່ອເບິ່ງທັງໝົດ)
              </div>
            )}
          </div>
        ))}
    </>
  );
}

/**
 * ແຖບ "ເອົາລາຍການທີ່ຕິກ ໄປສ້າງໃບຂໍໂອນ (124)".
 *
 * ປາຍທາງ = ສາງທີ່ກຳລັງເບິ່ງ. ໃນໂໝດລວມກຸ່ມ ລະຫັດເປັນຫຼາຍສາງຕໍ່ກັນ ຈຶ່ງ**ຕ້ອງ
 * ໃຫ້ເລືອກວ່າຈະໃຫ້ຂອງລົງສາງໃດ** — ໃບຂໍໂອນໜຶ່ງໃບມີປາຍທາງດຽວເທົ່ານັ້ນ.
 *
 * ຈຳນວນຕັ້ງຕົ້ນຄື `shortfall` (ຂາດອີກເທົ່າໃດຈຶ່ງພໍໃຊ້ເຖິງຂີດຕ່ຳ) ປັດຂຶ້ນເປັນ
 * ຈຳນວນເຕັມ — ໃບຂໍໂອນຂອງຈິງບໍ່ຂໍເປັນເສດ — ແຕ່ **ຜູ້ໃຊ້ແກ້ໄດ້ທຸກແຖວ** ກ່ອນສ້າງ
 * ແລະ ຕັ້ງເປັນ 0 ເພື່ອຂ້າມແຖວນັ້ນກໍ່ໄດ້.
 */
function TransferBar({
  summary,
  picked,
  warehouses,
  onClear,
  onRemove,
}: {
  summary: WarehouseSummary;
  picked: CoverageItem[];
  warehouses: WarehouseOption[];
  onClear: () => void;
  onRemove: (code: string) => void;
}) {
  // ໂໝດລວມກຸ່ມ: `wh_code` ເປັນ "1301+1302+…" ຈຶ່ງບໍ່ແມ່ນສາງດຽວ
  const destChoices = summary.wh_code.includes("+")
    ? summary.wh_code.split("+")
    : [summary.wh_code];
  const [to, setTo] = useState(destChoices[0]);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * ຈຳນວນທີ່ຜູ້ໃຊ້ພິມແກ້ເອງ — ເກັບແຕ່ **ຕົວທີ່ຖືກແກ້** ສ່ວນທີ່ເຫຼືອຄິດຈາກ
   * `shortfall` ສົດໆ. ເຮັດແບບນີ້ຈຶ່ງບໍ່ຕ້ອງ sync state ເມື່ອຕິກລາຍການເພີ່ມ
   * ຫຼື ເມື່ອຜົນວິເຄາະໂຫຼດໃໝ່.
   */
  const [edited, setEdited] = useState<Record<string, number>>({});
  const qtyOf = (i: CoverageItem) =>
    edited[i.item_code] ?? Math.ceil(i.shortfall > 0 ? i.shortfall : 0);

  const lines = picked
    .map((i) => ({ item: i, qty: qtyOf(i) }))
    .filter((l) => l.qty > 0);
  const skipped = picked.length - lines.length;
  const totalValue = lines.reduce((s, l) => s + l.qty * l.item.avg_cost, 0);

  async function create() {
    if (!from) return setMsg({ ok: false, text: "ກະລຸນາເລືອກສາງຕົ້ນທາງ" });
    if (from === to) return setMsg({ ok: false, text: "ຕົ້ນທາງ ແລະ ປາຍທາງ ຕ້ອງຕ່າງກັນ" });
    if (lines.length === 0) return setMsg({ ok: false, text: "ລາຍການທີ່ຕິກ ບໍ່ມີຈຳນວນທີ່ຕ້ອງເຕີມ" });

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/movements/transfer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_from: from,
          wh_to: to,
          remark: "ຈາກໜ້າວິເຄາະຄວາມພຽງພໍ",
          lines: lines.map((l) => ({
            item_code: l.item.item_code,
            item_name: l.item.item_name,
            unit_code: l.item.unit_code,
            qty: l.qty,
          })),
        }),
      });
      const json = (await res.json()) as { doc_no?: string; error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "ສ້າງໃບຂໍໂອນບໍ່ສຳເລັດ" });
      } else {
        setMsg({ ok: true, text: `ສ້າງໃບຂໍໂອນແລ້ວ ${json.doc_no ?? ""} (${lines.length} ລາຍການ)` });
        onClear();
      }
    } catch {
      setMsg({ ok: false, text: "ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້" });
    } finally {
      setBusy(false);
    }
  }

  const sel =
    "rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="border-b border-brand-100 bg-brand-50/70 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
      {/* ── ລາຍການທີ່ຈະຂໍໂອນ ພ້ອມຈຳນວນ (ແກ້ໄດ້) ─────────────────── */}
      <div className="mb-3 overflow-hidden rounded-xl bg-white ring-1 ring-brand-200 dark:bg-zinc-900 dark:ring-brand-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <span className="text-[12px] font-bold text-zinc-700 dark:text-zinc-200">
            ລາຍການທີ່ຈະຂໍໂອນ
            <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
              {lines.length} ລາຍການ · ປະມານ {money(totalValue)} ກີບ
            </span>
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-semibold text-zinc-500 underline-offset-2 hover:underline"
          >
            ລ້າງທັງໝົດ
          </button>
        </div>

        <div className="max-h-56 overflow-y-auto">
          {picked.map((i) => {
            const q = qtyOf(i);
            return (
              <div
                key={i.item_code}
                className={`flex items-center gap-2 border-b border-zinc-50 px-3 py-1.5 last:border-0 dark:border-zinc-800/60 ${
                  q <= 0 ? "opacity-45" : ""
                }`}
              >
                <span className="font-mono text-[10px] font-bold text-brand-600 dark:text-brand-400">
                  {i.item_code}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[12px] text-zinc-700 dark:text-zinc-300"
                  title={i.item_name ?? ""}
                >
                  {i.item_name}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-400" title="ຄົງເຫຼືອປັດຈຸບັນ">
                  ມີ {fmt(i.on_hand, 0)}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={q}
                  onChange={(e) =>
                    setEdited((s) => ({
                      ...s,
                      [i.item_code]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  title="ຈຳນວນທີ່ຈະຂໍ — ແກ້ໄດ້"
                  className="w-20 shrink-0 rounded-lg bg-white px-2 py-1 text-right font-mono text-[12px] font-bold text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700"
                />
                <span className="w-10 shrink-0 text-[10px] text-zinc-400">{i.unit_code}</span>
                <button
                  type="button"
                  onClick={() => onRemove(i.item_code)}
                  title="ເອົາອອກຈາກລາຍການ"
                  className="shrink-0 rounded px-1.5 text-[13px] font-bold text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[11px] text-zinc-500">ຈາກສາງ</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)} className={sel}>
          <option value="">— ເລືອກຕົ້ນທາງ —</option>
          {warehouses
            .filter((w) => !destChoices.includes(w.code))
            .map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} {w.name}
              </option>
            ))}
        </select>
        <span className="text-[11px] text-zinc-500">ໄປສາງ</span>
        {destChoices.length > 1 ? (
          <select value={to} onChange={(e) => setTo(e.target.value)} className={sel}>
            {destChoices.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <span className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-[12px] font-bold ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
            {to}
          </span>
        )}
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "ກຳລັງສ້າງ..." : `ສ້າງໃບຂໍໂອນ (${lines.length})`}
        </button>
      </div>

      {skipped > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          ຂ້າມ {skipped} ລາຍການ ທີ່ຈຳນວນເປັນ 0 — ພິມຈຳນວນໃສ່ ຖ້າຢາກໃຫ້ຢູ່ໃນໃບ
        </p>
      )}
      {msg && (
        <p
          className={`mt-1.5 text-[11px] font-semibold ${
            msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

/** ແຖບສັດສ່ວນສະຖານະ — ກົດເພື່ອກອງຕາຕະລາງລຸ່ມ. */
function StatusBar({
  counts,
  total,
  onPick,
  active,
}: {
  counts: Record<CoverageStatus, number>;
  total: number;
  onPick: (s: CoverageStatus | "all") => void;
  active: CoverageStatus | "all";
}) {
  const safe = Math.max(1, total);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {STATUS_VIEW.map((s) =>
          counts[s.key] > 0 ? (
            <div
              key={s.key}
              className={s.dot}
              style={{ width: `${(counts[s.key] / safe) * 100}%` }}
              title={`${s.label}: ${counts[s.key]}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onPick("all")}
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 transition ${
            active === "all"
              ? "bg-zinc-800 text-white ring-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white text-zinc-500 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800"
          }`}
        >
          ທັງໝົດ {total}
        </button>
        {STATUS_VIEW.map((s) =>
          counts[s.key] > 0 ? (
            <button
              key={s.key}
              type="button"
              onClick={() => onPick(active === s.key ? "all" : s.key)}
              title={s.hint}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 transition ${s.chip} ${
                active === s.key ? "scale-105 shadow-sm" : "opacity-80 hover:opacity-100"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label} {counts[s.key]}
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Kard({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: "zinc" | "emerald" | "rose" | "navy";
}) {
  const t = {
    zinc: "text-zinc-700 dark:text-zinc-200",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
    navy: "text-brand-600 dark:text-brand-400",
  }[tone];
  return (
    <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-100 dark:bg-zinc-950/40 dark:ring-zinc-800">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${t}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}
