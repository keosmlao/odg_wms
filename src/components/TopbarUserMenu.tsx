"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session, WmsRole } from "@/lib/session-shared";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { ChevronRightIcon, LogOutIcon } from "@/components/ui/Icons";

const roleColorMap: Record<WmsRole, string> = {
  manager:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  supervisor:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  keeper:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function TopbarUserMenu({ session }: { session: Session }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initial = (
    session.nickname?.trim()?.[0] ||
    session.fullname_lo?.trim()?.[0] ||
    session.employee_code?.[0] ||
    "?"
  ).toUpperCase();
  const displayName =
    session.nickname?.trim() ||
    session.fullname_lo?.trim() ||
    session.employee_code;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-200/70 bg-white/60 py-1 pl-1 pr-2.5 text-sm transition hover:bg-white dark:border-zinc-700/70 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-950">
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate text-zinc-900 sm:inline dark:text-zinc-100">
          {displayName}
        </span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-white dark:text-zinc-950">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {displayName}
                </div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {session.employee_code}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {session.role ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColorMap[session.role]}`}
                >
                  {ROLE_LABEL_LO[session.role]}
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  ຍັງບໍ່ມີສິດ WMS
                </span>
              )}
              {session.role && session.role !== "manager" && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {session.warehouses.length} ສາງ
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          >
            <LogOutIcon className="h-4 w-4" />
            {loggingOut ? "ກຳລັງອອກ..." : "ອອກຈາກລະບົບ"}
          </button>
        </div>
      )}
    </div>
  );
}
