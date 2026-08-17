"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WmsRole } from "@/lib/session-shared";

type Warehouse = { code: string; name: string | null };

export default function NewSessionForm({
  warehouses,
  role,
}: {
  warehouses: Warehouse[];
  role: WmsRole;
}) {
  const canToggleBlind = role === "manager" || role === "supervisor";
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [whCode, setWhCode] = useState(warehouses[0]?.code ?? "");
  const [name, setName] = useState("");
  const [countDate, setCountDate] = useState(today);
  const [note, setNote] = useState("");
  const [blind, setBlind] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!whCode) {
      setError("ກະລຸນາເລືອກສາງ");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stocktake/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          name,
          count_date: countDate,
          note,
          blind,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        session?: { session_id: number };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "ສ້າງບໍ່ສຳເລັດ");
      }
      router.push(`/stocktake/${data.session!.session_id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ສ້າງບໍ່ສຳເລັດ");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="ສາງ" required>
        <select
          value={whCode}
          onChange={(e) => setWhCode(e.target.value)}
          required
          className="w-full rounded-2xl bg-white px-3 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        >
          <option value="">ເລືອກສາງ...</option>
          {warehouses.map((w) => (
            <option key={w.code} value={w.code}>
              {w.code}
              {w.name ? ` · ${w.name}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="ຊື່ຮອບ" hint="ເຊັ່ນ: ກວດນັບປະຈຳເດືອນ 05">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="w-full rounded-2xl bg-white px-3 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>

      <Field label="ວັນທີກວດນັບ" required>
        <input
          type="date"
          value={countDate}
          onChange={(e) => setCountDate(e.target.value)}
          required
          className="w-full rounded-2xl bg-white px-3 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>

      <Field label="ບັນທຶກ" hint="optional">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-2xl bg-white px-3 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>

      <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-700">
        <label
          className={`flex items-start gap-3 ${
            canToggleBlind ? "cursor-pointer" : "cursor-not-allowed"
          }`}
        >
          <input
            type="checkbox"
            checked={blind}
            onChange={(e) => canToggleBlind && setBlind(e.target.checked)}
            disabled={!canToggleBlind}
            className="mt-1 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500 disabled:opacity-60"
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Blind count
              <span className="ml-2 text-xs font-normal text-zinc-500">
                (ແນະນຳ)
              </span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              ຄົນກວດນັບຈະບໍ່ເຫັນຍອດຄົງເຫຼືອໃນ SML ໃນຂະນະທີ່ນັບ —
              ຊ່ວຍຫຼຸດການ bias "ນັບໃຫ້ກົງ". Supervisor ສາມາດເປີດ-ປິດ
              ໄດ້ພາຍຫຼັງ.
            </div>
            {!canToggleBlind && (
              <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                ບົດບາດຂອງທ່ານ (keeper) ບໍ່ສາມາດປິດ blind ໄດ້ —
                ບັງຄັບເປີດເພື່ອຄວາມຖືກຕ້ອງ
              </div>
            )}
          </div>
        </label>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-aqua-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg hover:shadow-brand-500/30 disabled:opacity-60"
      >
        {submitting ? "ກຳລັງສ້າງ..." : "ສ້າງຮອບກວດນັບ"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && (
          <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-500">
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
