"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg"
    >
      ພິມ
    </button>
  );
}
