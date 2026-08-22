"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AssortmentResult, GapItem, GapKind } from "@/lib/assortment";
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

const KIND_VIEW: Record<GapKind, { label: string; chip: string; hint: string }> = {
  never_carried: {
    label: "ຍັງບໍ່ເຄີຍມີ",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    hint: "ປາຍທາງບໍ່ມີທັງຍອດຂາຍ ແລະ ບໍ່ມີຂອງ — ຄວນພິຈາລະນາເປີດລາຍການ",
  },
  stocked_not_selling: {
    label: "ມີຂອງ ແຕ່ຂາຍບໍ່ອອກ",
    chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
    hint: "ເຄີຍເອົາໄປແລ້ວ ແຕ່ຂາຍບໍ່ອອກ — ຢ່າສົ່ງເພີ່ມ ໃຫ້ໄປຫາສາເຫດກ່ອນ",
  },
};

const ZONES = [
  { prefix: "11", label: "ຂົວຫຼວງ" },
  { prefix: "12", label: "ດອນຕີ້ວ" },
  { prefix: "13", label: "ໂພນສະອາດ" },
  { prefix: "14", label: "ປາກເຊ" },
];

const fmt = (v: number, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: d }) : "0";
function money(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} ຕື້`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} ລ້ານ`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} ພັນ`;
  return fmt(v);
}

export default function AssortmentClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [from, setFrom] = useState<string[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [trial, setTrial] = useState(30);
  const [keep, setKeep] = useState(30);
  const [steadyOnly, setSteadyOnly] = useState(false);

  const [data, setData] = useState<AssortmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<GapKind | "all">("never_carried");
  const [q, setQ] = useState("");

  async function load() {
    if (from.length === 0 || to.length === 0) {
      setErr("ກະລຸນາເລືອກສາງທີ່ຂາຍໄດ້ ແລະ ສາງທີ່ຢາກເປີດລາຍການ");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({
        from: from.join(","), to: to.join(","),
        days: String(days), trial: String(trial), keep: String(keep),
        ...(steadyOnly ? { steady: "1" } : {}),
      });
      const res = await fetch(`/api/movements/assortment?${p}`);
      const json = (await res.json()) as AssortmentResult & { error?: string };
      if (!res.ok) { setErr(json.error ?? "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ"); setData(null); }
      else setData(json);
    } catch {
      setErr("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
      setData(null);
    } finally { setLoading(false); }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.items.filter((i) => {
      if (kind !== "all" && i.kind !== kind) return false;
      if (!needle) return true;
      return i.item_code.toLowerCase().includes(needle) ||
        (i.item_name ?? "").toLowerCase().includes(needle) ||
        (i.brand_name ?? "").toLowerCase().includes(needle);
    }).slice(0, 300);
  }, [data, kind, q]);

  return (
    <div className="space-y-4">
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <WhPicker label="ສາງທີ່ຂາຍໄດ້ (ຫຼັກຖານ)" all={warehouses} value={from} onChange={setFrom} tone="emerald" />
          <WhPicker label="ສາງທີ່ຢາກເປີດລາຍການ" all={warehouses} value={to} onChange={setTo} tone="amber" />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="ຊ່ວງຂາຍຍ້ອນຫຼັງ">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
              {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} ວັນ</option>)}
            </select>
          </Field>
          <Field label="ຢາກລອງໃຫ້ພໍຂາຍ (ວັນ)">
            <input type="number" min={1} value={trial} onChange={(e) => setTrial(Number(e.target.value))} className={`${inputCls} w-24`} />
          </Field>
          <Field label="ຕົ້ນທາງເຫຼືອໄວ້ (ວັນ)">
            <input type="number" min={0} value={keep} onChange={(e) => setKeep(Number(e.target.value))} className={`${inputCls} w-24`} />
          </Field>
          <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={steadyOnly} onChange={(e) => setSteadyOnly(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            ເອົາສະເພາະທີ່ຂາຍສະໝ່ຳສະເໝີ
          </label>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
            {loading ? "ກຳລັງຄິດ..." : "ຫາຊ່ອງຫວ່າງ"}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          ໜ້ານີ້ <b>ບໍ່ໄດ້ສັ່ງໃຫ້ຍ້າຍ</b> — ມັນຕັ້ງລາຍການໃຫ້ຄົນຄ້າພິຈາລະນາ ເພາະການເປີດຂາຍ
          ສິນຄ້າໃໝ່ຢູ່ສາງໜຶ່ງ ເປັນການຕັດສິນໃຈທາງການຄ້າ ບໍ່ແມ່ນການຄິດເລກ.
        </p>
      </section>

      {err && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">{err}</div>
      )}

      {!data && !loading && !err && (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">ເລືອກສາງສອງຝັ່ງ ແລ້ວກົດ “ຫາຊ່ອງຫວ່າງ”</p>
          <p className="mt-1 text-[11px] text-zinc-400">ຊ້າຍ = ບ່ອນທີ່ຂາຍໄດ້ແລ້ວ · ຂວາ = ບ່ອນທີ່ຢາກເປີດຂາຍ</p>
        </div>
      )}

      {loading && !data && <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງຄິດ...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kard label="ຍັງບໍ່ເຄີຍມີ" value={fmt(data.never_carried)} unit="ລາຍການ" tone="emerald" />
            <Kard label="ມີຂອງ ແຕ່ຂາຍບໍ່ອອກ" value={fmt(data.stocked_not_selling)} unit="ລາຍການ" tone="rose" />
            <Kard label="ມູນຄ່າທີ່ຕົ້ນທາງເຮັດໄດ້" value={money(data.total_src_value)} unit="ບາດ/ຊ່ວງ" tone="navy" />
            <Kard label="ຂະໜາດຮ້ານປາຍທາງ" value={`${(data.scale * 100).toFixed(0)}%`} unit="ຂອງຕົ້ນທາງ" tone="navy" />
          </div>

          <div className="rounded-xl bg-zinc-50 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950/40 dark:text-zinc-400 dark:ring-zinc-800">
            ຈຳນວນແນະນຳໃຫ້ລອງ = ອັດຕາຂາຍຂອງຕົ້ນທາງ × {trial} ວັນ × <b>{(data.scale * 100).toFixed(0)}%</b>
            (ອັດຕາສ່ວນຂະໜາດການຂາຍ ປາຍທາງ ÷ ຕົ້ນທາງ) ແລະ ບໍ່ເກີນຈຳນວນທີ່ຕົ້ນທາງແບ່ງໄດ້.
            ເປັນການປະມານແບບຫຍາບ <b>ບໍ່ແມ່ນການພະຍາກອນ</b>.
          </div>

          <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px] dark:bg-zinc-800">
                {([["never_carried", `ຍັງບໍ່ເຄີຍມີ (${data.never_carried})`],
                   ["stocked_not_selling", `ຂາຍບໍ່ອອກ (${data.stocked_not_selling})`],
                   ["all", "ທັງໝົດ"]] as [GapKind | "all", string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className={`rounded-md px-2.5 py-1 font-semibold transition ${kind === k ? "bg-white text-brand-600 shadow-sm dark:bg-zinc-950 dark:text-brand-400" : "text-zinc-500"}`}>
                    {l}
                  </button>
                ))}
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່ / ຍີ່ຫໍ້"
                className={`${inputCls} w-52 py-1.5 text-[12px]`} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <th className="px-3 py-2.5">ປະເພດ</th>
                    <th className="px-3 py-2.5">ສິນຄ້າ</th>
                    <th className="px-3 py-2.5 text-right">ຂາຍທີ່ຕົ້ນທາງ</th>
                    <th className="px-3 py-2.5 text-right">ຂາຍ/ມື້</th>
                    <th className="px-3 py-2.5 text-right">ຕົ້ນທາງແບ່ງໄດ້</th>
                    <th className="px-3 py-2.5 text-right">ປາຍທາງມີ</th>
                    <th className="px-3 py-2.5 text-right">ແນະນຳລອງ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">ບໍ່ມີລາຍການ</td></tr>
                  )}
                  {rows.map((i: GapItem) => {
                    const kv = KIND_VIEW[i.kind];
                    return (
                      <tr key={i.item_code} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${kv.chip}`} title={kv.hint}>
                            {kv.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {i.abc !== "none" && (
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${ABC_CHIP[i.abc]}`}>{i.abc}</span>
                            )}
                            <span className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{i.item_code}</span>
                          </div>
                          <div className="max-w-sm truncate text-[13px] text-zinc-700 dark:text-zinc-300" title={i.item_name ?? ""}>
                            {i.item_name}
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {i.brand_name} · ຂາຍ {i.src_sale_days} ມື້ · {i.pattern === "steady" ? "ສະໝ່ຳສະເໝີ" : i.pattern === "single" ? "ຂາຍເທື່ອດຽວ" : "ຂາດໆ"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                          {fmt(i.src_sold, 0)}
                          <div className="text-[10px] text-zinc-400">{money(i.src_sale_amount)} ບາດ</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">{i.src_avg_daily.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                          {fmt(i.src_spare, 0)}
                          <span className="ml-1 text-[10px] text-zinc-400">{i.unit_code}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {i.dst_on_hand > 0
                            ? <span className="font-bold text-red-600 dark:text-red-400">{fmt(i.dst_on_hand, 0)}</span>
                            : <span className="text-zinc-300 dark:text-zinc-600">0</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {i.suggest_qty > 0 ? (
                            <>
                              <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{fmt(i.suggest_qty, 0)}</span>
                              <div className="text-[10px] text-zinc-400">{money(i.suggest_value)} ບາດ</div>
                            </>
                          ) : (
                            <span className="text-[11px] text-zinc-400" title={KIND_VIEW[i.kind].hint}>ບໍ່ແນະນຳ</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function WhPicker({ label, all, value, onChange, tone }: {
  label: string; all: WarehouseOption[]; value: string[];
  onChange: (v: string[]) => void; tone: "amber" | "emerald";
}) {
  const codes = all.map((w) => w.code);
  const zones = ZONES.filter((z) => codes.some((c) => c.startsWith(z.prefix)));
  const on = tone === "amber" ? "bg-amber-500 text-white ring-amber-500" : "bg-emerald-500 text-white ring-emerald-500";
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</label>
        {zones.map((z) => (
          <button key={z.prefix} type="button" onClick={() => onChange(codes.filter((c) => c.startsWith(z.prefix)))}
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
                sel ? on : "bg-white text-zinc-600 ring-zinc-200 hover:ring-brand-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"}`}>
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

function Kard({ label, value, unit, tone }: {
  label: string; value: string; unit?: string; tone: "emerald" | "rose" | "navy";
}) {
  const t = { emerald: "text-emerald-600 dark:text-emerald-400", rose: "text-rose-600 dark:text-rose-400", navy: "text-brand-600 dark:text-brand-400" }[tone];
  return (
    <div className="shadow-card rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${t}`}>
        {value}{unit && <span className="ml-1 text-[10px] font-normal text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}
