"use client";

import { useEffect } from "react";
import { AlertIcon } from "@/components/ui/Icons";

/**
 * Centered confirm dialog — replaces the native window.confirm() for
 * destructive actions. Controlled via `open`; `onConfirm`/`onCancel` close it.
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "ຢືນຢັນ",
  cancelLabel = "ຍົກເລີກ",
  busy = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmBtn =
    tone === "danger"
      ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-rose-500/20"
      : "bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/20";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone === "danger" ? "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"}`}>
            <AlertIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
            {message && <div className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{message}</div>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50 ${confirmBtn}`}>{busy ? "ກຳລັງດຳເນີນ..." : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
