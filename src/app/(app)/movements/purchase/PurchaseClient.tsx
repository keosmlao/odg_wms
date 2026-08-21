"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { RebalanceResult, UnmetLine } from "@/lib/rebalance";
import type { AbcClass } from "@/lib/coverage";

export type WarehouseOption = { code: string; name: string | null };

const inputCls =
  "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

const ABC_CHIP: Record<AbcClass, string> = {
  A: "bg-brand-500 text-white",
  B: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  C: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  none: "bg-transparent text-zinc-300",
};

const URGENCY: Record<UnmetLine["urgency"], { label: string; chip: string }> = {
  out: { label: "ໝົດ", chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900" },
  critical: { label: "ວິກິດ", chip: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900" },
  low: { label: "ສ່ຽງ", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900" },
};

const ZONES = [
  { prefix: "11", label: "ຂົວຫຼວງ" },
  { prefix: "12", label: "ດອນຕີ້ວ" },
  { prefix: "13", label: "ໂພນສະອາດ" },
  { prefix: "14", label: "ປາກເຊ" },
];

function fmt(v: number, digits = 0) {
  return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: digits }) : "0";
}
function money(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} ຕື້`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} ລ້ານ`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} ພັນ`;
  return fmt(v);
}

export default function PurchaseClient({ warehouses }: { warehouses: WarehouseOption[] }) {

  // ບໍ່ເລືອກສາງໃຫ້ລ່ວງໜ້າ ແລະ ບໍ່ແລ່ນເອງ — ເບິ່ງເຫດຜົນທີ່ CoverageClient
  const [need, setNeed] = useState<string[]>([]);
  const [have, setHave] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [target, setTarget] = useState(21);
  const [keep, setKeep] = useState(30);
  const [group, setGroup] = useState(true);

  const [data, setData] = useState<RebalanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [abcFilter, setAbcFilter] = useState<AbcClass | "all">("all");
  const [q, setQ] = useState("");

  async function load() {
    if (need.length === 0) {
      setErr("ກະລຸນາເລືອກສາງທີ່ຕ້ອງການຕື່ມ");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({
        // ໃຊ້ API ດຽວກັນກັບໜ້າໂອນ — `unmet` ຄືສິ່ງທີ່ໂອນບໍ່ໄດ້ ຈຶ່ງຕ້ອງຊື້
        from: (have.length > 0 ? have : need).join(","),
        to: need.join(","),
        days: String(days),
        target: String(target),
        keep: String(keep),
        ...(group ? { group: "1" } : {}),
      });
      const res = await fetch(`/api/movements/rebalance?${p}`);
      const json = (await res.json()) as RebalanceResult & { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ");
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setErr("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.unmet.filter((u) => {
      if (abcFilter !== "all" && u.abc !== abcFilter) return false;
      if (!needle) return true;
      return (
        u.item_code.toLowerCase().includes(needle) ||
        (u.item_name ?? "").toLowerCase().includes(needle) ||
        (u.brand_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, abcFilter, q]);

  const totals = useMemo(() => {
    const value = rows.reduce((s, r) => s + r.order_value, 0);
    const a = rows.filter((r) => r.abc === "A");
    return {
      lines: rows.length,
      value,
      aLines: a.length,
      aValue: a.reduce((s, r) => s + r.order_value, 0),
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <WhPicker label="ສາງທີ່ຕ້ອງການຕື່ມ" all={warehouses} value={need} onChange={setNeed} tone="emerald" />
          <WhPicker label="ຫັກຂອງທີ່ມີຢູ່ໃນສາງເຫຼົ່ານີ້ກ່ອນ" all={warehouses} value={have} onChange={setHave} tone="amber" />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="ຊ່ວງຂາຍຍ້ອນຫຼັງ">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
              {[30, 60, 90, 180, 365].map((d) => (<option key={d} value={d}>{d} ວັນ</option>))}
            </select>
          </Field>
          <Field label="ຢາກໃຫ້ພໍໃຊ້ (ວັນ)">
            <input type="number" min={1} value={target}
              onChange={(e) => setTarget(Number(e.target.value))} className={`${inputCls} w-24`} />
          </Field>
          <Field label="ສາງອື່ນເຫຼືອໄວ້ (ວັນ)">
            <input type="number" min={0} value={keep}
              onChange={(e) => setKeep(Number(e.target.value))} className={`${inputCls} w-24`} />
          </Field>
          <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)}
              className="h-4 w-4 accent-brand-500" />
            ຄິດສາງປາຍທາງລວມກັນ
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
          >
            {loading ? "ກຳລັງຄິດ..." : "ຄິດໃບສະເໜີ"}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          ສັ່ງຊື້ = ຄວາມຕ້ອງການເພື່ອໃຫ້ພໍໃຊ້ {target} ວັນ <b>ຫັກ</b> ຂອງທີ່ໂອນມາຈາກສາງອື່ນໄດ້ແລ້ວ.
          ບໍ່ນັບສິນຄ້າທີ່ເຊົາຂາຍ ຫຼື ຂາຍເທື່ອດຽວ. ຖານຂໍ້ມູນຍັງບໍ່ມີຂໍ້ມູນຜູ້ສະໜອງ
          (<span className="font-mono">supplier_code</span> ຫວ່າງທັງໝົດ) ຈຶ່ງບອກຜູ້ສະໜອງບໍ່ໄດ້.
        </p>
      </section>

      {err && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-sm text-zinc-400">
          ກຳລັງຄິດ... ຄັ້ງທຳອິດຂອງແຕ່ລະສາງໃຊ້ເວລາ 3–6 ວິນາທີ
        </div>
      )}

      {!data && !loading && !err && (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            ເລືອກສາງທີ່ຕ້ອງການຕື່ມ ແລ້ວກົດ “ຄິດໃບສະເໜີ”
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            ເລືອກສາງຊ່ອງຂວານຳ ຖ້າຢາກຫັກຂອງທີ່ບໍລິສັດມີຢູ່ແລ້ວອອກກ່ອນສັ່ງຊື້
          </p>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kard label="ລາຍການທີ່ຕ້ອງສັ່ງ" value={fmt(totals.lines)} unit="ລາຍການ" tone="rose" />
            <Kard label="ມູນຄ່າລວມ" value={money(totals.value)} unit="ກີບ" tone="rose" />
            <Kard label="ໃນນັ້ນ ກຸ່ມ A" value={fmt(totals.aLines)} unit="ລາຍການ" tone="navy" />
            <Kard label="ມູນຄ່າກຸ່ມ A" value={money(totals.aValue)} unit="ກີບ" tone="navy" />
          </div>

          {totals.aLines > 0 && (
            <div className="rounded-xl bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900">
              ຖ້າງົບຈຳກັດ ໃຫ້ສັ່ງ <b>ກຸ່ມ A ກ່ອນ</b> — {fmt(totals.aLines)} ລາຍການ ({money(totals.aValue)} ກີບ)
              ຄືກຸ່ມທີ່ສ້າງມູນຄ່າຂາຍ 80% ທຳອິດຂອງສາງນີ້.
            </div>
          )}

          <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                ລາຍການສະເໜີສັ່ງຊື້
                <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
                  ({fmt(rows.length)} ຈາກ {fmt(data.unmet.length)})
                </span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່"
                  className={`${inputCls} w-48 py-1.5 text-[12px]`} />
                <select value={abcFilter} onChange={(e) => setAbcFilter(e.target.value as AbcClass | "all")}
                  className={`${inputCls} py-1.5 text-[12px]`}>
                  <option value="all">ABC ທັງໝົດ</option>
                  <option value="A">A (ສຳຄັນສຸດ)</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <th className="px-3 py-2.5">ດ່ວນ</th>
                    <th className="px-3 py-2.5">ສິນຄ້າ</th>
                    <th className="px-3 py-2.5">ສາງ</th>
                    <th className="px-3 py-2.5 text-right">ຄົງເຫຼືອ</th>
                    <th className="px-3 py-2.5 text-right">ຂາຍ/ມື້</th>
                    <th className="px-3 py-2.5 text-right">ພໍໃຊ້</th>
                    <th className="px-3 py-2.5 text-right">ສະເໜີສັ່ງ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">
                        ບໍ່ມີລາຍການທີ່ຕ້ອງສັ່ງຊື້ — ຄວາມຂາດທັງໝົດແກ້ດ້ວຍການໂອນໄດ້
                      </td>
                    </tr>
                  )}
                  {rows.map((u) => (
                    <tr key={`${u.wh_code}-${u.item_code}`} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${URGENCY[u.urgency].chip}`}>
                          {URGENCY[u.urgency].label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {u.abc !== "none" && (
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${ABC_CHIP[u.abc]}`}>
                              {u.abc}
                            </span>
                          )}
                          <span className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">
                            {u.item_code}
                          </span>
                        </div>
                        <div className="max-w-sm truncate text-[13px] text-zinc-700 dark:text-zinc-300" title={u.item_name ?? ""}>
                          {u.item_name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-500">{u.wh_code}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                        {fmt(u.on_hand, 0)}
                        <span className="ml-1 text-[10px] text-zinc-400">{u.unit_code}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">
                        {u.avg_daily.toFixed(2)}
                        <div className="text-[10px] text-zinc-400">ຫຼ້າສຸດ {u.recent_avg_daily.toFixed(2)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">
                        {u.days_cover === null ? "—" : `${fmt(u.days_cover, 1)} ວັນ`}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        <span className="text-base font-black text-rose-600 dark:text-rose-400">
                          {fmt(u.order_qty, 2)}
                        </span>
                        <span className="ml-1 text-[10px] text-zinc-400">{u.unit_code}</span>
                        {/* ບາງລາຍການບໍ່ມີຄົງເຫຼືອຢູ່ສາງໃດເລີຍ ຈຶ່ງບໍ່ມີຕົ້ນທຶນໃນ ERP —
                            ບອກໄປຊື່ໆ ດີກວ່າສະແດງ 0 ກີບ ຄືກັບວ່າມັນບໍ່ມີຄ່າ */}
                        <div className="text-[10px] text-zinc-400">
                          {u.order_value > 0 ? (
                            <>
                              {money(u.order_value)} ກີບ
                              {/* ລາຄາຊື້ຫຼ້າສຸດ ບໍ່ແມ່ນຕົ້ນທຶນສະເລ່ຍ — ໝາຍໄວ້ໃຫ້ຮູ້ */}
                              {u.cost_source === "last_buy" && (
                                <span
                                  className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                  title={`ຄິດຈາກລາຄາຊື້ຫຼ້າສຸດ${u.last_buy_date ? ` (${u.last_buy_date})` : ""} ບໍ່ແມ່ນຕົ້ນທຶນສະເລ່ຍ`}
                                >
                                  ລາຄາຊື້
                                </span>
                              )}
                              {u.cost_source === "master" && (
                                <span
                                  className="ml-1 text-[9px] text-zinc-400"
                                  title="ຕົ້ນທຶນສະເລ່ຍລວມຂອງບໍລິສັດ (ທະບຽນສິນຄ້າ) ບໍ່ແມ່ນຂອງສາງນີ້"
                                >
                                  ລວມ
                                </span>
                              )}
                            </>
                          ) : (
                            <span title="ບໍ່ມີຕົ້ນທຶນຢູ່ສາງໃດ ບໍ່ມີໃນທະບຽນສິນຄ້າ ແລະ ບໍ່ເຄີຍມີໃບຊື້">
                              ບໍ່ຮູ້ຕົ້ນທຶນ
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function WhPicker({
  label, all, value, onChange, tone,
}: {
  label: string;
  all: WarehouseOption[];
  value: string[];
  onChange: (v: string[]) => void;
  tone: "amber" | "emerald";
}) {
  const codes = all.map((w) => w.code);
  const zones = ZONES.filter((z) => codes.some((c) => c.startsWith(z.prefix)));
  const on = tone === "amber"
    ? "bg-amber-500 text-white ring-amber-500"
    : "bg-emerald-500 text-white ring-emerald-500";
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</label>
        {zones.map((z) => (
          <button key={z.prefix} type="button"
            onClick={() => onChange(codes.filter((c) => c.startsWith(z.prefix)))}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 transition hover:bg-brand-50 hover:text-brand-600 dark:bg-zinc-800 dark:text-zinc-300">
            {z.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((w) => {
          const sel = value.includes(w.code);
          return (
            <button key={w.code} type="button" title={w.name ?? ""}
              onClick={() => onChange(sel ? value.filter((c) => c !== w.code) : [...value, w.code])}
              className={`rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold ring-1 transition ${
                sel ? on : "bg-white text-zinc-600 ring-zinc-200 hover:ring-brand-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
              }`}>
              {w.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function Kard({
  label, value, unit, tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: "rose" | "navy";
}) {
  const t = {
    rose: "text-rose-600 dark:text-rose-400",
    navy: "text-brand-600 dark:text-brand-400",
  }[tone];
  return (
    <div className="shadow-card rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${t}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}
