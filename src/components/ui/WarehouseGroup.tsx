import type { ReactNode } from "react";
import { BuildingIcon, ChevronRightIcon } from "@/components/ui/Icons";
import type { AccentTone } from "@/components/ui/Card";

/**
 * ຫົວກຸ່ມ "ຕາມສາງ" — ໃຊ້ຢູ່ 24 ໜ້າ.
 *
 * ທຸກໜ້າ WMS ບໍ່ມີ dropdown ເລືອກສາງອີກແລ້ວ — ໂຫຼດທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດມາເລີຍ
 * ແລ້ວແຍກເປັນກຸ່ມດ້ວຍຫົວນີ້ ເພື່ອໃຫ້ຍັງອ່ານອອກວ່າແຖວໃດຢູ່ສາງໃດ.
 *
 * ເມື່ອກ່ອນຫົວກຸ່ມເປັນແຖບສູງ ~44px ບວກຊ່ອງໄຟ 12px. ຜູ້ໃຊ້ບາງຄົນມີສິດ 15 ສາງ
 * ຈຶ່ງໝາຍຄວາມວ່າ ~840px ຂອງໜ້າຈໍເປັນຫົວກຸ່ມ ກ່ອນຈະນັບຂໍ້ມູນຈັກແຖວ.
 * ດຽວນີ້ເປັນແຖບບາງ ~28px ຕາມແນວຄິດ group row ຂອງ Odoo ແລະ **ພັບໄດ້** —
 * ຄົນທີ່ເຮັດວຽກສາງດຽວພັບອີກ 14 ສາງເກັບໄວ້ໄດ້.
 *
 * ພັບດ້ວຍ <details> ບໍ່ໃຊ້ JavaScript ເລີຍ ຈຶ່ງໃຊ້ໄດ້ທັງ server component
 * (ຫຼາຍໜ້າທີ່ເອີ້ນຕົວນີ້ເປັນ server component).
 */

const toneRing: Record<AccentTone, string> = {
  neutral: "text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200",
  emerald: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
  red: "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300",
  aqua: "text-aqua-700 bg-aqua-50 dark:bg-aqua-950/40 dark:text-aqua-300",
  navy: "text-brand-900 bg-brand-100 dark:bg-brand-900/50 dark:text-brand-300",
  amber: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300",
  violet: "text-violet-700 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300",
  brand: "text-brand-700 bg-brand-50 dark:bg-brand-950/40 dark:text-brand-300",
};

/** ເນື້ອໃນຂອງແຖບຫົວກຸ່ມ — ໃຊ້ຮ່ວມກັນລະຫວ່າງແບບພັບໄດ້ ແລະ ແບບຢືນດ່ຽວ. */
function GroupBar({
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
    <>
      <span
        className={`inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-black ${toneRing[tone]}`}
      >
        <BuildingIcon className="h-3 w-3" />
        {code}
      </span>
      {name && (
        <span className="truncate text-[13px] font-bold text-zinc-800 dark:text-zinc-100">
          {name}
        </span>
      )}
      {typeof count === "number" && (
        <span className="shrink-0 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
          ({count} {countLabel})
        </span>
      )}
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      {right}
    </>
  );
}

/**
 * ຫົວກຸ່ມແບບຢືນດ່ຽວ — ສຳລັບໜ້າທີ່ຈັດວາງເນື້ອໃນເອງ ບໍ່ໄດ້ຫໍ່ຜ່ານ <WarehouseGroup>.
 *
 * z ຕ່ຳກວ່າແຖບເຄື່ອງມືຂອງໜ້າ (z-10) ໂດຍເຈດຕະນາ — ຖ້າໜ້າໃດມີແຖບຕົວກອງ sticky
 * ຢູ່ແລ້ວ ຫົວກຸ່ມຕ້ອງເລື່ອນລອດຢູ່ຂ້າງລຸ່ມມັນ ບໍ່ແມ່ນຂຶ້ນມາທັບ.
 */
export function WarehouseGroupHeader({
  code,
  name,
  count,
  countLabel,
  tone,
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
    <div className="sticky top-0 z-[5] flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      <GroupBar code={code} name={name} count={count} countLabel={countLabel} tone={tone} right={right} />
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
  defaultOpen = true,
  children,
}: {
  code: string;
  name?: string | null;
  count?: number;
  countLabel?: string;
  tone?: AccentTone;
  right?: ReactNode;
  /** ພັບເກັບໄວ້ຕັ້ງແຕ່ຕົ້ນ — ໃຊ້ເມື່ອໜ້ານັ້ນມີກຸ່ມຫຼາຍເກີນ. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/wh">
      <summary className="sticky top-0 z-[5] flex cursor-pointer list-none flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1.5 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
        <ChevronRightIcon className="wms-chevron h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform" />
        <GroupBar code={code} name={name} count={count} countLabel={countLabel} tone={tone} right={right} />
      </summary>
      <div className="pt-2 pb-1">{children}</div>
    </details>
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
