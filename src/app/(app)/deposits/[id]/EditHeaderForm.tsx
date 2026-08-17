"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline editor for an active deposit's header. Start date is the important
 * one — it drives the elapsed days and therefore the fee tier — so the panel
 * stays collapsed until the user explicitly opens it.
 */
export default function EditHeaderForm({
  depositId,
  startDate,
  custCode,
  custName,
  note,
}: {
  depositId: number;
  startDate: string;
  custCode: string | null;
  custName: string | null;
  note: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    start_date: startDate,
    cust_code: custCode ?? "",
    cust_name: custName ?? "",
    note: note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deposits/${depositId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-zinc-200/70 bg-white/90 px-5 py-3 text-left text-xs font-bold uppercase tracking-wider text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
      >
        ແກ້ໄຂຂໍ້ມູນຮັບຝາກ
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-brand-200/70 bg-white/90 p-5 dark:border-brand-900/40 dark:bg-zinc-900/80">
      <h2 className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
        ແກ້ໄຂຂໍ້ມູນຮັບຝາກ
      </h2>
      <div className="mt-3 space-y-2.5">
        <Field label="ວັນທີ່ເລີ່ມຝາກ">
          <input
            type="date"
            value={form.start_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, start_date: e.target.value }))
            }
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </Field>
        <Field label="ລະຫັດລູກຄ້າ">
          <input
            type="text"
            value={form.cust_code}
            onChange={(e) =>
              setForm((f) => ({ ...f, cust_code: e.target.value }))
            }
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2.5 font-mono text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </Field>
        <Field label="ຊື່ລູກຄ້າ">
          <input
            type="text"
            value={form.cust_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, cust_name: e.target.value }))
            }
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </Field>
        <Field label="ບັນທຶກ">
          <textarea
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </Field>
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
        >
          {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          ຍົກເລີກ
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  );
}
