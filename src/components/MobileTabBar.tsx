"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownIcon,
  HomeIcon,
  RouteIcon,
  ScanIcon,
  SettingsIcon,
} from "@/components/ui/Icons";
import { feedback } from "@/lib/feedback";
import ThemeToggle from "@/components/ui/ThemeToggle";

const TABS = [
  { href: "/m", label: "ໜ້າຫຼັກ", icon: <HomeIcon className="h-5 w-5" /> },
  { href: "/m/receive", label: "ຮັບເຂົ້າ", icon: <ArrowDownIcon className="h-5 w-5" /> },
  { href: "/m/pick", label: "ຈັດເຄື່ອງ", icon: <RouteIcon className="h-5 w-5" /> },
  { href: "/m/adjust", label: "ນັບ", icon: <ScanIcon className="h-5 w-5" /> },
];

/**
 * ແຖບລຸ່ມ — ຢູ່ໃນເຂດນິ້ວໂປ້ເອື້ອມເຖິງ.
 *
 * ວາງໄວ້ລຸ່ມບໍ່ແມ່ນເທິງ ເພາະຄົນເຮັດວຽກຖືເຄື່ອງຍິງມືໜຶ່ງ ຖືໂທລະສັບອີກມືໜຶ່ງ
 * ແລະ ນິ້ວໂປ້ເອື້ອມໄດ້ແຕ່ເຄິ່ງລຸ່ມຂອງຈໍ. ມີຄຳກຳກັບໃຕ້ icon ສະເໝີ.
 */
export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="ເມນູຫຼັກ"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      <div className="flex items-stretch">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              data-tap
              onClick={() => feedback("tap")}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold transition ${
                active
                  ? "text-brand-600 dark:text-aqua-300"
                  : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              <span className={active ? "" : "opacity-80"}>{t.icon}</span>
              {t.label}
              <span
                aria-hidden="true"
                className={`mt-0.5 h-0.5 w-6 rounded-full ${active ? "bg-brand-500 dark:bg-aqua-400" : "bg-transparent"}`}
              />
            </Link>
          );
        })}
        <div className="flex w-14 items-center justify-center">
          <ThemeToggle className="h-10 w-10" />
        </div>
      </div>
    </nav>
  );
}
