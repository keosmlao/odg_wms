"use client";

import { useEffect, useState } from "react";
import { feedback, setSoundEnabled, soundEnabled } from "@/lib/feedback";

/**
 * ເປີດ/ປິດສຽງຕອບກັບ.
 *
 * ການສັ່ນຍັງເຮັດວຽກຢູ່ສະເໝີ — ປິດໄດ້ແຕ່ສຽງ. ບາງຄົນເຮັດວຽກໃນຫ້ອງງຽບ ຫຼື ໃສ່ຫູຟັງ
 * ຢູ່ ຈຶ່ງບໍ່ຢາກໃຫ້ດັງ; ແຕ່ໃນສາງທີ່ສຽງດັງ ສຽງ “ຕິ໊ດ” ຄືສິ່ງທີ່ບອກວ່າຍິງຕິດ.
 */
export default function SoundToggle() {
  const [on, setOn] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setOn(soundEnabled());
    setMounted(true);
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
    // ຟັງຕົວຢ່າງທັນທີເມື່ອເປີດ — ຄົນຈະຮູ້ວ່າສຽງດັງແບບໃດ
    if (next) feedback("ok");
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={mounted ? on : true}
      onClick={toggle}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
    >
      <span className="text-zinc-400 dark:text-zinc-500" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4z" />
          {mounted && !on ? (
            <path d="m22 9-6 6M16 9l6 6" />
          ) : (
            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
          )}
        </svg>
      </span>
      <span className="flex-1 text-left">ສຽງຕອບກັບ</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          mounted && !on ? "bg-zinc-300 dark:bg-zinc-700" : "bg-brand-500"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            mounted && !on ? "left-0.5" : "left-[1.125rem]"
          }`}
        />
      </span>
    </button>
  );
}
