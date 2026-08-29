"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { feedback } from "@/lib/feedback";

export type WarehouseOption = { code: string; name: string | null };

type ScanResult = {
  kind?: "location" | "item" | "none";
  location?: { code: string; name: string | null; wh_code: string; rack: string };
  item?: { item_code: string };
  error?: string;
};

const WH_KEY = "m.adjust.wh";

/**
 * ຍິງ location ເພື່ອເຂົ້າໜ້ານັບ.
 *
 * ຊ່ອງຍິງ **focus ໄວ້ຕະຫຼອດ** ເພາະເຄື່ອງຍິງ (laser scanner) ເຮັດວຽກຄືແປ້ນພິມ —
 * ຖ້າ focus ຫຼຸດ ລະຫັດຈະຕົກຫາຍໄປໂດຍບໍ່ມີໃຜຮູ້. ກ້ອງເປັນທາງເລືອກສຳລັບເຄື່ອງ
 * ທີ່ບໍ່ມີ scanner.
 */
export default function ScanLocationClient({
  warehouses,
  userName,
}: {
  warehouses: WarehouseOption[];
  userName: string;
}) {
  const router = useRouter();
  const [wh, setWh] = useState(warehouses[0]?.code ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * ຕັ້ງຂໍ້ຄວາມຜິດພາດ ພ້ອມສັ່ນສອງຈັງຫວະ.
   * ຄົນຍິງເຄື່ອງບໍ່ໄດ້ຈ້ອງຈໍຕະຫຼອດ — ຖ້າຜິດຕ້ອງຮູ້ສຶກໄດ້ດ້ວຍມື.
   */
  function setErrFx(message: string | null) {
    setErr(message);
    if (message) feedback("error");
  }
  const [cam, setCam] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ຈື່ສາງທີ່ເລືອກໄວ້ — ຄົນນັບຢູ່ສາງດຽວທັງມື້ ບໍ່ຄວນເລືອກໃໝ່ທຸກເທື່ອ
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(WH_KEY) : null;
    if (saved && warehouses.some((w) => w.code === saved)) setWh(saved);
  }, [warehouses]);

  useEffect(() => {
    if (wh) localStorage.setItem(WH_KEY, wh);
  }, [wh]);

  useEffect(() => {
    if (!cam) inputRef.current?.focus();
  }, [cam, busy]);

  async function resolve(raw: string) {
    const value = raw.trim();
    if (!value || !wh) return;
    setBusy(true);
    setErrFx(null);
    try {
      const res = await fetch(
        `/api/movements/scan?code=${encodeURIComponent(value)}&wh=${encodeURIComponent(wh)}`,
      );
      const json = (await res.json()) as ScanResult;
      if (!res.ok) {
        setErrFx(json.error ?? "ຄົ້ນຫາບໍ່ສຳເລັດ");
      } else if (json.kind === "location" && json.location) {
        const l = json.location;
        router.push(`/m/adjust/${encodeURIComponent(l.wh_code)}/${encodeURIComponent(l.code)}`);
        return;
      } else if (json.kind === "item") {
        // ຍິງສິນຄ້າກ່ອນເລືອກ location ບໍ່ໄດ້ — ບອກໃຫ້ຊັດ ບໍ່ແມ່ນປ່ອຍງຽບ
        setErrFx("ນີ້ແມ່ນລະຫັດສິນຄ້າ — ໃຫ້ຍິງປ້າຍ location ກ່ອນ ແລ້ວຈຶ່ງຍິງສິນຄ້າ");
      } else {
        setErrFx(`ບໍ່ພົບ "${value}" ໃນລະບົບ`);
      }
    } catch {
      setErrFx("ຕິດຕໍ່ເຊີບເວີບໍ່ໄດ້");
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <div>
          <div className="text-[15px] font-black leading-tight">ປັບປຸງສະຕ໋ອກ</div>
          <div className="text-[11px] opacity-80">{userName}</div>
        </div>
        <a href="/" className="rounded-lg bg-white/15 px-3 py-1.5 text-[12px] font-semibold">
          ໜ້າຫຼັກ
        </a>
      </header>

      <main className="flex-1 space-y-4 p-4">
        <div>
          <label className="mb-1 block text-[12px] font-bold text-zinc-600 dark:text-zinc-400">
            ສາງ
          </label>
          <select
            value={wh}
            onChange={(e) => setWh(e.target.value)}
            className="w-full rounded-xl bg-white px-3 py-3 text-base font-semibold ring-1 ring-zinc-300 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-700"
          >
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-bold text-zinc-600 dark:text-zinc-400">
            ຍິງປ້າຍ location
          </label>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void resolve(code);
            }}
            inputMode="text"
            autoComplete="off"
            placeholder="ເຊັ່ນ 120301-A259"
            disabled={busy}
            className="w-full rounded-xl bg-white px-3 py-4 text-center font-mono text-lg font-bold tracking-wide ring-2 ring-brand-400 outline-none focus:ring-4 focus:ring-brand-500 disabled:opacity-60 dark:bg-zinc-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void resolve(code)}
            disabled={busy || !code.trim()}
            className="rounded-xl bg-brand-600 py-4 text-base font-bold text-white disabled:opacity-40"
          >
            {busy ? "..." : "ເປີດ"}
          </button>
          <button
            type="button"
            onClick={() => setCam(true)}
            className="rounded-xl bg-zinc-200 py-4 text-base font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            ກ້ອງ
          </button>
        </div>

        {err && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold leading-relaxed text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
            {err}
          </div>
        )}

        <p className="text-center text-[11px] leading-relaxed text-zinc-400">
          ຍິງປ້າຍ location ກ່ອນ → ເປີດໜ້ານັບ → ຍິງສິນຄ້າເພີ່ມເຂົ້າ
        </p>
      </main>

      {cam && (
        <BarcodeScanner
          onDetect={(text) => {
            setCam(false);
            void resolve(text);
          }}
          onClose={() => setCam(false)}
        />
      )}
    </div>
  );
}
