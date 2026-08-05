"use client";

/** Triggers the browser print dialog for the current print view. */
export default function PrintButton({ label = "ພິມ" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg"
    >
      {label}
    </button>
  );
}
