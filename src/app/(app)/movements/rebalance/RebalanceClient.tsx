"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { PairSummary, RebalanceResult, Suggestion } from "@/lib/rebalance";

export type WarehouseOption = { code: string; name: string | null };

const inputCls =
  "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

const URGENCY: Record<Suggestion["urgency"], { label: string; chip: string; dot: string }> = {
  out: {
    label: "ໝົດ",
    chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
    dot: "bg-red-500",
  },
  critical: {
    label: "ວິກິດ",
    chip: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900",
    dot: "bg-orange-500",
  },
  low: {
    label: "ສ່ຽງ",
    chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
    dot: "bg-amber-400",
  },
};

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

/** ຈັດກຸ່ມສາງເປັນໂຊນ ເພື່ອເລືອກໄດ້ໄວ. */
const ZONES: { prefix: string; label: string }[] = [
  { prefix: "11", label: "ຂົວຫຼວງ" },
  { prefix: "12", label: "ດອນຕີ້ວ" },
  { prefix: "13", label: "ໂພນສະອາດ" },
  { prefix: "14", label: "ປາກເຊ" },
];

export default function RebalanceClient({ warehouses }: { warehouses: WarehouseOption[] }) {

  // ບໍ່ເລືອກສາງໃຫ້ລ່ວງໜ້າ ແລະ ບໍ່ແລ່ນເອງ — ເບິ່ງເຫດຜົນທີ່ CoverageClient
  const [from, setFrom] = useState<string[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [target, setTarget] = useState(21);
  const [keep, setKeep] = useState(30);
  /**
   * ຄິດຄວາມຕ້ອງການຂອງປາຍທາງລວມກັນ. ເປີດໄວ້ເປັນຄ່າເລີ່ມຕົ້ນ ເພາະສາງປາຍທາງ
   * ສ່ວນຫຼາຍຢູ່ບ່ອນດຽວກັນ — ຄິດແຍກຈະຂໍໂອນຊ້ຳທັງທີ່ຂອງນອນຢູ່ສາງຂ້າງໆ.
   */
  const [group, setGroup] = useState(true);
  /** ຕົວກອງຄຸນນະພາບຄວາມຕ້ອງການ — ເປີດໄວ້ ເພາະ 37% ຂອງຂໍ້ສະເໜີດິບເປັນຂອງທີ່ເຊົາຂາຍ. */
  const [skipStopped, setSkipStopped] = useState(true);
  const [skipSingle, setSkipSingle] = useState(true);

  const [data, setData] = useState<RebalanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openPair, setOpenPair] = useState<string | null>(null);

  async function load() {
    if (from.length === 0 || to.length === 0) {
      setErr("ກະລຸນາເລືອກສາງຕົ້ນທາງ ແລະ ປາຍທາງ");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({
        from: from.join(","),
        to: to.join(","),
        days: String(days),
        target: String(target),
        keep: String(keep),
        ...(group ? { group: "1" } : {}),
        ...(skipStopped ? {} : { stopped: "0" }),
        ...(skipSingle ? {} : { single: "0" }),
      });
      const res = await fetch(`/api/movements/rebalance?${p}`);
      const json = (await res.json()) as RebalanceResult & { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ");
        setData(null);
      } else {
        setData(json);
        setOpenPair(null);
      }
    } catch {
      setErr("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    if (!data) return null;
    const between = data.suggestions.filter((s) => s.scope === "between");
    const internal = data.suggestions.filter((s) => s.scope === "internal");
    return {
      lines: between.length,
      value: between.reduce((s, x) => s + x.move_value, 0),
      items: new Set(between.map((s) => s.item_code)).size,
      internalLines: internal.length,
      internalValue: internal.reduce((s, x) => s + x.move_value, 0),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <WhPicker label="ຈາກສາງ (ມີຂອງເຫຼືອ)" all={warehouses} value={from} onChange={setFrom} tone="amber" />
          <WhPicker label="ໄປສາງ (ຂາດ)" all={warehouses} value={to} onChange={setTo} tone="emerald" />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="ຊ່ວງຂາຍຍ້ອນຫຼັງ">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
              {[30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d} ວັນ</option>
              ))}
            </select>
          </Field>
          <Field label="ຢາກໃຫ້ປາຍທາງພໍໃຊ້ (ວັນ)">
            <input type="number" min={1} value={target}
              onChange={(e) => setTarget(Number(e.target.value))} className={`${inputCls} w-28`} />
          </Field>
          <Field label="ຕົ້ນທາງເຫຼືອໄວ້ຢ່າງໜ້ອຍ (ວັນ)">
            <input type="number" min={0} value={keep}
              onChange={(e) => setKeep(Number(e.target.value))} className={`${inputCls} w-28`} />
          </Field>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
          >
            {loading ? "ກຳລັງຄິດ..." : "ຄິດຂໍ້ສະເໜີ"}
          </button>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100 dark:bg-zinc-950/40 dark:ring-zinc-800">
          <input
            type="checkbox"
            checked={group}
            onChange={(e) => setGroup(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            <b>ຄິດສາງປາຍທາງລວມກັນ</b> (ແນະນຳ ເມື່ອສາງປາຍທາງຢູ່ບ່ອນດຽວກັນ) —
            ຂອງທີ່ໝົດຢູ່ສາງໜຶ່ງ ແຕ່ນອນຢູ່ອີກສາງໜຶ່ງໃນກຸ່ມ ຈະຖືກແນະນຳໃຫ້
            <b> ຍ້າຍພາຍໃນກຸ່ມ</b> ແທນທີ່ຈະຂໍໂອນມາຈາກທາງໄກ
          </span>
        </label>

        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100 dark:bg-zinc-950/40 dark:ring-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
            ຄຸນນະພາບຄວາມຕ້ອງການ
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={skipStopped}
              onChange={(e) => setSkipStopped(e.target.checked)}
              className="h-3.5 w-3.5 accent-brand-500" />
            ບໍ່ສະເໜີສິນຄ້າທີ່ <b>ເຊົາຂາຍແລ້ວ</b>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={skipSingle}
              onChange={(e) => setSkipSingle(e.target.checked)}
              className="h-3.5 w-3.5 accent-brand-500" />
            ບໍ່ສະເໜີສິນຄ້າທີ່ <b>ຂາຍເທື່ອດຽວ</b>
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          ຍ້າຍ = min( ປາຍທາງຕ້ອງການເພື່ອໃຫ້ພໍໃຊ້ {target} ວັນ , ຕົ້ນທາງແບ່ງໄດ້ໂດຍຍັງເຫຼືອ {keep} ວັນ ).
          ສະເໜີສະເພາະສິນຄ້າທີ່ <b>ປາຍທາງເຄີຍຂາຍຈິງ</b> — ຂອງທີ່ປາຍທາງບໍ່ເຄີຍຂາຍ ບໍ່ຖືວ່າເປັນການ rebalance.
        </p>
      </section>

      {err && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-sm text-zinc-400">
          ກຳລັງຄິດ... ຄັ້ງທຳອິດຂອງແຕ່ລະສາງໃຊ້ເວລາ 3–6 ວິນາທີ ຫຼັງຈາກນັ້ນຈະໄວ
        </div>
      )}

      {!data && !loading && !err && (
        <div className="rounded-2xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            ເລືອກສາງຕົ້ນທາງ ແລະ ປາຍທາງ ແລ້ວກົດ “ຄິດຂໍ້ສະເໜີ”
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            ຕົ້ນທາງ = ບ່ອນທີ່ມີຂອງເຫຼືອ · ປາຍທາງ = ບ່ອນທີ່ຂາດ
          </p>
        </div>
      )}

      {data && totals && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kard label="ຕ້ອງໂອນມາຈາກຕົ້ນທາງ" value={fmt(totals.lines)} unit="ແຖວ" tone="emerald" />
            <Kard label="ມູນຄ່າທີ່ໂອນ" value={money(totals.value)} unit="ບາດ" tone="navy" />
            <Kard
              label="ຍ້າຍພາຍໃນກຸ່ມກໍ່ພໍ"
              value={fmt(totals.internalLines)}
              unit="ແຖວ"
              tone="amber"
            />
            <Kard label="ຂາດ ແຕ່ໂອນບໍ່ໄດ້" value={fmt(data.unmet_lines)} unit="ຕ້ອງສັ່ງຊື້" tone="rose" />
          </div>

          {totals.internalLines > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
              ມີ <b>{fmt(totals.internalLines)}</b> ແຖວ ທີ່ຂອງມີຢູ່ໃນກຸ່ມປາຍທາງແລ້ວ ພຽງແຕ່ນອນຜິດສາງ
              (ປະມານ {money(totals.internalValue)} ບາດ) — <b>ຍ້າຍພາຍໃນບ່ອນດຽວກັນ</b> ໄດ້ເລີຍ
              ບໍ່ຕ້ອງຂໍໂອນມາຈາກທາງໄກ. ບລັອກສີເຫຼືອງລຸ່ມນີ້ຄືລາຍການເຫຼົ່ານັ້ນ.
            </div>
          )}

          {data.failed.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
              ດຶງຂໍ້ມູນສາງ {data.failed.join(", ")} ບໍ່ສຳເລັດ — ຜົນລຸ່ມນີ້ຍັງບໍ່ຄົບ
            </div>
          )}

          {data.skipped_lines > 0 && (
            <div className="rounded-xl bg-zinc-50 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950/40 dark:text-zinc-400 dark:ring-zinc-800">
              ຂ້າມ <b>{fmt(data.skipped_lines)}</b> ລາຍການ ຍ້ອນປາຍທາງເຊົາຂາຍ ຫຼື ຂາຍພຽງເທື່ອດຽວ —
              ປິດຕົວກອງຂ້າງເທິງເພື່ອເບິ່ງພວກມັນ
            </div>
          )}

          {data.unmet_lines > 0 && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-800 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900">
              ມີ <b>{fmt(data.unmet_lines)}</b> ລາຍການທີ່ປາຍທາງຂາດ ແຕ່ບໍ່ມີສາງຕົ້ນທາງໃດເຫຼືອພໍໃຫ້ໂອນ
              (ປະມານ {money(data.unmet_value)} ບາດ) — ພວກນີ້ຕ້ອງ<b>ສັ່ງຊື້</b> ບໍ່ແມ່ນໂອນ.
            </div>
          )}

          {data.pairs.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-400">
              ບໍ່ມີລາຍການທີ່ຄວນຍ້າຍ — ຕົ້ນທາງບໍ່ມີເຫຼືອພໍ ຫຼື ປາຍທາງບໍ່ຂາດ
            </div>
          )}

          {data.pairs.map((p) => {
            const k = `${p.scope}|${p.from_wh}>${p.to_wh}`;
            const open = openPair === k;
            const lines = data.suggestions.filter(
              (s) => s.scope === p.scope && s.from_wh === p.from_wh && s.to_wh === p.to_wh,
            );
            return (
              <PairBlock
                key={k}
                pair={p}
                lines={lines}
                open={open}
                onToggle={() => setOpenPair(open ? null : k)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

function PairBlock({
  pair,
  lines,
  open,
  onToggle,
}: {
  pair: PairSummary;
  lines: Suggestion[];
  open: boolean;
  onToggle: () => void;
}) {
  const internal = pair.scope === "internal";

  /**
   * ຈຳນວນທີ່ຜູ້ໃຊ້ແກ້ເອງ — ເກັບແຕ່ຕົວທີ່ຖືກແກ້ ສ່ວນທີ່ເຫຼືອໃຊ້ `move_qty` ທີ່ຄິດໃຫ້.
   * ຕັ້ງເປັນ 0 ເພື່ອຂ້າມແຖວນັ້ນ.
   */
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [roundPack, setRoundPack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** ຈຳນວນດິບທີ່ຄິດໃຫ້ (ຍັງບໍ່ປັດເປັນຫົວໜ່ວຍໃຫຍ່). */
  const rawOf = (s: Suggestion) => Math.ceil(s.move_qty);
  /**
   * ປັດຂຶ້ນໃຫ້ຄົບ ຫີບ/ມັດ/ຖົງ — ສາງບໍ່ແຕກມັດເພື່ອສົ່ງເສດ.
   * ບາງລາຍການ 1 ຖົງ = 1,300 ຕົວ ຈຶ່ງປິດໄດ້ ແລະ ຫົວຕາຕະລາງເຕືອນເມື່ອປັດແລ້ວເກີນຫຼາຍ.
   */
  const packedOf = (s: Suggestion) => {
    const raw = rawOf(s);
    if (!roundPack || !s.pack || raw <= 0) return raw;
    return Math.ceil(raw / s.pack.size) * s.pack.size;
  };
  const qtyOf = (s: Suggestion) => edited[s.item_code] ?? packedOf(s);
  const sendable = lines.map((s) => ({ s, qty: qtyOf(s) })).filter((l) => l.qty > 0);

  async function createDoc() {
    if (sendable.length === 0) {
      setMsg({ ok: false, text: "ບໍ່ມີແຖວທີ່ມີຈຳນວນ" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/movements/transfer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_from: pair.from_wh,
          wh_to: pair.to_wh,
          remark: internal ? "ຍ້າຍພາຍໃນກຸ່ມ (ຈາກຂໍ້ສະເໜີການໂອນ)" : "ຈາກຂໍ້ສະເໜີການໂອນ",
          lines: sendable.map((l) => ({
            item_code: l.s.item_code,
            item_name: l.s.item_name,
            unit_code: l.s.unit_code,
            qty: l.qty,
          })),
        }),
      });
      const json = (await res.json()) as { doc_no?: string; error?: string };
      if (!res.ok) setMsg({ ok: false, text: json.error ?? "ສ້າງໃບຂໍໂອນບໍ່ສຳເລັດ" });
      else setMsg({ ok: true, text: `ສ້າງແລ້ວ ${json.doc_no ?? ""} (${sendable.length} ລາຍການ)` });
    } catch {
      setMsg({ ok: false, text: "ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`shadow-card overflow-hidden rounded-2xl bg-white ring-1 dark:bg-zinc-900 ${
        internal
          ? "ring-amber-200 dark:ring-amber-900"
          : "ring-zinc-200 dark:ring-zinc-800"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <span
          className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
            internal
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              : "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
          }`}
        >
          {internal ? "ຍ້າຍພາຍໃນກຸ່ມ" : "ຂໍໂອນ 124"}
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[12px] font-black">
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {pair.from_wh}
          </span>
          <span className="text-zinc-400">→</span>
          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {pair.to_wh}
          </span>
        </span>
        <span className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
          {pair.from_name} → {pair.to_name}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {fmt(pair.lines)} ລາຍການ
          </span>
          <span className="font-mono font-bold text-brand-600 dark:text-brand-400">
            {money(pair.value)} ບາດ
          </span>
          <span className="text-zinc-400">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="text-[11px] text-zinc-500">
              {internal
                ? `ຂອງມີຢູ່ໃນກຸ່ມແລ້ວ — ຍ້າຍຈາກ ${pair.from_wh} ໄປ ${pair.to_wh} ພາຍໃນບ່ອນດຽວກັນ`
                : `ເອົາລາຍການລຸ່ມນີ້ໄປເປີດ ໃບຂໍໂອນ (124) ຈາກສາງ ${pair.from_wh} ໄປ ${pair.to_wh}`}
            </span>
            <div className="flex items-center gap-2">
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300"
                title="ປັດຂຶ້ນໃຫ້ຄົບ ຫີບ/ມັດ/ຖົງ ຕາມທີ່ຕັ້ງໄວ້ໃນ ERP"
              >
                <input
                  type="checkbox"
                  checked={roundPack}
                  onChange={(e) => setRoundPack(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-500"
                />
                ປັດເປັນຫົວໜ່ວຍໃຫຍ່
              </label>
              <button
                type="button"
                onClick={() => void createDoc()}
                disabled={busy || sendable.length === 0}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50 ${
                  internal ? "bg-amber-500 hover:bg-amber-600" : "bg-brand-500 hover:bg-brand-600"
                }`}
              >
                {busy ? "ກຳລັງສ້າງ..." : `ສ້າງໃບຂໍໂອນ (${sendable.length})`}
              </button>
              <Link
                href="/movements/transfer-request"
                className="text-[11px] font-semibold text-zinc-500 underline-offset-2 hover:underline"
              >
                ເປີດໜ້າໃບຂໍໂອນ
              </Link>
            </div>
          </div>

          {msg && (
            <p
              className={`px-4 pb-2 text-[11px] font-semibold ${
                msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {msg.text}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-3 py-2.5">ດ່ວນ</th>
                  <th className="px-3 py-2.5">ສິນຄ້າ</th>
                  <th className="px-3 py-2.5 text-right">ຕົ້ນທາງມີ</th>
                  <th className="px-3 py-2.5 text-right">ປາຍທາງມີ</th>
                  <th className="px-3 py-2.5 text-right">ຂາຍ/ມື້</th>
                  <th className="px-3 py-2.5 text-right">ຍ້າຍ</th>
                  <th className="px-3 py-2.5 text-right">ວັນພໍໃຊ້ ຫຼັງຍ້າຍ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((s) => {
                  const u = URGENCY[s.urgency];
                  return (
                    <tr key={`${s.item_code}-${s.from_wh}-${s.to_wh}`} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${u.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.dot}`} />
                          {u.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">
                          {s.item_code}
                        </span>
                        <div className="max-w-sm truncate text-[13px] text-zinc-700 dark:text-zinc-300" title={s.item_name ?? ""}>
                          {s.item_name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmt(s.from_on_hand, 0)}
                        <div className="text-[10px] text-zinc-400">
                          {s.from_days_cover === null ? "∞" : `${fmt(s.from_days_cover, 0)} ວັນ`}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmt(s.to_on_hand, 0)}
                        <div className="text-[10px] text-zinc-400">
                          {s.to_days_cover === null ? "—" : `${fmt(s.to_days_cover, 1)} ວັນ`}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">
                        {s.to_avg_daily.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {/* ຈຳນວນທີ່ຈະຂໍຈິງ — ແກ້ໄດ້, ຕັ້ງ 0 ເພື່ອຂ້າມແຖວນີ້ */}
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={qtyOf(s)}
                          onChange={(e) =>
                            setEdited((m) => ({
                              ...m,
                              [s.item_code]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          title="ຈຳນວນທີ່ຈະຂໍ — ແກ້ໄດ້ (0 = ບໍ່ເອົາ)"
                          className="w-24 rounded-lg bg-white px-2 py-1 text-right font-mono text-[13px] font-black text-emerald-700 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-emerald-400 dark:ring-zinc-700"
                        />
                        <span className="ml-1 text-[10px] text-zinc-400">{s.unit_code}</span>
                        <div className="text-[10px] text-zinc-400">
                          ແນະນຳ {fmt(s.move_qty, 2)} · {money(s.move_value)} ບາດ
                        </div>
                        {/* ຫົວໜ່ວຍໃຫຍ່ — ບອກວ່າຄິດເປັນຈັກຫີບ/ມັດ ແລະ ເຕືອນເມື່ອປັດເກີນຫຼາຍ */}
                        {s.pack && (
                          <div
                            className="text-[10px]"
                            title={`1 ${s.pack.unit} = ${fmt(s.pack.size, 0)} ${s.unit_code ?? ""}`}
                          >
                            <span
                              className={
                                qtyOf(s) % s.pack.size === 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                              }
                            >
                              {qtyOf(s) % s.pack.size === 0
                                ? `${fmt(qtyOf(s) / s.pack.size, 2)} ${s.pack.unit}`
                                : `ບໍ່ຄົບ ${s.pack.unit}`}
                            </span>
                            {qtyOf(s) > rawOf(s) * 2 && rawOf(s) > 0 && (
                              <span className="ml-1 text-red-600 dark:text-red-400">
                                ({(qtyOf(s) / rawOf(s)).toFixed(1)}×)
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          {s.to_cover_after === null ? "—" : `${fmt(s.to_cover_after, 0)} ວັນ`}
                        </span>
                        <div className="text-[10px] text-zinc-400">
                          ຕົ້ນທາງເຫຼືອ {s.from_cover_after === null ? "∞" : `${fmt(s.from_cover_after, 0)} ວັນ`}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function WhPicker({
  label,
  all,
  value,
  onChange,
  tone,
}: {
  label: string;
  all: WarehouseOption[];
  value: string[];
  onChange: (v: string[]) => void;
  tone: "amber" | "emerald";
}) {
  const codes = all.map((w) => w.code);
  const zones = ZONES.filter((z) => codes.some((c) => c.startsWith(z.prefix)));
  const on =
    tone === "amber"
      ? "bg-amber-500 text-white ring-amber-500"
      : "bg-emerald-500 text-white ring-emerald-500";
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</label>
        {zones.map((z) => (
          <button
            key={z.prefix}
            type="button"
            onClick={() => onChange(codes.filter((c) => c.startsWith(z.prefix)))}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 transition hover:bg-brand-50 hover:text-brand-600 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {z.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((w) => {
          const sel = value.includes(w.code);
          return (
            <button
              key={w.code}
              type="button"
              title={w.name ?? ""}
              onClick={() =>
                onChange(sel ? value.filter((c) => c !== w.code) : [...value, w.code])
              }
              className={`rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold ring-1 transition ${
                sel
                  ? on
                  : "bg-white text-zinc-600 ring-zinc-200 hover:ring-brand-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
              }`}
            >
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
      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      {children}
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
  tone: "emerald" | "rose" | "navy" | "amber";
}) {
  const t = {
    amber: "text-amber-600 dark:text-amber-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
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
