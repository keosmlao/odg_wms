"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Session, WmsRole } from "@/lib/session-shared";
import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/ui/Icons";

type NavLink = { label: string; href: string; icon?: ReactNode };
type Group = {
  label: string;
  basePath: string;
  icon: ReactNode;
  items: NavLink[];
  allowedRoles?: WmsRole[] | null;
};

const topItems: NavLink[] = [
  {
    label: "ໜ້າຫຼັກ",
    href: "/",
    icon: <HomeIcon className="h-4 w-4" />,
  },
  {
    label: "ຄົງເຫຼືອ",
    href: "/movements/balance",
    icon: <ListIcon className="h-4 w-4" />,
  },
];

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
    label: "ຮັບຝາກເຄື່ອງ",
    basePath: "/deposits",
    icon: <PackageIcon className="h-4 w-4" />,
    items: [
      {
        label: "ລາຍການຝາກ",
        href: "/deposits",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຮັບຝາກໃໝ່",
        href: "/deposits/new",
        icon: <PlusIcon className="h-3.5 w-3.5" />,
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
      {
        label: "ຄ່າຝາກເຄື່ອງ",
        href: "/settings/deposit",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
    ],
    allowedRoles: ["manager"],
  },
];

export default function Sidebar({ session }: { session: Session | null }) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  const visibleGroups = groups.filter((g) => {
    if (!g.allowedRoles) return true;
    return session?.role ? g.allowedRoles.includes(session.role) : false;
  });

  const q = search.trim().toLowerCase();
  const filteredTop = q
    ? topItems.filter((i) => i.label.toLowerCase().includes(q))
    : topItems;
  const filteredGroups = q
    ? visibleGroups
        .map((g) => {
          const groupMatches = g.label.toLowerCase().includes(q);
          const items = g.items.filter(
            (i) => groupMatches || i.label.toLowerCase().includes(q),
          );
          return { ...g, items };
        })
        .filter((g) => g.items.length > 0)
    : visibleGroups;

  const closeMobile = () => setIsMobileOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="fixed left-3 top-3 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 shadow-lg shadow-zinc-900/5 backdrop-blur-sm transition hover:bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200"
        aria-label="ເປີດແຜ່ນນຳ"
      >
        <ListIcon className="h-5 w-5" />
      </button>

      {isMobileOpen && (
        <button
          type="button"
          aria-hidden="true"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-200/70 bg-white/90 backdrop-blur-md transition-all duration-300 dark:border-zinc-800/70 dark:bg-zinc-900/90 ${
          isCollapsed ? "w-[72px]" : "w-60"
        } ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:translate-x-0`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
          <Link
            href="/"
            onClick={closeMobile}
            className="flex items-center gap-2.5 overflow-hidden rounded-lg px-1 py-0.5"
          >
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
          </Link>
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 md:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label={isCollapsed ? "ຂະຫຍາຍເມນູ" : "ຍຸບເມນູ"}
          >
            <ChevronRightIcon
              className={`h-4 w-4 transition-transform duration-200 ${
                isCollapsed ? "" : "rotate-180"
              }`}
            />
          </button>
          <button
            type="button"
            onClick={closeMobile}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 md:hidden dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="ປິດແຜ່ນນຳ"
          >
            <ChevronRightIcon className="h-4 w-4 rotate-180" />
          </button>
        </div>

        {!isCollapsed && (
          <div className="px-3 pt-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ຄົ້ນຫາເມນູ..."
                className="w-full rounded-lg border border-zinc-200 bg-white/70 py-1.5 pl-7 pr-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div className="space-y-0.5">
            {filteredTop.map((item) => (
              <NavLeaf
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                collapsed={isCollapsed}
                isActive={pathname === item.href}
                onNavigate={closeMobile}
              />
            ))}
          </div>

          {filteredGroups.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {filteredGroups.map((group) => (
                <NavGroup
                  key={group.basePath}
                  group={group}
                  collapsed={isCollapsed}
                  pathname={pathname}
                  forceExpanded={q.length > 0}
                  onNavigate={closeMobile}
                />
              ))}
            </div>
          )}

          {q && filteredTop.length === 0 && filteredGroups.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              ບໍ່ພົບເມນູ &quot;{search}&quot;
            </div>
          )}
        </nav>

        {!isCollapsed && (
          <div className="border-t border-zinc-200/70 px-4 py-2.5 text-[10px] text-zinc-400 dark:border-zinc-800/70 dark:text-zinc-500">
            © ODG WMS
          </div>
        )}
      </aside>
    </>
  );
}

function NavLeaf({
  href,
  icon,
  label,
  collapsed,
  isActive,
  onNavigate,
  indent = false,
}: {
  href: string;
  icon?: ReactNode;
  label: string;
  collapsed: boolean;
  isActive: boolean;
  onNavigate?: () => void;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={`group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-all ${
        collapsed ? "justify-center px-2" : indent ? "pl-6 pr-3" : "px-3"
      } ${
        isActive
          ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"
          : "font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
      }`}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-full bg-indigo-600 dark:bg-indigo-400"
        />
      )}
      {icon && (
        <span
          className={`shrink-0 ${
            isActive
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {icon}
        </span>
      )}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function NavGroup({
  group,
  collapsed,
  pathname,
  forceExpanded,
  onNavigate,
}: {
  group: Group;
  collapsed: boolean;
  pathname: string;
  forceExpanded: boolean;
  onNavigate?: () => void;
}) {
  const groupActive = pathname.startsWith(group.basePath);
  const [expanded, setExpanded] = useState(groupActive);
  const isExpanded = forceExpanded || expanded;

  if (collapsed) {
    return (
      <div className="space-y-0.5">
        <div
          title={group.label}
          className={`flex items-center justify-center rounded-lg px-2 py-1.5 ${
            groupActive
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          <span>{group.icon}</span>
        </div>
        {group.items.map((item) => (
          <NavLeaf
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            collapsed
            isActive={pathname === item.href}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={isExpanded}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
          groupActive
            ? "text-indigo-700 dark:text-indigo-200"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
        }`}
      >
        <span
          className={`shrink-0 ${
            groupActive
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {group.icon}
        </span>
        <span className="flex-1 truncate text-left">{group.label}</span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavLeaf
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              collapsed={false}
              isActive={pathname === item.href}
              onNavigate={onNavigate}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}
