"use client";

import { useEffect, useState } from "react";
import { applyDensity, readDensity, type Density } from "@/lib/density";

/**
 * ສະຫຼັບຄວາມແໜ້ນຂອງຕາຕະລາງ.
 *
 * ຢູ່ຄຽງກັບປຸ່ມໂໝດສີ ເພາະເປັນຄ່າປະເພດດຽວກັນ — ຄ່າຂອງເຄື່ອງ ບໍ່ແມ່ນຂອງບັນຊີ.
 * ມີໄວ້ໃຫ້ຄົນທີ່ຮູ້ສຶກວ່າແໜ້ນເກີນໄປ ກັບໄປແບບເກົ່າໄດ້ທັນທີ ໂດຍບໍ່ຕ້ອງລໍ deploy.
 */
const OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "ແໜ້ນ" },
  { value: "cozy", label: "ຫ່າງ" },
];

export default function DensityToggle() {
  const [density, setDensity] = useState<Density>("compact");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDensity(readDensity());
    setMounted(true);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="ຄວາມແໜ້ນຕາຕະລາງ"
      className="inline-flex w-full items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
    >
      {OPTIONS.map((o) => {
        const active = mounted && density === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setDensity(o.value);
              applyDensity(o.value);
            }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-white text-brand-700 shadow-sm dark:bg-zinc-950 dark:text-aqua-300"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
