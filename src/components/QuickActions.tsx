"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { quickActions } from "@/lib/nav";
import { feedback } from "@/lib/feedback";

/**
 * ປຸ່ມວຽກປະຈຳວັນ 4 ອັນ ຄ້າງຢູ່ແຖບເທິງທຸກໜ້າ.
 *
 * ຈຸດປະສົງຄື ບໍ່ໃຫ້ຄົນຕ້ອງໄລ່ຫາໃນເມນູ 9 ກຸ່ມເພື່ອເຮັດວຽກທີ່ເຮັດທຸກມື້.
 * ໃສ່ຄຳກຳກັບໃຕ້/ຂ້າງ icon ສະເໝີ — icon ຢ່າງດຽວຄວາມໝາຍບໍ່ຕົງກັນລະຫວ່າງຄົນ.
 */
export default function QuickActions({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="ວຽກປະຈຳວັນ" className={`flex items-center gap-1 ${className}`}>
      {quickActions.map((a) => {
        const active = pathname === a.href || pathname.startsWith(a.href + "/");
        return (
          <Link
            key={a.href}
            href={a.href}
            data-tap
            onClick={() => feedback("tap")}
            title={a.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-brand-500/10 text-brand-700 dark:bg-brand-500/20 dark:text-aqua-300"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-brand-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-aqua-300"
            }`}
          >
            <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{a.icon}</span>
            <span className="hidden lg:inline">{a.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
