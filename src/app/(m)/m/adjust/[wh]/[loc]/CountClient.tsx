"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { feedback } from "@/lib/feedback";

type Line = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  /** ຄົງເຫຼືອທັງສາງ (ERP). */
  on_hand: number;
  /** ທຸກຈຳນວນທີ່ເຄີຍນັບຜ່ານລະບົບນີ້ ໃນສາງນີ້. */
  counted_before: number;
  /** ຫົວໜ່ວຍທັງໝົດຂອງສິນຄ້າ ຮຽງຈາກນ້ອຍໄປໃຫຍ່ (ພື້ນຖານ ratio 1 ກ່ອນ). */
  units: { unit: string; ratio: number }[];
  /**
   * ຈຳນວນທີ່ນັບ **ແຍກຕາມຫົວໜ່ວຍ** — ເຊັ່ນ { "ຕົວ": 25, "ຫີບ": 3 }.
   * ໃນ location ດຽວມັກມີທັງຫີບເຕັມ ແລະ ເສດ ຈຶ່ງໃຫ້ປ້ອນແຍກ ແລ້ວລະບົບບວກເອງ —
   * ດີກວ່າໃຫ້ຄົນນັບຄິດ 3×50+25 ໃນຫົວ ຊຶ່ງເປັນບ່ອນທີ່ຜິດພາດເກີດງ່າຍ.
   */
  qty_by_unit: Record<string, number>;
  /** ຫົວໜ່ວຍທີ່ບາໂຄດທີ່ຍິງໝາຍເຖິງ — ໃຊ້ໄຮໄລ້ແຖວນັ້ນ. */
  scan_unit: string | null;
};

/** ຈຳນວນລວມເປັນຫົວໜ່ວຍພື້ນຖານ — ນີ້ຄືຄ່າທີ່ສົ່ງໄປ API. */
const totalOf = (l: Line) =>
  Math.round(
    l.units.reduce((s, u) => s + (l.qty_by_unit[u.unit] ?? 0) * u.ratio, 0) * 1e6,
  ) / 1e6;

type ItemInfo = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  on_hand: number;
  counted_before: number;
  default_qty: number;
  units?: { unit: string; ratio: number }[];
  error?: string;
};

const fmt = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";

