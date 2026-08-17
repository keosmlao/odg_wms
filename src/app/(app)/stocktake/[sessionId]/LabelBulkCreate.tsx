"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LabelBulkCreate({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState("a");
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(10);
  const [padding, setPadding] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function previewSample(): string[] {
    const samples: string[] = [];
    for (let n = start; n <= Math.min(end, start + 2); n++) {
      samples.push(`${prefix}${String(n).padStart(padding, "0")}`);
    }
    if (end > start + 2) {
      samples.push("...");
      samples.push(`${prefix}${String(end).padStart(padding, "0")}`);
    }
    return samples;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!prefix || end < start) {
      setErr("ລະບຸ prefix ແລະ ຊ່ວງເລກໃຫ້ຖືກຕ້ອງ");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/stocktake/sessions/${sessionId}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, start, end, padding }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        inserted?: number;
        skipped?: number;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setMsg(
        `ສ້າງສຳເລັດ ${data.inserted} ປ້າຍ${data.skipped ? ` (ຂ້າມຊ້ຳ ${data.skipped})` : ""}`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 sm:grid-cols-[120px_100px_100px_100px_1fr]"
    >
      <Field label="prefix">
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          maxLength={20}
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-mono text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>
      <Field label="ຈາກ">
        <input
          type="number"
          value={start}
          min={0}
          onChange={(e) => setStart(Number.parseInt(e.target.value, 10) || 0)}
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-mono text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>
      <Field label="ຫາ">
        <input
          type="number"
          value={end}
          min={0}
          onChange={(e) => setEnd(Number.parseInt(e.target.value, 10) || 0)}
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-mono text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>
      <Field label="ຫຼັກເລກ">
        <input
          type="number"
          value={padding}
          min={1}
          max={6}
          onChange={(e) => setPadding(Number.parseInt(e.target.value, 10) || 2)}
          className="w-full rounded-lg bg-white px-3 py-2 text-sm font-mono text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
        />
      </Field>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:opacity-60"
        >
          {busy ? "ກຳລັງສ້າງ..." : `ສ້າງ ${Math.max(0, end - start + 1)} ປ້າຍ`}
        </button>
      </div>

      <div className="sm:col-span-5 -mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>ຕົວຢ່າງ:</span>
        {previewSample().map((s, i) => (
          <span
            key={i}
            className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {s}
          </span>
        ))}
      </div>

      {err && (
        <div className="sm:col-span-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300">
          {err}
        </div>
      )}
      {msg && (
        <div className="sm:col-span-5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
          {msg}
        </div>
      )}
    </form>
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
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}
