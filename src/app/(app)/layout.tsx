import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { CalendarIcon } from "@/components/ui/Icons";

const roleColorMap: Record<string, string> = {
  manager:
    "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50",
  supervisor:
    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/50",
  keeper:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const displayName =
    session?.nickname?.trim() ||
    session?.fullname_lo?.trim() ||
    session?.employee_code ||
    null;

  return (
    <div className="bg-mesh flex h-dvh w-full bg-zinc-50 dark:bg-zinc-950">
      <Sidebar session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-white/70 px-6 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-900/70">
          <div className="flex items-center gap-3 text-sm">
            {displayName ? (
              <>
                <span className="text-zinc-600 dark:text-zinc-400">
                  ສະບາຍດີ,{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {displayName}
                  </span>
                  {session?.employee_code && (
                    <span className="ml-1.5 text-xs text-zinc-400">
                      · {session.employee_code}
                    </span>
                  )}
                </span>
                {session?.role ? (
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${roleColorMap[session.role]}`}
                  >
                    {ROLE_LABEL_LO[session.role]}
                    {session.role !== "manager" && (
                      <span className="ml-1 opacity-70">
                        · {session.warehouses.length} ສາງ
                      </span>
                    )}
                  </span>
                ) : (
                  session && (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
                      ຍັງບໍ່ມີສິດ WMS
                    </span>
                  )
                )}
              </>
            ) : (
              <Link
                href="/login"
                className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
              >
                ກະລຸນາເຂົ້າສູ່ລະບົບ
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <CalendarIcon className="h-3.5 w-3.5 text-zinc-400" />
            {new Date().toLocaleDateString("lo-LA")}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
