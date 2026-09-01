"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { useToast } from "@/components/ui/Toast";
import { feedback } from "@/lib/feedback";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronRightIcon,
  ScanIcon,
  SearchIcon,
  XIcon,
} from "@/components/ui/Icons";

/** ແຖວຄ້າງຮັບ ຕາມທີ່ /api/receive/pending ສົ່ງມາ. */
type PendingLine = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  barcode: string | null;
  remaining: string;
};

type LocationOption = { code: string; name: string | null; rack_code: string };

/** ໃບສັ່ງຊື້ອັນໜຶ່ງ ພ້ອມແຖວທີ່ຍັງຄ້າງຮັບ. */
type Doc = {
  po_no: string;
  wh_code: string;
  wh_name: string | null;
  cust_code: string | null;
  cust_name: string | null;
  doc_date: string | null;
  lines: PendingLine[];
};

/** ລາຍການທີ່ຢືນຢັນແລ້ວ ລໍຖ້າບັນທຶກ. */
type CartLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: number;
  remaining: number;
};

const LOC_KEY = "m.receive.loc";
const num = (v: string | number) =>
  typeof v === "number" ? v : Number.parseFloat(v) || 0;
const fmt = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";

/**
 * ໜຶ່ງໜ້າຈໍ = ໜຶ່ງວຽກ.
 *
 * ຈໍ A ເລືອກໃບ · ຈໍ B ຍິງເຄື່ອງເຂົ້າກະຕ່າ · ຈໍ C ເລືອກບ່ອນເກັບແລ້ວບັນທຶກ.
 * ບໍ່ມີກ່ອງຖາມ “ແນ່ໃຈບໍ່?” ຢູ່ໃສ — ການລຶບແຖວອອກຈາກກະຕ່າຍົກເລີກຄືນໄດ້
 * ພາຍໃນ 6 ວິນາທີ. ການບັນທຶກຈິງເປັນບ່ອນດຽວທີ່ຕ້ອງກົດຢືນຢັນ ເພາະໂພສເຂົ້າ ERP.
 */
