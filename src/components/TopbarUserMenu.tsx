"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session, WmsRole } from "@/lib/session-shared";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { ChevronRightIcon, LogOutIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/ui/ThemeToggle";
import SoundToggle from "@/components/ui/SoundToggle";
import DensityToggle from "@/components/ui/DensityToggle";

const roleColorMap: Record<WmsRole, string> = {
  manager:
    "bg-aqua-100 text-aqua-700 dark:bg-aqua-900/40 dark:text-aqua-300",
  supervisor:
    "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  keeper:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const roleRingMap: Record<WmsRole, string> = {
  manager: "ring-2 ring-aqua-500/60 ring-offset-2 dark:ring-offset-zinc-950",
  supervisor: "ring-2 ring-brand-500/60 ring-offset-2 dark:ring-offset-zinc-950",
  keeper: "ring-2 ring-emerald-500/60 ring-offset-2 dark:ring-offset-zinc-950",
};

const roleGradientMap: Record<WmsRole, string> = {
  manager: "bg-gradient-to-tr from-aqua-500 via-brand-600 to-brand-900 text-white",
  supervisor: "bg-gradient-to-tr from-brand-600 via-brand-500 to-aqua-500 text-white",
  keeper: "bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-500 text-white",
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

  const role = session.role;
  const avatarRing = role ? roleRingMap[role] : "ring-2 ring-zinc-300 dark:ring-zinc-700 ring-offset-2 dark:ring-offset-zinc-950";
  const avatarBg = role ? roleGradientMap[role] : "bg-gradient-to-tr from-zinc-700 to-zinc-800 text-white";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-200/50 bg-white/60 py-1 pl-1 pr-3 text-sm transition-all hover:bg-white hover:border-zinc-300 dark:border-zinc-800/50 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm transition-all ${avatarRing} ${avatarBg}`}>
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate text-zinc-700 font-semibold sm:inline dark:text-zinc-200">
          {displayName}
        </span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/95 backdrop-blur-2xl shadow-xl shadow-zinc-200/40 dark:border-zinc-800/50 dark:bg-zinc-900/95 dark:shadow-none animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm ${avatarBg}`}>
                {initial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
                  {displayName}
                </div>
                <div className="truncate text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  {session.employee_code}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {role ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${roleColorMap[role]}`}
                >
                  {ROLE_LABEL_LO[role]}
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5 text-[10px] font-bold">
                  ຍັງບໍ່ມີສິດ WMS
                </span>
              )}
              {role && role !== "manager" && (
                <span className="rounded-full bg-zinc-50 border border-zinc-200/50 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800/60 dark:border-zinc-800 dark:text-zinc-400">
                  {session.warehouses.length} ສາງ
                </span>
              )}
            </div>
          </div>
          {/* ຄ່າຂອງເຄື່ອງ — ໂໝດສີ ແລະ ສຽງ. ເກັບໄວ້ໃນເຄື່ອງນີ້ ບໍ່ຜູກກັບບັນຊີ
              ເພາະຄົນດຽວກັນໃຊ້ມືຖືໃນສາງ ແລະ ຄອມໃນຫ້ອງການ. */}
          <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-800">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              ໂໝດສີ
            </p>
            <ThemeToggle variant="segmented" className="w-full justify-between" />
            <p className="mb-2 mt-3 px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              ຄວາມແໜ້ນຕາຕະລາງ
            </p>
            <DensityToggle />
          </div>
          <div className="p-1">
            <SoundToggle />
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-red-950/20 dark:hover:text-red-400"
            >
              <LogOutIcon className="h-4.5 w-4.5 text-zinc-400 group-hover:text-red-500 dark:text-zinc-500" />
              {loggingOut ? "ກຳລັງອອກ..." : "ອອກຈາກລະບົບ"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
