import Link from "next/link";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopbarUserMenu from "@/components/TopbarUserMenu";
import CommandPalette from "@/components/CommandPalette";
import QuickActions from "@/components/QuickActions";
import ToastProvider from "@/components/ui/Toast";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { getSession } from "@/lib/session";
import { BUILD_STAMP } from "@/lib/buildStamp";
import { CalendarIcon, ScanIcon } from "@/components/ui/Icons";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const displayName =
    session?.nickname?.trim() ||
    session?.fullname_lo?.trim() ||
    session?.employee_code ||
    null;

  const hour = new Date().getHours();
  let greeting = "ສະບາຍດີ";
  if (hour >= 5 && hour < 12) {
    greeting = "ສະບາຍດີຕອນເຊົ້າ 🌅";
  } else if (hour >= 12 && hour < 17) {
    greeting = "ສະບາຍດີຕອນແລງ 🌇";
  } else {
    greeting = "ສະບາຍດີຕອນຄ່ຳ 🌌";
  }

  return (
    <ToastProvider>
      <div className="bg-mesh flex h-dvh w-full bg-zinc-50 dark:bg-zinc-950">
        <Sidebar session={session} buildStamp={BUILD_STAMP} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-zinc-200/40 bg-white/60 px-4 backdrop-blur-xl shadow-sm shadow-zinc-100/50 sm:px-6 dark:border-zinc-800/40 dark:bg-zinc-900/60 dark:shadow-none">
            <div className="ml-12 flex min-w-0 items-center gap-3 text-sm md:ml-0">
              {displayName && (
                <span className="hidden truncate text-zinc-600 xl:inline dark:text-zinc-400">
                  {greeting},{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {displayName}
                  </span>
                </span>
              )}
              {/* ວຽກປະຈຳວັນ 4 ອັນ — ຢູ່ບ່ອນເກົ່າສະເໝີທຸກໜ້າ */}
              <QuickActions className="hidden sm:flex" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* ເທິງມືຖື ໜ້າ desktop ອ່ານໄດ້ແຕ່ເຮັດວຽກຊ້າ — ຊີ້ໄປແອັບມືຖືໃຫ້ເຫັນຊັດ */}
              <Link
                href="/m"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-bold text-brand-700 sm:hidden dark:bg-brand-500/20 dark:text-aqua-300"
              >
                <ScanIcon className="h-3.5 w-3.5" />
                ໂໝດມືຖື
              </Link>
              <CommandPalette session={session} />
              <ThemeToggle />
              <div className="hidden items-center gap-2 rounded-full border border-zinc-200/50 bg-zinc-100/60 px-3.5 py-1 text-xs font-medium text-zinc-600 shadow-sm sm:flex dark:border-zinc-800/50 dark:bg-zinc-800/40 dark:text-zinc-400 dark:shadow-none">
                <CalendarIcon className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                <span>
                  {new Date().toLocaleDateString("lo-LA", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
              <TopbarUserMenu session={session} />
            </div>
          </header>
          {/* .wms-dense = ຂອບເຂດຂອງການຫຍໍ້ຄວາມສູງແຖວຕາຕະລາງ (globals.css).
              ຢູ່ນີ້ ບໍ່ແມ່ນທີ່ <body> ເພື່ອບໍ່ໃຫ້ກະທົບໜ້າມືຖື / login / ພິມ. */}
          <main className="wms-dense flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
