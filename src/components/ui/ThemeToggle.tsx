"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/ui/Icons";
import { applyTheme, readThemePref, resolveTheme, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "ແຈ້ງ", icon: <SunIcon className="h-4 w-4" /> },
  { value: "dark", label: "ມືດ", icon: <MoonIcon className="h-4 w-4" /> },
  { value: "system", label: "ຕາມເຄື່ອງ", icon: <MonitorIcon className="h-4 w-4" /> },
];

/**
 * ປຸ່ມສະຫຼັບໂໝດແຈ້ງ/ມືດ.
 *
 * ກ່ອນນີ້ໂໝດມືດມາຈາກ prefers-color-scheme ຢ່າງດຽວ — ຄົນເລືອກເອງບໍ່ໄດ້.
 * ໃນສາງທີ່ແສງປ່ຽນຕະຫຼອດມື້ ນີ້ຄືປຸ່ມທີ່ຖືກກົດຈິງ.
 *
 * `variant="segmented"` ໃຫ້ 3 ຕົວເລືອກເຕັມ (ໜ້າຕັ້ງຄ່າ / ເມນູ),
 * `variant="icon"` ໝູນວຽນ ແຈ້ງ → ມືດ → ຕາມເຄື່ອງ ດ້ວຍການກົດເທື່ອດຽວ (topbar).
 */
export default function ThemeToggle({
  variant = "icon",
  className = "",
}: {
  variant?: "icon" | "segmented";
  className?: string;
}) {
  // "system" ເປັນຄ່າເລີ່ມຕົ້ນຝັ່ງ server — ຫຼີກ hydration mismatch ເພາະ server
  // ບໍ່ຮູ້ຈັກ localStorage. ຄ່າຈິງມາຕອນ mount.
  const [pref, setPref] = useState<ThemePref>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPref(readThemePref());
    setMounted(true);
  }, []);

  // ເມື່ອເລືອກ "ຕາມເຄື່ອງ" ຕ້ອງຕິດຕາມການປ່ຽນຂອງ OS ແບບ live
  // (ຜູ້ໃຊ້ຕັ້ງໃຫ້ມືຖືສະຫຼັບເປັນມືດຕອນຄ່ຳ — ໜ້າຈໍຄວນຕາມທັນທີ).
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePref) {
    setPref(next);
    applyTheme(next);
  }

  if (variant === "segmented") {
    return (
      <div
        role="radiogroup"
        aria-label="ໂໝດສີ"
        className={`inline-flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800 ${className}`}
      >
        {OPTIONS.map((opt) => {
          const active = mounted && pref === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(opt.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-white text-brand-700 shadow-sm dark:bg-zinc-950 dark:text-aqua-300"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  const order: ThemePref[] = ["light", "dark", "system"];
  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2];
  const nextPref = order[(order.indexOf(pref) + 1) % order.length];
  const nextLabel = OPTIONS.find((o) => o.value === nextPref)?.label ?? "";

  return (
    <button
      type="button"
      onClick={() => choose(nextPref)}
      title={`ໂໝດ: ${current.label} — ກົດເພື່ອປ່ຽນເປັນ ${nextLabel}`}
      aria-label={`ໂໝດສີ: ${current.label}. ກົດເພື່ອປ່ຽນເປັນ ${nextLabel}`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/60 bg-white/70 text-zinc-600 transition hover:bg-white hover:text-brand-600 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-aqua-300 ${className}`}
    >
      {/* ກ່ອນ mount ສະແດງ icon ກາງໆ ເພື່ອບໍ່ໃຫ້ markup ຝັ່ງ server ຕ່າງກັບ client */}
      {mounted ? current.icon : <MonitorIcon className="h-4 w-4" />}
    </button>
  );
}
