"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BuildingIcon } from "@/components/ui/Icons";

/**
 * Warehouse selector for the receive pending list — navigates (?wh=) preserving
 * the other params. Styled identically to the goods-issue warehouse dropdown.
 */
export default function WhSelect({ value, options }: { value: string; options: [string, string][] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const onChange = (wh: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set("tab", "pending");
    if (wh) p.set("wh", wh); else p.delete("wh");
    router.push(`/movements/receive?${p}`);
  };
  return (
    <div className="relative w-full sm:max-w-xs">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
        <BuildingIcon className="h-4.5 w-4.5" />
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-xl bg-zinc-50/60 pl-10 pr-10 text-sm font-bold tracking-tight text-zinc-900 ring-1 ring-zinc-200 outline-none transition-all duration-200 hover:ring-zinc-300 focus:bg-white focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950/60 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:bg-zinc-950 cursor-pointer"
      >
        <option value="">ທຸກສາງ</option>
        {options.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
      </span>
    </div>
  );
}
