"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { useToast } from "@/components/ui/Toast";
import { feedback } from "@/lib/feedback";
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronRightIcon,
  MapPinIcon,
  ScanIcon,
} from "@/components/ui/Icons";
import {
  PICK_TYPES,
  buildPlan,
  fmtQty,
  type PickPendingDoc,
  type PickSrcLine,
  type PickTask,
} from "@/lib/pickPlan";

export type WarehouseOption = { code: string; name: string | null };

const TYPE_KEY = "m.pick.type";

/**
 * ສາມສະຖານະ: ເລືອກປະເພດ → ເລືອກໃບ → ຍ່າງເກັບເທື່ອລະລາຍການ.
 *
 * ໃນສະຖານະສຸດທ້າຍ ໜ້າຈໍສະແດງ **ລາຍການດຽວ** ຕົວໃຫຍ່: ບ່ອນເກັບ, ຊື່ເຄື່ອງ, ຈຳນວນ.
 * ຄົນຍ່າງໄປຫາບ່ອນນັ້ນ ຍິງປ້າຍ location ເພື່ອຢືນຢັນວ່າຢືນຖືກບ່ອນ ແລ້ວກົດ “ເກັບແລ້ວ”.
 * ຖ້າຍິງຜິດບ່ອນ ຈະສັ່ນສອງຈັງຫວະ ແລະ ບອກວ່າຄວນຢູ່ບ່ອນໃດ — ບໍ່ໃຫ້ຜ່ານໄປງ່າຍໆ.
 */
