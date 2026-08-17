import type { ReactNode } from "react";
import { BuildingIcon } from "@/components/ui/Icons";
import type { AccentTone } from "@/components/ui/Card";

/**
 * ຫົວກຸ່ມ "ຕາມສາງ".
 *
 * ທຸກໜ້າ WMS ບໍ່ມີ dropdown ເລືອກສາງອີກແລ້ວ — ໂຫຼດທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດມາເລີຍ
 * ແລ້ວແຍກເປັນກຸ່ມດ້ວຍຫົວນີ້ ເພື່ອໃຫ້ຍັງອ່ານອອກວ່າແຖວໃດຢູ່ສາງໃດ.
 */

const toneRing: Record<AccentTone, string> = {
  neutral: "text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200",
  emerald: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
  red: "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300",
  aqua: "text-aqua-700 bg-aqua-50 dark:bg-aqua-950/40 dark:text-aqua-300",
  navy: "text-brand-900 bg-brand-100 dark:bg-brand-900/50 dark:text-brand-300",
  amber: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300",
  brand: "text-brand-700 bg-brand-50 dark:bg-brand-950/40 dark:text-brand-300",
};

export function WarehouseGroupHeader({
  code,
  name,
  count,
  countLabel = "ລາຍການ",
  tone = "neutral",
  right,
}: {
  code: string;
  name?: string | null;
  count?: number;
  countLabel?: string;
  tone?: AccentTone;
  right?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2.5 rounded-xl bg-white/85 px-3 py-2 backdrop-blur-md dark:bg-zinc-900/85">
      <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] font-black ${toneRing[tone]}`}>
        <BuildingIcon className="h-3.5 w-3.5" />
        {code}
      </span>
      {name && <span className="truncate text-sm font-extrabold text-zinc-800 dark:text-zinc-100">{name}</span>}
      {typeof count === "number" && (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {count} {countLabel}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-r from-zinc-200 to-transparent dark:from-zinc-800" />
      {right}
    </div>
  );
}

export function WarehouseGroup({
  code,
  name,
  count,
  countLabel,
  tone,
  right,
  children,
}: {
  code: string;
  name?: string | null;
  count?: number;
  countLabel?: string;
  tone?: AccentTone;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <WarehouseGroupHeader code={code} name={name} count={count} countLabel={countLabel} tone={tone} right={right} />
      {children}
    </section>
  );
}

/**
 * ຈັດແຖວເປັນກຸ່ມຕາມສາງ ຮຽງຕາມລຳດັບຂອງ `order` (ລາຍຊື່ສາງທີ່ມີສິດ) ກ່ອນ
 * ແລ້ວຄ່ອຍເປັນສາງທີ່ໂຜ່ມາໃນຂໍ້ມູນແຕ່ບໍ່ຢູ່ໃນລາຍຊື່.
 */
export function groupByWarehouse<T>(
  rows: T[],
  key: (row: T) => string,
  order?: { code: string }[],
): { code: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r) || "—";
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  const out: { code: string; rows: T[] }[] = [];
  for (const w of order ?? []) {
    const arr = map.get(w.code);
    if (arr) {
      out.push({ code: w.code, rows: arr });
      map.delete(w.code);
    }
  }
  for (const [code, arr] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ code, rows: arr });
  }
  return out;
}
