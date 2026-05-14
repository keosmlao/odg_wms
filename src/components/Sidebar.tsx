"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { Session, WmsRole } from "@/lib/session-shared";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/ui/Icons";

function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-red-50 hover:text-red-600 hover:ring-red-200 disabled:opacity-60 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-red-950/30 dark:hover:text-red-400 dark:hover:ring-red-900/50"
    >
      <LogOutIcon className="h-4 w-4" />
      {loading ? "ກຳລັງອອກ..." : "ອອກຈາກລະບົບ"}
    </button>
  );
}

type SubItem = { label: string; href: string; icon?: ReactNode };
type Group = {
  label: string;
  basePath: string;
  icon: ReactNode;
  items: SubItem[];
  /** Roles allowed to see this group. `null` = visible to anyone with a role. */
  allowedRoles?: WmsRole[] | null;
};

const groups: Group[] = [
  {
    label: "ການເຄື່ອນໄຫວ",
    basePath: "/movements",
    icon: <ArrowLeftRightIcon className="h-4 w-4" />,
    items: [
      {
        label: "ຮັບສິນຄ້າ",
        href: "/movements/receive",
        icon: <ArrowDownIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຈ່າຍສິນຄ້າ",
        href: "/movements/issue",
        icon: <ArrowUpIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ປັບປຸງ stock",
        href: "/movements/adjust",
        icon: <CheckIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "ກວດນັບສິນຄ້າ",
    basePath: "/stocktake",
    icon: <CheckIcon className="h-4 w-4" />,
    items: [
      {
        label: "ຮອບກວດນັບ",
        href: "/stocktake",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ສ້າງຮອບໃໝ່",
        href: "/stocktake/new",
        icon: <CheckIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "ການຕັ້ງຄ່າ",
    basePath: "/settings",
    icon: <SettingsIcon className="h-4 w-4" />,
    items: [
      {
        label: "ສາງ / Rack / Location",
        href: "/settings/warehouses",
        icon: <LayersIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຈັດການສິດເຂົ້າເຖິງ",
        href: "/settings/access",
        icon: <ShieldIcon className="h-3.5 w-3.5" />,
      },
    ],
    allowedRoles: ["manager"],
  },
];

function ChevronIndicator({ open }: { open: boolean }) {
  return (
    <ChevronRightIcon
      className={`h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

const roleColorMap: Record<WmsRole, string> = {
  manager: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  supervisor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  keeper: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function Sidebar({ session }: { session: Session | null }) {
  const pathname = usePathname();

  const visibleGroups = groups.filter((g) => {
    if (!g.allowedRoles) return true;
    return session?.role ? g.allowedRoles.includes(session.role) : false;
  });

  const [isOpen, setIsOpen] = useState(false);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      visibleGroups.map((g) => [g.basePath, pathname.startsWith(g.basePath)]),
    ),
  );

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const toggle = (key: string) => setOpenMap((m) => ({ ...m, [key]: !m[key] }));

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed left-3 top-3 z-[60] inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 shadow-lg shadow-zinc-900/5 transition hover:bg-zinc-50 md:hidden dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        aria-label="ເປີດແຜ່ນນຳ"
      >
        <ListIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <button
          type="button"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden"
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900 md:static md:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-sm font-bold tracking-tight text-white shadow-md shadow-indigo-500/30">
              ODG
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                ODG WMS
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                ຄຸ້ມຄອງຄັງສິນຄ້າ
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 md:hidden"
            aria-label="ປິດແຜ່ນນຳ"
          >
            <ChevronRightIcon className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <Link
          href="/"
          className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
            pathname === "/"
              ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-inset ring-indigo-100 dark:from-indigo-950/60 dark:to-violet-950/40 dark:text-indigo-300 dark:ring-indigo-900/50"
              : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          }`}
        >
          <HomeIcon className="h-4 w-4" />
          ໜ້າຫຼັກ
        </Link>

        <Link
          href="/movements/balance"
          className={`mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
            pathname === "/movements/balance"
              ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-inset ring-indigo-100 dark:from-indigo-950/60 dark:to-violet-950/40 dark:text-indigo-300 dark:ring-indigo-900/50"
              : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          }`}
        >
          <ListIcon className="h-4 w-4" />
          ຄົງເຫຼືອ
        </Link>

        {visibleGroups.map((g) => {
          const open = openMap[g.basePath] ?? false;
          return (
            <div key={g.basePath} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggle(g.basePath)}
                aria-expanded={open}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  open
                    ? "text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                }`}
              >
                <span className={open ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400"}>
                  {g.icon}
                </span>
                <span className="flex-1 text-left">{g.label}</span>
                <ChevronIndicator open={open} />
              </button>

              {open && (
                <ul className="mt-0.5 ml-3.5 space-y-0.5 border-l border-zinc-200 pl-2.5 dark:border-zinc-800">
                  {g.items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                            active
                              ? "bg-gradient-to-r from-indigo-50 to-violet-50 font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100 dark:from-indigo-950/60 dark:to-violet-950/40 dark:text-indigo-300 dark:ring-indigo-900/50"
                              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                          }`}
                        >
                          {item.icon && (
                            <span
                              className={
                                active
                                  ? "text-indigo-600 dark:text-indigo-400"
                                  : "text-zinc-400"
                              }
                            >
                              {item.icon}
                            </span>
                          )}
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {session && (
          <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800/40">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">
              {(
                session.nickname?.trim()?.[0] ||
                session.fullname_lo?.trim()?.[0] ||
                session.employee_code?.[0] ||
                "?"
              ).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {session.nickname?.trim() ||
                  session.fullname_lo?.trim() ||
                  session.employee_code}
              </div>
              <div className="mt-0 flex items-center gap-1.5 text-xs">
                <span className="truncate text-zinc-500 dark:text-zinc-400">
                  {session.employee_code}
                </span>
                {session.role && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${roleColorMap[session.role]}`}
                  >
                    {ROLE_LABEL_LO[session.role]}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        <LogoutButton />
      </div>
    </aside>
  </>
  );
}