export default function MobileReceiveClient() {
  const toast = useToast();
  const [pending, setPending] = useState<PendingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cam, setCam] = useState(false);
  const [scanText, setScanText] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locCode, setLocCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"scan" | "confirm">("scan");
  const scanRef = useRef<HTMLInputElement>(null);

  async function loadPending() {
    setLoading(true);
    try {
      const res = await fetch("/api/receive/pending?type=po&limit=1000");
      const data = (await res.json()) as { lines?: PendingLine[]; error?: string };
      if (!res.ok) {
        toast.show({ message: data.error ?? "ໂຫຼດລາຍການບໍ່ສຳເລັດ", tone: "error" });
        return;
      }
      setPending(data.lines ?? []);
    } catch {
      toast.show({ message: "ໂຫຼດລາຍການບໍ່ສຳເລັດ", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPending();
    // ໂຫຼດເທື່ອດຽວຕອນເປີດໜ້າ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ລວມແຖວຄ້າງເປັນໃບ — API ສົ່ງມາເປັນແຖວລະສິນຄ້າ ບໍ່ແມ່ນລະໃບ
  const docs = useMemo(() => {
    const map = new Map<string, Doc>();
    for (const l of pending) {
      const key = `${l.wh_code}:${l.po_no}`;
      let d = map.get(key);
      if (!d) {
        d = {
          po_no: l.po_no,
          wh_code: l.wh_code,
          wh_name: l.wh_name,
          cust_code: l.cust_code,
          cust_name: l.cust_name,
          doc_date: l.doc_date,
          lines: [],
        };
        map.set(key, d);
      }
      d.lines.push(l);
    }
    const all = [...map.values()];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((d) =>
      `${d.po_no} ${d.cust_name ?? ""} ${d.cust_code ?? ""} ${d.wh_name ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [pending, q]);

  // ບ່ອນເກັບຂອງສາງທີ່ໃບນີ້ຢູ່ — ໂຫຼດເມື່ອເປີດໃບ
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stocktake/locations?wh=${encodeURIComponent(doc.wh_code)}`,
        );
        const data = (await res.json()) as { locations?: LocationOption[] };
        if (cancelled) return;
        const locs = data.locations ?? [];
        setLocations(locs);
        // ຈື່ບ່ອນເກັບທີ່ໃຊ້ຫຼ້າສຸດຂອງສາງນີ້ — ຄົນຮັບເຄື່ອງລົງບ່ອນເກົ່າເກືອບທຸກເທື່ອ
        try {
          const saved = localStorage.getItem(`${LOC_KEY}.${doc.wh_code}`);
          if (saved && locs.some((l) => l.code === saved)) setLocCode(saved);
        } catch {
          /* private mode */
        }
      } catch {
        if (!cancelled) toast.show({ message: "ໂຫຼດບ່ອນເກັບບໍ່ສຳເລັດ", tone: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    if (doc && step === "scan" && !cam) scanRef.current?.focus();
  }, [doc, step, cam, cart.length]);

  /** ຈຳນວນທີ່ຍັງຮັບໄດ້ຂອງແຖວໜຶ່ງ ຫຼັງຫັກສ່ວນທີ່ຢູ່ໃນກະຕ່າແລ້ວ. */
  function freeQty(line: PendingLine) {
    const inCart = cart.find((c) => c.item_code === line.item_code)?.qty ?? 0;
    return num(line.remaining) - inCart;
  }

  /** ເພີ່ມສິນຄ້າເຂົ້າກະຕ່າ ດ້ວຍຈຳນວນຄ້າງທັງໝົດເປັນຄ່າເລີ່ມຕົ້ນ. */
  function addLine(line: PendingLine, qty?: number) {
    const free = freeQty(line);
    if (free <= 0) {
      feedback("warn");
      toast.show({
        message: "ລາຍການນີ້ຮັບຄົບແລ້ວ",
        detail: line.item_name ?? line.item_code,
        tone: "warn",
      });
      return;
    }
    const take = Math.min(qty ?? free, free);
    setCart((prev) => {
      const at = prev.findIndex((c) => c.item_code === line.item_code);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], qty: next[at].qty + take };
        return next;
      }
      return [
        ...prev,
        {
          item_code: line.item_code,
          item_name: line.item_name,
          unit_code: line.unit_code,
          qty: take,
          remaining: num(line.remaining),
        },
      ];
    });
    feedback("ok");
    toast.show({
      message: line.item_name ?? line.item_code,
      detail: `+${fmt(take)} ${line.unit_code ?? ""}`,
      tone: "ok",
      duration: 2500,
    });
  }

  /** ຍິງ/ພິມລະຫັດ → ຫາແຖວທີ່ຕົງໃນໃບນີ້. */
  function handleScan(raw: string) {
    const value = raw.trim();
    setScanText("");
    if (!value || !doc) return;
    const needle = value.toLowerCase();
    const hit = doc.lines.find(
      (l) =>
        l.item_code.toLowerCase() === needle ||
        (l.barcode ?? "").toLowerCase() === needle,
    );
    if (!hit) {
      feedback("error");
      toast.show({
        message: `ບໍ່ພົບ “${value}” ໃນໃບນີ້`,
        detail: "ກວດວ່າຍິງຖືກໃບ ຫຼື ເລືອກຈາກລາຍການຂ້າງລຸ່ມ",
        tone: "error",
      });
      return;
    }
    addLine(hit, 1);
  }

  function setQty(itemCode: string, qty: number) {
    setCart((prev) =>
      prev.map((c) =>
        c.item_code === itemCode
          ? { ...c, qty: Math.max(0, Math.min(qty, c.remaining)) }
          : c,
      ),
    );
  }

  /** ລຶບອອກຈາກກະຕ່າ — ຄືນໄດ້ພາຍໃນ 6 ວິນາທີ ແທນການຖາມຢືນຢັນ. */
  function removeLine(line: CartLine) {
    setCart((prev) => prev.filter((c) => c.item_code !== line.item_code));
    toast.show({
      message: "ເອົາອອກຈາກລາຍການແລ້ວ",
      detail: line.item_name ?? line.item_code,
      tone: "warn",
      undo: {
        onUndo: () => setCart((prev) => [...prev, line]),
      },
    });
  }

  function closeDoc() {
    setDoc(null);
    setCart([]);
    setStep("scan");
    setLocations([]);
    setLocCode("");
  }

  async function submit() {
    if (!doc) return;
    const lines = cart.filter((c) => c.qty > 0);
    if (lines.length === 0) {
      feedback("error");
      toast.show({ message: "ຍັງບໍ່ມີລາຍການໃຫ້ຮັບ", tone: "error" });
      return;
    }
    const loc = locations.find((l) => l.code === locCode);
    if (!loc) {
      feedback("error");
      toast.show({ message: "ກະລຸນາເລືອກບ່ອນເກັບ", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: doc.wh_code,
          po_no: doc.po_no,
          doc_type: "po",
          supplier_code: doc.cust_code,
          remark: "ຮັບຜ່ານມືຖື",
          lines: lines.map((l) => ({
            item_code: l.item_code,
            item_name: l.item_name,
            unit_code: l.unit_code,
            qty: l.qty,
            rack: loc.rack_code ?? "",
            location: loc.code,
            pallet: "",
          })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        receive_code?: string;
        received?: number;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      try {
        localStorage.setItem(`${LOC_KEY}.${doc.wh_code}`, loc.code);
      } catch {
        /* private mode */
      }
      feedback("done");
      toast.show({
        message: `ຮັບສຳເລັດ ${data.receive_code ?? ""}`,
        detail: `${data.received ?? lines.length} ລາຍການ → ${loc.name || loc.code}`,
        tone: "ok",
        duration: 6000,
      });
      closeDoc();
      await loadPending();
    } catch (e) {
      feedback("error");
      toast.show({
        message: e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ",
        tone: "error",
        duration: 8000,
      });
    } finally {
      setSaving(false);
    }
  }

  const cartQty = cart.reduce((s, c) => s + c.qty, 0);

  /* ── ຈໍ C: ຢືນຢັນ ແລະ ເລືອກບ່ອນເກັບ ─────────────────────────── */
  if (doc && step === "confirm") {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-5">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep("scan")}
            className="tap-auto -ml-1 rounded-xl p-2 text-zinc-400"
            aria-label="ກັບໄປຍິງຕໍ່"
          >
            <ChevronRightIcon className="h-5 w-5 rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold">{doc.po_no}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {doc.wh_name ?? doc.wh_code}
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label
            htmlFor="m-receive-loc"
            className="mb-2 block text-sm font-bold"
          >
            ເກັບໄວ້ບ່ອນໃດ
          </label>
          <select
            id="m-receive-loc"
            value={locCode}
            onChange={(e) => setLocCode(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">— ເລືອກບ່ອນເກັບ —</option>
            {locations.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name || l.code}
                {l.rack_code ? ` · ${l.rack_code}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            ທັງໃບລົງບ່ອນດຽວກັນ. ຖ້າຕ້ອງແຍກບ່ອນລະລາຍການ ໃຫ້ໃຊ້ໜ້າເວັບເຕັມ.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-bold">
            ລາຍການທີ່ຈະຮັບ ({cart.length})
          </p>
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
            {cart.map((c) => (
              <li key={c.item_code} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.item_name ?? c.item_code}
                  </p>
                  <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {c.item_code}
                  </p>
                </div>
                <span className="shrink-0 text-lg font-bold tabular-nums">
                  {fmt(c.qty)}
                  <span className="ml-1 text-xs font-normal text-zinc-400">
                    {c.unit_code ?? ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <span className="text-sm font-semibold text-zinc-500">ລວມ</span>
            <span className="text-2xl font-bold tabular-nums">{fmt(cartQty)}</span>
          </div>
        </section>

        <button
          type="button"
          onClick={submit}
          disabled={saving || !locCode}
          className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? "ກຳລັງບັນທຶກ..." : "ຢືນຢັນຮັບເຂົ້າສາງ"}
        </button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          ການບັນທຶກນີ້ໂພສເຂົ້າ ERP — ຍົກເລີກເອງພາຍຫຼັງບໍ່ໄດ້
        </p>
      </div>
    );
  }

  /* ── ຈໍ B: ຍິງເຄື່ອງ ─────────────────────────────────────────── */
  if (doc) {
    const outstanding = doc.lines.filter((l) => freeQty(l) > 0);
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-5">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={closeDoc}
            className="tap-auto -ml-1 rounded-xl p-2 text-zinc-400"
            aria-label="ກັບຄືນ"
          >
            <ChevronRightIcon className="h-5 w-5 rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold">{doc.po_no}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {doc.wh_name ?? doc.wh_code} · {doc.cust_name ?? doc.cust_code ?? "—"}
            </p>
          </div>
          <span className="shrink-0 text-right">
            <span className="block text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmt(cartQty)}
            </span>
            <span className="text-[10px] text-zinc-400">ຮັບແລ້ວ</span>
          </span>
        </header>

        <section className="rounded-3xl border-2 border-dashed border-aqua-400 bg-aqua-50 p-5 text-center dark:bg-aqua-950/20">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-aqua-500 text-white">
            <ScanIcon className="h-6 w-6" />
          </span>
          <p className="mt-2 text-base font-bold">ຍິງບາໂຄດ</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            ຫຼື ພິມລະຫັດສິນຄ້າແລ້ວກົດ Enter
          </p>
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
              placeholder="ລະຫັດ / ບາໂຄດ"
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

        {/* ກະຕ່າ — ແກ້ຈຳນວນດ້ວຍປຸ່ມໃຫຍ່ ບໍ່ຕ້ອງພິມ */}
        {cart.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-sm font-bold">ໃນລາຍການ ({cart.length})</p>
            {cart.map((c) => (
              <div
                key={c.item_code}
                className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-snug">
                      {c.item_name ?? c.item_code}
                    </p>
                    <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {c.item_code} · ຄ້າງ {fmt(c.remaining)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(c)}
                    aria-label="ເອົາອອກ"
                    className="tap-auto shrink-0 rounded-lg p-1.5 text-zinc-400"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setQty(c.item_code, c.qty - 1);
                      feedback("tap");
                    }}
                    aria-label="ຫຼຸດຈຳນວນ"
                    className="h-12 w-12 shrink-0 rounded-2xl border border-zinc-300 bg-white text-2xl font-bold dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    −
                  </button>
                  <div className="flex-1 text-center">
                    <p className="text-3xl font-bold leading-none tabular-nums">
                      {fmt(c.qty)}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {c.unit_code ?? "ຈຳນວນ"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQty(c.item_code, c.qty + 1);
                      feedback("tap");
                    }}
                    aria-label="ເພີ່ມຈຳນວນ"
                    className="h-12 w-12 shrink-0 rounded-2xl border border-zinc-300 bg-white text-2xl font-bold dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQty(c.item_code, c.remaining);
                      feedback("ok");
                    }}
                    className="shrink-0 rounded-xl bg-white px-3 text-xs font-bold text-emerald-700 ring-1 ring-emerald-300 dark:bg-zinc-900 dark:text-emerald-400 dark:ring-emerald-800"
                  >
                    ເຕັມ
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ລາຍການທີ່ຍັງບໍ່ໄດ້ຮັບ — ແຕະເພື່ອເພີ່ມ ເມື່ອບາໂຄດອ່ານບໍ່ຕິດ */}
        {outstanding.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
              ຍັງຄ້າງ ({outstanding.length})
            </p>
            {outstanding.map((l) => (
              <button
                key={l.item_code}
                type="button"
                onClick={() => addLine(l)}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 text-left dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {l.item_name ?? l.item_code}
                  </p>
                  <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {l.item_code}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-bold tabular-nums">
                    {fmt(freeQty(l))}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {l.unit_code ?? ""}
                  </span>
                </span>
              </button>
            ))}
          </section>
        )}

        {/* ປຸ່ມຫຼັກ — ຄ້າງຢູ່ລຸ່ມສຸດເໜືອແຖບເມນູ ໃນເຂດນິ້ວໂປ້ */}
        {cart.length > 0 && (
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
            <button
              type="button"
              onClick={() => {
                setStep("confirm");
                feedback("tap");
              }}
              className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-lg font-bold text-white transition active:scale-[0.98] dark:bg-brand-500"
            >
              ຕໍ່ໄປ — ເລືອກບ່ອນເກັບ ({cart.length})
            </button>
          </div>
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

  /* ── ຈໍ A: ເລືອກໃບ ────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ຮັບເຂົ້າ</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          ເລືອກໃບສັ່ງຊື້ທີ່ເຄື່ອງມາຮອດ ແລ້ວຍິງເຂົ້າ
        </p>
      </header>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ຄົ້ນຫາເລກໃບ ຫຼື ຜູ້ສະໜອງ"
          className="w-full rounded-2xl border border-zinc-200 bg-white pl-10 pr-3 text-base outline-none focus:border-brand-500 dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>

      {loading ? (
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
          <ArrowDownIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 font-semibold text-zinc-600 dark:text-zinc-300">
            {q ? `ບໍ່ພົບ “${q}”` : "ບໍ່ມີໃບຄ້າງຮັບ"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={`${d.wh_code}:${d.po_no}`}>
              <button
                type="button"
                onClick={() => {
                  setDoc(d);
                  setCart([]);
                  setStep("scan");
                  feedback("tap");
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-bold">{d.po_no}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {d.wh_name ?? d.wh_code} · {d.cust_name ?? d.cust_code ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{d.doc_date ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {d.lines.length}
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
