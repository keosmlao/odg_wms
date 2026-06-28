"use client";

import { useRouter } from "next/navigation";

/**
 * Back button shown at the top of a page. Navigates to `href` if given,
 * otherwise to the previous page in history.
 */
export default function BackButton({ href, label = "ກັບຄືນ" }: { href?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (href ? router.push(href) : router.back())}
      className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 cursor-pointer dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 print:hidden"
    >
      <span className="text-base leading-none">←</span> {label}
    </button>
  );
}
