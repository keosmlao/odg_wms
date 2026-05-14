"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
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

function LogoutButton({ collapsed }: { collapsed: boolean }) {
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
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-zinc-700 transition-all hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-red-950/30 dark:hover:text-red-400 ${
        collapsed ? "justify-center" : "w-full"
      }`}
      title={collapsed ? "ອອກຈາກລະບົບ" : undefined}
    >
      <LogOutIcon className="h-4 w-4 shrink-0" />
      {!collapsed && (loading ? "ກຳລັງອອກ..." : "ອອກຈາກລະບົບ")}
    </button>
  );
}

type SubItem = { label: string; href: string; icon?: ReactNode };
type Group = {
  label: string;
  basePath: string;
  icon: ReactNode;
  items: SubItem[];
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

const roleColorMap: Record<WmsRole, string> = {
  manager:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  supervisor:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  keeper:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function Sidebar({ session }: { session: Session | null }) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const visibleGroups = groups.filter((g) => {
    if (!g.allowedRoles) return true;
    return session?.role ? g.allowedRoles.includes(session.role) : false;
  });

  return (
    <>
      {/* Mobile menu button - uses ListIcon as in original */}
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="fixed left-3 top-3 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 shadow-lg shadow-zinc-900/5 backdrop-blur-sm transition hover:bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200"
        aria-label="ເປີດແຜ່ນນຳ"
      >
        <ListIcon className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <button
          type="button"
          aria-hidden="true"
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar - collapsible on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-200/70 bg-white/90 backdrop-blur-md transition-all duration-300 dark:border-zinc-800/70 dark:bg-zinc-900/90 ${
          isCollapsed ? "w-20" : "w-64"
        } ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:translate-x-0`}
      >
        {/* Header with logo and collapse toggle */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800/70">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-xs font-bold tracking-tight text-white shadow-md shadow-indigo-500/30">
              ODG
            </div>
            {!isCollapsed && (
              <div className="truncate">
                <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  ODG WMS
                </div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  ຄຸ້ມຄອງຄັງສິນຄ້າ
                </div>
              </div>
            )}
          </div>
          {/* Desktop collapse toggle - uses ChevronRightIcon with rotation */}
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="hidden md:inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label={isCollapsed ? "ຂະຫຍາຍເມນູ" : "ຍຸບເມນູ"}
          >
            <ChevronRightIcon
              className={`h-4 w-4 transition-transform duration-200 ${
                isCollapsed ? "" : "rotate-180"
              }`}
            />
          </button>
          {/* Mobile close button */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 md:hidden"
            aria-label="ປິດແຜ່ນນຳ"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            <NavItem
              href="/"
              icon={<HomeIcon className="h-5 w-5" />}
              label="ໜ້າຫຼັກ"
              collapsed={isCollapsed}
              isActive={pathname === "/"}
            />
            <NavItem
              href="/movements/balance"
              icon={<ListIcon className="h-5 w-5" />}
              label="ຄົງເຫຼືອ"
              collapsed={isCollapsed}
              isActive={pathname === "/movements/balance"}
            />
          </div>

          <div className="mt-6 space-y-4">
            {visibleGroups.map((group) => (
              <NavGroup
                key={group.basePath}
                group={group}
                collapsed={isCollapsed}
                pathname={pathname}
              />
            ))}
          </div>
        </nav>

        {/* User info + logout */}
        <div className="border-t border-zinc-200/70 p-3 dark:border-zinc-800/70">
          {session && (
            <div
              className={`mb-3 rounded-xl bg-zinc-50/80 p-2 backdrop-blur-sm dark:bg-zinc-900/50 ${
                isCollapsed ? "flex justify-center" : ""
              }`}
            >
              <div
                className={`flex items-center gap-3 ${isCollapsed ? "flex-col" : ""}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white shadow-sm dark:bg-white dark:text-zinc-950">
                  {(
                    session.nickname?.trim()?.[0] ||
                    session.fullname_lo?.trim()?.[0] ||
                    session.employee_code?.[0] ||
                    "?"
                  ).toUpperCase()}
                </div>
                {!isCollapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {session.nickname?.trim() ||
                        session.fullname_lo?.trim() ||
                        session.employee_code}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="truncate">{session.employee_code}</span>
                      {session.role && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${roleColorMap[session.role]}`}
                        >
                          {ROLE_LABEL_LO[session.role]}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <LogoutButton collapsed={isCollapsed} />
        </div>
      </aside>
    </>
  );
}

// Helper component for individual navigation items
function NavItem({
  href,
  icon,
  label,
  collapsed,
  isActive,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
        isActive
          ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
      } ${collapsed ? "justify-center" : ""}`}
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

// Helper component for navigation groups
function NavGroup({
  group,
  collapsed,
  pathname,
}: {
  group: Group;
  collapsed: boolean;
  pathname: string;
}) {
  const groupActive = pathname.startsWith(group.basePath);

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-all ${
        groupActive
          ? "border-indigo-200/70 bg-indigo-50/40 dark:border-indigo-800/40 dark:bg-indigo-950/30"
          : "border-zinc-200/70 bg-white/50 dark:border-zinc-800/60 dark:bg-zinc-900/40"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <span className="shrink-0 text-indigo-600 dark:text-indigo-300">
          {group.icon}
        </span>
        {!collapsed && <span>{group.label}</span>}
      </div>
      <div className="space-y-1 px-2 pb-2">
        {group.items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-all ${
                active
                  ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                {item.icon}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}