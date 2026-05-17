"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Summary = {
  rows_read: number;
  rows_valid: number;
  rows_invalid: number;
  labels_created: number;
  labels_existing: number;
  lines_inserted: number;
  lines_skipped_duplicate: number;
};

type ImportResult = {
  ok?: boolean;
  error?: string;
  summary?: Summary;
  errors?: { row: number; message: string }[];
};

export default function ExcelImport({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setResult({ error: "ກະລຸນາເລືອກໄຟລ໌ .xlsx" });
      return;
    }
    setResult(null);
    setFile(f);
  }

  async function submit() {
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/stocktake/sessions/${sessionId}/import`,
        { method: "POST", body: fd },
      );
      const data = (await res.json()) as ImportResult;
      setResult(data);
      if (res.ok && data.ok && (data.summary?.lines_inserted ?? 0) > 0) {
        router.refresh();
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const s = result?.summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          ຄໍລຳ: <b>ລະຫັດ</b> · <b>ລາຍຊື່</b> · <b>ຫົວໜ່ວຍ</b> ·{" "}
          <b>ຈຳນວນທີກວດນັບ</b> · <b>ທີມ</b>
        </div>
        <a
          href={`/api/stocktake/sessions/${sessionId}/import`}
          className="text-xs font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
        >
          ດາວໂຫຼດ template
        </a>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          dragOver
            ? "border-indigo-400 bg-indigo-50/40 dark:border-indigo-600 dark:bg-indigo-950/30"
            : "border-zinc-200 hover:border-indigo-300 dark:border-zinc-700 dark:hover:border-indigo-700"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        {file ? (
          <>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {file.name}
            </div>
            <div className="text-[11px] text-zinc-500">
              {(file.size / 1024).toFixed(1)} KB · ກົດເພື່ອປ່ຽນ
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              ລາກໄຟລ໌ມາວາງ ຫຼື ກົດເພື່ອເລືອກ
            </div>
            <div className="text-[11px] text-zinc-500">.xlsx ສູງສຸດ 5MB</div>
          </>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!file || busy}
          className="flex-1 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "ກຳລັງນຳເຂົ້າ..." : "ນຳເຂົ້າ"}
        </button>
        {(file || result) && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            ລ້າງ
          </button>
        )}
      </div>

      {result?.error && !s && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300">
          {result.error}
        </div>
      )}

      {s && (
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <Stat label="ອ່ານ" value={s.rows_read} />
            <Stat label="ບັນທຶກ" value={s.lines_inserted} tone="ok" />
            <Stat label="ຂ້າມ" value={s.rows_invalid + s.lines_skipped_duplicate} tone="warn" />
          </div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
            ປ້າຍ: ສ້າງໃໝ່ <b>{s.labels_created}</b> · ມີຢູ່ແລ້ວ{" "}
            <b>{s.labels_existing}</b>
          </div>
          {result?.errors && result.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-semibold text-amber-700 dark:text-amber-400">
                ດູຂໍ້ຜິດພາດ ({result.errors.length})
              </summary>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-white p-2 text-[11px] dark:bg-zinc-950">
                {result.errors.map((er, i) => (
                  <li key={i} className="font-mono text-zinc-600 dark:text-zinc-400">
                    ແຖວ {er.row}: {er.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
      <div className={`font-mono text-lg font-bold leading-none ${valueClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}