export default function CountClient({
  wh,
  locCode,
  locName,
  rack,
}: {
  wh: string;
  locCode: string;
  locName: string | null;
  rack: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ຊ່ອງຍິງຕ້ອງ focus ຕະຫຼອດ — ເຄື່ອງຍິງພິມເຂົ້າຄືແປ້ນພິມ
  useEffect(() => {
    if (!cam && !saving) inputRef.current?.focus();
  }, [cam, busy, saving, lines.length]);

  /** ຍິງ/ພິມລະຫັດ → ຫາສິນຄ້າ → ເພີ່ມເປັນແຖວ. */
  async function addItem(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const scan = await fetch(
        `/api/movements/scan?code=${encodeURIComponent(value)}&wh=${encodeURIComponent(wh)}`,
      );
      const sj = (await scan.json()) as {
        kind?: string;
        item?: { item_code: string; scanned_unit?: string | null; scanned_unit_size?: number };
        location?: { wh_code: string; code: string };
        error?: string;
      };
      if (!scan.ok) return setErr(sj.error ?? "ຄົ້ນຫາບໍ່ສຳເລັດ");

      // ຍິງປ້າຍ location ອື່ນ = ຢາກຍ້າຍໄປນັບບ່ອນນັ້ນ
      if (sj.kind === "location" && sj.location) {
        if (sj.location.code === locCode) return setErr("ນີ້ແມ່ນ location ທີ່ກຳລັງນັບຢູ່ແລ້ວ");
        if (lines.length > 0) {
          return setErr("ຍັງມີລາຍການທີ່ຍັງບໍ່ໄດ້ປັບປຸງ — ກົດ “ປັບປຸງ location” ກ່ອນ");
        }
        router.push(
          `/m/adjust/${encodeURIComponent(sj.location.wh_code)}/${encodeURIComponent(sj.location.code)}`,
        );
        return;
      }
      if (sj.kind !== "item" || !sj.item) return setErr(`ບໍ່ພົບ "${value}" ໃນລະບົບ`);

      // ເກັບໄວ້ເປັນຕົວແປ — ພາຍໃນ callback ຂອງ setLines TypeScript ບໍ່ຈື່ narrowing
      const scanned = sj.item;
      const itemCode = scanned.item_code;
      if (lines.some((l) => l.item_code === itemCode)) {
        return setErr("ລາຍການນີ້ຢູ່ໃນບັນຊີແລ້ວ — ແກ້ຈຳນວນຢູ່ແຖວນັ້ນໄດ້ເລີຍ");
      }

      const res = await fetch(
        `/api/movements/count-item?wh=${encodeURIComponent(wh)}&item=${encodeURIComponent(itemCode)}`,
      );
      const info = (await res.json()) as ItemInfo;
      if (!res.ok) return setErr(info.error ?? "ດຶງຂໍ້ມູນສິນຄ້າບໍ່ສຳເລັດ");

      const unitList =
        info.units && info.units.length > 0
          ? info.units
          : [{ unit: info.unit_code ?? "", ratio: 1 }];
      const baseUnit = (unitList.find((u) => u.ratio === 1) ?? unitList[0]).unit;

      setLines((s) => [
        {
          item_code: info.item_code,
          item_name: info.item_name,
          unit_code: info.unit_code,
          on_hand: info.on_hand,
          counted_before: info.counted_before,
          units: unitList,
          // ຄ່າຕັ້ງຕົ້ນເປັນຈຳນວນຫົວໜ່ວຍພື້ນຖານ ຈຶ່ງລົງແຖວພື້ນຖານສະເໝີ
          qty_by_unit: { [baseUnit]: info.default_qty },
          scan_unit: scanned.scanned_unit ?? null,
        },
        ...s,
      ]);
      feedback("ok");
    } catch {
      feedback("error");
      setErr("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  const setQty = (item: string, unit: string, q: number) =>
    setLines((s) =>
      s.map((l) =>
        l.item_code === item
          ? { ...l, qty_by_unit: { ...l.qty_by_unit, [unit]: Math.max(0, q) } }
          : l,
      ),
    );
  /** +/− ຂອງແຕ່ລະຫົວໜ່ວຍ — ກົດຢູ່ແຖວ "ຫີບ" ໄດ້ 1 ຫີບ ບໍ່ແມ່ນ 1 ຕົວ. */
  const bump = (item: string, unit: string, by: number) =>
    setLines((s) =>
      s.map((l) =>
        l.item_code === item
          ? {
              ...l,
              qty_by_unit: {
                ...l.qty_by_unit,
                [unit]: Math.max(0, (l.qty_by_unit[unit] ?? 0) + by),
              },
            }
          : l,
      ),
    );
  const remove = (item: string) => setLines((s) => s.filter((l) => l.item_code !== item));

  /** ສົ່ງໄປ API ປັບປຸງເກົ່າ — ມັນຄິດ delta ເອງຈາກຄົງເຫຼືອຂອງ node ນັ້ນ. */
  async function submit() {
    if (lines.length === 0) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/movements/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: wh,
          reason: "count",
          note: `ນັບຜ່ານມືຖື · ${locCode}`,
          lines: lines.map((l) => ({
            item_code: l.item_code,
            item_name: l.item_name,
            unit_code: l.unit_code,
            rack,
            location: locCode,
            counted_qty: totalOf(l),
          })),
        }),
      });
      const json = (await res.json()) as { doc_no?: string; error?: string };
      if (!res.ok) {
        setErr(json.error ?? "ປັບປຸງບໍ່ສຳເລັດ");
        return;
      }
      setOk(`ປັບປຸງແລ້ວ ${json.doc_no ?? ""} · ${lines.length} ລາຍການ`);
      setLines([]);
    } catch {
      setErr("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-brand-600 px-3 py-2.5 text-white">
        <button
          type="button"
          onClick={() => router.push("/m/adjust")}
          className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[13px] font-bold"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[15px] font-black leading-tight">{locCode}</div>
          <div className="text-[11px] opacity-80">
            ສາງ {wh}
            {locName ? ` · ${locName}` : ""}
          </div>
        </div>
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-[12px] font-black">
          {lines.length}
        </span>
      </header>

      <main className="flex-1 space-y-3 p-3 pb-32">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addItem(code);
            }}
            autoComplete="off"
            placeholder="ຍິງ / ພິມ ລະຫັດສິນຄ້າ"
            disabled={busy || saving}
            className="min-w-0 flex-1 rounded-xl bg-white px-3 py-3.5 text-center font-mono text-base font-bold ring-2 ring-brand-400 outline-none focus:ring-4 focus:ring-brand-500 disabled:opacity-60 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => setCam(true)}
            className="shrink-0 rounded-xl bg-zinc-200 px-4 text-[13px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            ກ້ອງ
          </button>
        </div>

        {err && (
          <div className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] font-semibold leading-relaxed text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
            {err}
          </div>
        )}
        {ok && (
          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-[13px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
            {ok}
          </div>
        )}

        {lines.length === 0 && !ok && (
          <p className="py-10 text-center text-[12px] leading-relaxed text-zinc-400">
            ຍັງບໍ່ມີລາຍການ — ຍິງສິນຄ້າເພື່ອເພີ່ມ
          </p>
        )}

        {lines.map((l) => {
          const total = totalOf(l);
          const diff = total - l.on_hand;
          return (
            <div
              key={l.item_code}
              className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">
                    {l.item_code}
                  </div>
                  <div className="text-[13px] leading-snug text-zinc-700 dark:text-zinc-200">
                    {l.item_name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(l.item_code)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[15px] font-bold text-zinc-400 active:bg-red-50 active:text-red-600"
                >
                  ✕
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                <span>
                  ຄົງເຫຼືອສາງ <b className="font-mono text-zinc-700 dark:text-zinc-200">{fmt(l.on_hand)}</b>
                </span>
                {l.counted_before > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    ນັບຜ່ານມາ <b className="font-mono">{fmt(l.counted_before)}</b>
                  </span>
                )}
                {l.units.length > 1 && (
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 font-bold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                    {l.units.map((u) => `1 ${u.unit}=${fmt(u.ratio)}`).join(" · ")}
                  </span>
                )}
              </div>

              {/* ໜຶ່ງແຖວຕໍ່ໜຶ່ງຫົວໜ່ວຍ — ນັບ "3 ຫີບ + 25 ຕົວ" ໄດ້ໂດຍບໍ່ຕ້ອງຄິດເລກເອງ */}
              <div className="mt-2 space-y-2">
                {l.units.map((u) => (
                  <div key={u.unit} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => bump(l.item_code, u.unit, -1)}
                      className="h-12 w-12 shrink-0 rounded-xl bg-zinc-200 text-xl font-black text-zinc-700 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={l.qty_by_unit[u.unit] ?? 0}
                      onChange={(e) => setQty(l.item_code, u.unit, Number(e.target.value) || 0)}
                      className="h-12 min-w-0 flex-1 rounded-xl bg-white text-center font-mono text-xl font-black ring-1 ring-zinc-300 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-700"
                    />
                    <button
                      type="button"
                      onClick={() => bump(l.item_code, u.unit, 1)}
                      className="h-12 w-12 shrink-0 rounded-xl bg-brand-500 text-xl font-black text-white active:bg-brand-600"
                    >
                      +
                    </button>
                    <span
                      className={`w-14 shrink-0 text-[12px] font-bold ${
                        u.unit === l.scan_unit
                          ? "text-brand-600 dark:text-brand-400"
                          : "text-zinc-400"
                      }`}
                      title={u.ratio > 1 ? `1 ${u.unit} = ${fmt(u.ratio)} ${l.unit_code}` : undefined}
                    >
                      {u.unit}
                    </span>
                  </div>
                ))}
              </div>

              {l.units.length > 1 && (
                <div className="mt-1.5 text-right text-[12px] font-bold text-zinc-700 dark:text-zinc-200">
                  ລວມ {fmt(total)} {l.unit_code}
                </div>
              )}

              {diff !== 0 && (
                <div
                  className={`mt-1.5 text-right text-[11px] font-bold ${
                    diff > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  ຕ່າງຈາກຄົງເຫຼືອສາງ {diff > 0 ? "+" : ""}
                  {fmt(diff)}
                </div>
              )}
            </div>
          );
        })}
      </main>

      {lines.length > 0 && (
        <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-zinc-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="w-full rounded-2xl bg-brand-600 py-4 text-base font-black text-white active:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "ກຳລັງປັບປຸງ..." : `ປັບປຸງ location (${lines.length})`}
          </button>
        </footer>
      )}

      {cam && (
        <BarcodeScanner
          onDetect={(text) => {
            setCam(false);
            void addItem(text);
          }}
          onClose={() => setCam(false)}
        />
      )}
    </div>
  );
}
