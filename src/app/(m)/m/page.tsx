import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ChevronRightIcon,
  ListIcon,
  RouteIcon,
  ScanIcon,
} from "@/components/ui/Icons";

/**
 * ໜ້າຫຼັກມືຖື — ໜຶ່ງໜ້າຈໍ ເຫັນທຸກວຽກທີ່ຕ້ອງເຮັດ.
 *
 * ບໍ່ມີເມນູຊ້ອນຊັ້ນ ບໍ່ມີຕາຕະລາງ: ບັດໃຫຍ່ 4 ອັນສຳລັບວຽກປະຈຳວັນ ແລ້ວຈຶ່ງເປັນ
 * ທາງລັດໄປໜ້າອື່ນ. ຄົນໃໝ່ເປີດແອັບເທື່ອທຳອິດຄວນຮູ້ທັນທີວ່າຈະກົດອັນໃດ.
 */

type Tile = {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  tone: "emerald" | "brand" | "aqua" | "sunset";
};

const TILES: Tile[] = [
  {
    href: "/m/receive",
    label: "ຮັບເຂົ້າ",
    desc: "ຍິງເຄື່ອງທີ່ມາຮອດ ແລ້ວຮັບເຂົ້າສາງ",
    icon: <ArrowDownIcon className="h-7 w-7" />,
    tone: "emerald",
  },
  {
    href: "/m/pick",
    label: "ຈັດເຄື່ອງ",
    desc: "ໃບຈັດເຄື່ອງ — ຍິງຕາມລາຍການ",
    icon: <RouteIcon className="h-7 w-7" />,
    tone: "brand",
  },
  {
    href: "/m/adjust",
    label: "ນັບ / ປັບປຸງ",
    desc: "ຍິງປ້າຍບ່ອນເກັບ ແລ້ວນັບ",
    icon: <ScanIcon className="h-7 w-7" />,
    tone: "aqua",
  },
  {
    href: "/movements/balance",
    label: "ຄົງເຫຼືອ",
    desc: "ເບິ່ງຈຳນວນທີ່ມີໃນສາງ",
    icon: <ListIcon className="h-7 w-7" />,
    tone: "sunset",
  },
];

const TONE: Record<Tile["tone"], string> = {
  emerald:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  brand:
    "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900",
  aqua: "bg-aqua-50 text-aqua-700 ring-aqua-200 dark:bg-aqua-950/40 dark:text-aqua-300 dark:ring-aqua-900",
  sunset:
    "bg-sunset-50 text-sunset-700 ring-sunset-200 dark:bg-sunset-950/40 dark:text-sunset-300 dark:ring-sunset-900",
};

export default async function MobileHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const name =
    session.nickname?.trim() ||
    session.fullname_lo?.trim() ||
    session.employee_code ||
    "";

  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? "ສະບາຍດີຕອນເຊົ້າ"
      : hour >= 12 && hour < 17
        ? "ສະບາຍດີຕອນແລງ"
        : "ສະບາຍດີຕອນຄ່ຳ";

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-6">
      <header>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{greeting}</p>
        <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
        {session.role && (
          <span className="mt-1.5 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            {ROLE_LABEL_LO[session.role] ?? session.role}
          </span>
        )}
      </header>

      {!session.role && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS — ຕິດຕໍ່ຫົວໜ້າສາງ
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            data-tap
            className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 transition active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span
              className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ring-1 ${TONE[t.tone]}`}
            >
              {t.icon}
            </span>
            <span className="text-lg font-bold leading-tight">{t.label}</span>
            <span className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
              {t.desc}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href="/movements/transfer-dashboard"
          data-tap
          className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <ArrowLeftRightIcon className="h-5 w-5 shrink-0 text-zinc-400" />
          <span className="flex-1 font-semibold">ໂອນສາງ</span>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        </Link>
        <Link
          href="/"
          data-tap
          className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <ListIcon className="h-5 w-5 shrink-0 text-zinc-400" />
          <span className="flex-1 font-semibold">
            ເປີດເວັບເຕັມ
            <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
              ລາຍງານ ແລະ ການຕັ້ງຄ່າທັງໝົດ
            </span>
          </span>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        </Link>
      </div>
    </div>
  );
}
