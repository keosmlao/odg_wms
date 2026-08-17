"use client";

import { PrinterIcon } from "@/components/ui/Icons";

/** ພິມສະເພາະເນື້ອໃນເອກະສານ (ໃຊ້ຮ່ວມກັບ .print-sheet ໃນ globals.css). */
export default function PrintButton({ label = "ພິມ" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-900 print:hidden dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
    >
      <PrinterIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
