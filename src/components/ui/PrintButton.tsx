"use client";

/** Triggers the browser print dialog for the current print view. */
export default function PrintButton({ label = "ພິມ" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg"
    >
      {label}
    </button>
  );
}
