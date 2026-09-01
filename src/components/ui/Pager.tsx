import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/Icons";

/**
 * ຕົວບອກໜ້າແບບ Odoo — <span>1-20 / 137</span> ພ້ອມລູກສອນ ‹ ›.
 *
 * ວາງໄວ້ໃນ `right` ຂອງ <Hero> ຈຶ່ງເຫັນ **ຈຳນວນທັງໝົດ** ຕັ້ງແຕ່ແຖວທຳອິດ
 * ໂດຍບໍ່ຕ້ອງເລື່ອນລົງໄປທ້າຍໜ້າ. ນີ້ສຳຄັນກັບໜ້າ WMS ເພາະຄຳຖາມທຳອິດຂອງ
 * ຄົນເປີດໜ້າມັກຈະເປັນ "ຄ້າງຢູ່ຈັກໃບ" ບໍ່ແມ່ນ "ໃບທຳອິດແມ່ນຫຍັງ".
 *
 * ຮັບ href ເປັນ string ເພື່ອໃຫ້ໜ້າ server component ສ້າງ query string ເອງ
 * ຕາມຕົວກອງຂອງມັນ (ແຕ່ລະໜ້າມີຕົວກອງບໍ່ຄືກັນ).
 */
export function Pager({
  page,
  pageSize,
  shown,
  total,
  prevHref,
  nextHref,
}: {
  page: number;
  pageSize: number;
  /** ຈຳນວນແຖວທີ່ສະແດງຢູ່ໜ້ານີ້ຈິງ. */
  shown: number;
  /** ຈຳນວນທັງໝົດ; ໃສ່ null ເມື່ອນັບບໍ່ໄດ້ (ຈະສະແດງແຕ່ຊ່ວງ). */
  total?: number | null;
  prevHref?: string | null;
  nextHref?: string | null;
}) {
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + shown;

  const arrow =
    "inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
  const arrowOff = "inline-flex h-6 w-6 items-center justify-center rounded text-zinc-200 dark:text-zinc-700";

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
        {from}-{to}
        {typeof total === "number" ? ` / ${total.toLocaleString("en-US")}` : ""}
      </span>
      {prevHref ? (
        <Link href={prevHref} className={arrow} aria-label="ໜ້າກ່ອນ">
          <ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />
        </Link>
      ) : (
        <span className={arrowOff} aria-hidden="true">
          <ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={arrow} aria-label="ໜ້າຕໍ່ໄປ">
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className={arrowOff} aria-hidden="true">
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

export default Pager;