export default function MobilePickClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const toast = useToast();
  const [type, setType] = useState("req");
  const [docs, setDocs] = useState<PickPendingDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [active, setActive] = useState<PickPendingDoc | null>(null);
  const [tasks, setTasks] = useState<PickTask[] | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [cam, setCam] = useState(false);
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanText, setScanText] = useState("");

  const whName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.code, w.name]));
    return (code: string) => map.get(code) ?? code;
  }, [warehouses]);

  // ຈື່ປະເພດເອກະສານທີ່ໃຊ້ຫຼ້າສຸດ — ຄົນດຽວກັນມັກເຮັດປະເພດເກົ່າທັງມື້
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TYPE_KEY);
      if (saved && PICK_TYPES.some((t) => t.v === saved)) setType(saved);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    setActive(null);
    setTasks(null);
    setDone(new Set());
    setVerified(new Set());
    setCursor(0);
    try {
      localStorage.setItem(TYPE_KEY, type);
    } catch {
      /* private mode */
    }
    let cancelled = false;
    setLoadingDocs(true);
    (async () => {
      try {
        const res = await fetch(`/api/movements/issue/pending?type=${type}`);
        const data = (await res.json()) as { docs?: PickPendingDoc[] };
        if (!cancelled) setDocs(data.docs ?? []);
      } catch {
        if (!cancelled) toast.show({ message: "ໂຫຼດລາຍການບໍ່ສຳເລັດ", tone: "error" });
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // toast ບໍ່ຢູ່ໃນ deps ໂດຍເຈດຕະນາ — ມັນຄົງທີ່ ແລະ ຈະເຮັດໃຫ້ຮຽກຊ້ຳ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const realTasks = useMemo(() => (tasks ?? []).filter((t) => !t.short), [tasks]);
  const shortTasks = useMemo(() => (tasks ?? []).filter((t) => t.short), [tasks]);
  const remaining = useMemo(
    () => realTasks.filter((t) => !done.has(t.key)),
    [realTasks, done],
  );
  const current = remaining[Math.min(cursor, Math.max(remaining.length - 1, 0))] ?? null;

  useEffect(() => {
    if (!cam && current) scanRef.current?.focus();
  }, [cam, current]);

  async function openDoc(d: PickPendingDoc) {
    setActive(d);
    setTasks(null);
    setDone(new Set());
    setVerified(new Set());
    setCursor(0);
    setLoadingPlan(true);
    feedback("tap");
    try {
      const res = await fetch(
        `/api/movements/issue/source?wh=${encodeURIComponent(d.wh_code)}&type=${type}&doc=${encodeURIComponent(d.doc_no)}`,
      );
      const data = (await res.json()) as { lines?: PickSrcLine[]; error?: string };
      if (!res.ok) {
        toast.show({ message: data.error ?? "ເປີດໃບບໍ່ສຳເລັດ", tone: "error" });
        setActive(null);
        return;
      }
      setTasks(buildPlan(data.lines ?? []));
    } catch {
      toast.show({ message: "ເປີດໃບບໍ່ສຳເລັດ", tone: "error" });
      setActive(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  /** ຍິງປ້າຍ location / pallet ເພື່ອຢືນຢັນວ່າຢືນຖືກບ່ອນ. */
  function handleScan(raw: string) {
    const value = raw.trim();
    setScanText("");
    if (!value || !current) return;
    const target = [current.barcode, current.rack, current.pallet]
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    if (target.includes(value.toLowerCase())) {
      setVerified((prev) => new Set(prev).add(current.key));
      feedback("ok");
      toast.show({
        message: "ຢືນຢັນບ່ອນເກັບແລ້ວ",
        detail: current.loc,
        tone: "ok",
        duration: 2000,
      });
    } else {
      feedback("error");
      toast.show({
        message: `ບໍ່ແມ່ນບ່ອນນີ້ — ໃຫ້ໄປທີ່ ${current.loc}`,
        detail: `ຍິງໄດ້: ${value}`,
        tone: "error",
      });
    }
  }

  /** ໝາຍວ່າເກັບແລ້ວ ພ້ອມໃຫ້ໂອກາດຍົກເລີກ 6 ວິນາທີ — ບໍ່ຕ້ອງຖາມຢືນຢັນກ່ອນ. */
  function markDone(task: PickTask) {
    setDone((prev) => new Set(prev).add(task.key));
    setCursor(0);
    const isLast = remaining.length <= 1;
    feedback(isLast ? "done" : "ok");
    toast.show({
      message: `${task.item_name ?? task.item_code} ✓`,
      detail: `${fmtQty(task.qty)} ${task.unit ?? ""} ຈາກ ${task.loc}`,
      tone: "ok",
      undo: {
        onUndo: () =>
          setDone((prev) => {
            const next = new Set(prev);
            next.delete(task.key);
            return next;
          }),
      },
    });
  }

  /* ── ໜ້າຈໍ 3: ຍ່າງເກັບ ───────────────────────────────────────── */
  if (active && tasks) {
    const total = realTasks.length;
    const doneCount = total - remaining.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 100;

    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-5">
        <header className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => {
              setActive(null);
              setTasks(null);
            }}
            className="tap-auto -ml-1 shrink-0 rounded-xl p-2 text-zinc-400"
            aria-label="ກັບຄືນ"
          >
            <ChevronRightIcon className="h-5 w-5 rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold">{active.doc_no}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {whName(active.wh_code)} · {active.cust_name ?? active.cust_code ?? "—"}
            </p>
          </div>
          <span className="shrink-0 text-right">
            <span className="block text-2xl font-bold tabular-nums text-brand-600 dark:text-aqua-300">
              {doneCount}/{total}
            </span>
            <span className="text-[10px] text-zinc-400">ເກັບແລ້ວ</span>
          </span>
        </header>

        <div
          className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {current ? (
          <>
            {/* ບ່ອນເກັບ — ຕົວໃຫຍ່ທີ່ສຸດໃນໜ້າ, ອ່ານໄດ້ຂະນະຍ່າງ */}
            <section className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <MapPinIcon className="h-3.5 w-3.5" />
                ໄປທີ່
              </p>
              <p className="mt-1 break-words font-mono text-3xl font-bold leading-tight text-brand-700 dark:text-aqua-300">
                {current.loc}
              </p>

              <div className="mt-5 flex items-end justify-between gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-snug">
                    {current.item_name ?? current.item_code}
                  </p>
                  <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {current.item_code}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-4xl font-bold tabular-nums">{fmtQty(current.qty)}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {current.unit ?? "ຫົວໜ່ວຍ"}
                  </p>
                </div>
              </div>
            </section>

            {/* ຢືນຢັນບ່ອນດ້ວຍການຍິງ — ບໍ່ບັງຄັບ ແຕ່ຂຶ້ນສີຂຽວເມື່ອຖືກ */}
            <section
              className={`rounded-2xl border-2 border-dashed p-4 transition ${
                verified.has(current.key)
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-aqua-400 bg-aqua-50 dark:bg-aqua-950/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${
                    verified.has(current.key) ? "bg-emerald-500" : "bg-aqua-500"
                  }`}
                >
                  {verified.has(current.key) ? (
                    <CheckIcon className="h-6 w-6" />
                  ) : (
                    <ScanIcon className="h-6 w-6" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {verified.has(current.key) ? "ຢືນຢັນບ່ອນເກັບແລ້ວ" : "ຍິງປ້າຍບ່ອນເກັບ"}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    ຫຼື ພິມລະຫັດແລ້ວກົດ Enter
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  ref={scanRef}
                  value={scanText}
                  onChange={(e) => setScanText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleScan(scanText);
                    }
                  }}
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="ລະຫັດບ່ອນເກັບ"
                  className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 font-mono text-base outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={() => setCam(true)}
                  className="shrink-0 rounded-xl bg-zinc-900 px-4 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  ກ້ອງ
                </button>
              </div>
            </section>

            {/* ປຸ່ມຫຼັກຢູ່ເຄິ່ງລຸ່ມ — ນິ້ວໂປ້ເອື້ອມເຖິງໂດຍບໍ່ຕ້ອງຂະຫຍັບມື */}
            <button
              type="button"
              onClick={() => markDone(current)}
              className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-lg font-bold text-white transition active:scale-[0.98] dark:bg-brand-500"
            >
              ເກັບແລ້ວ — ໄປລາຍການຕໍ່ໄປ
            </button>

            {remaining.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setCursor((c) => (c + 1) % remaining.length);
                  feedback("tap");
                }}
                className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                ຂ້າມໄປລາຍການອື່ນກ່ອນ ({remaining.length - 1} ລາຍການທີ່ຍັງເຫຼືອ)
              </button>
            )}
          </>
        ) : (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
            <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white">
              <CheckIcon className="h-8 w-8" />
            </span>
            <p className="mt-3 text-xl font-bold text-emerald-800 dark:text-emerald-300">
              ເກັບຄົບທຸກລາຍການແລ້ວ
            </p>
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
              ນຳໃບໄປຢືນຢັນການຈ່າຍອອກທີ່ໜ້າ “ຈ່າຍສິນຄ້າ”
            </p>
            <button
              type="button"
              onClick={() => {
                setActive(null);
                setTasks(null);
              }}
              className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-bold text-white"
            >
              ເລືອກໃບຕໍ່ໄປ
            </button>
          </section>
        )}

        {shortTasks.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              ບໍ່ພໍ stock {shortTasks.length} ລາຍການ
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
              {shortTasks.map((t) => (
                <li key={t.key} className="flex justify-between gap-2">
                  <span className="truncate">{t.item_name ?? t.item_code}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    ຂາດ {fmtQty(t.qty)} {t.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cam && (
          <BarcodeScanner
            onDetect={(text) => {
              setCam(false);
              handleScan(text);
            }}
            onClose={() => setCam(false)}
          />
        )}
      </div>
    );
  }

  /* ── ໜ້າຈໍ 1–2: ເລືອກປະເພດ ແລະ ໃບ ─────────────────────────────── */
  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ຈັດເຄື່ອງ</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          ເລືອກໃບ ແລ້ວລະບົບຈັດລຳດັບບ່ອນເກັບໃຫ້ຍ່າງຄັ້ງດຽວ
        </p>
      </header>

      <div className="flex gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {PICK_TYPES.map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => {
              setType(t.v);
              feedback("tap");
            }}
            className={`flex-1 rounded-xl px-2 py-2.5 text-sm font-bold transition ${
              type === t.v
                ? "bg-white text-brand-700 shadow-sm dark:bg-zinc-950 dark:text-aqua-300"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadingDocs || loadingPlan ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-12 text-center dark:border-zinc-700">
          <ArrowLeftRightIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 font-semibold text-zinc-600 dark:text-zinc-300">
            ບໍ່ມີໃບຄ້າງຈັດເຄື່ອງ
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            ລອງປ່ຽນປະເພດເອກະສານຂ້າງເທິງ
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={`${d.wh_code}:${d.doc_no}`}>
              <button
                type="button"
                onClick={() => openDoc(d)}
                className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-bold">{d.doc_no}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {whName(d.wh_code)} · {d.cust_name ?? d.cust_code ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{d.doc_date ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-bold tabular-nums text-brand-600 dark:text-aqua-300">
                    {d.line_count}
                  </p>
                  <p className="text-[10px] text-zinc-400">ລາຍການ</p>
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
