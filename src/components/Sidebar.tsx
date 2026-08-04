"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Session, WmsRole } from "@/lib/session-shared";
import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  MailIcon,
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
    icon: <HomeIcon className="h-4.5 w-4.5" />,
  },
  {
    label: "ຄົງເຫຼືອ",
    href: "/movements/balance",
    icon: <ListIcon className="h-4.5 w-4.5" />,
  },
];

const groups: Group[] = [
  {
    label: "ປະຕິບັດງານປະຈຳ",
    basePath: "/movements/ops",
    icon: <ArrowLeftRightIcon className="h-4.5 w-4.5" />,
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
        label: "ໂອນສາງ",
        href: "/movements/transfer-dashboard",
        icon: <ArrowLeftRightIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ປັບປຸງ stock",
        href: "/movements/adjust",
        icon: <CheckIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "Pallet & ບ່ອນຈັດເກັບ",
    basePath: "/movements/storage",
    icon: <PackageIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ປະກອບ Pallet",
        href: "/movements/pallet-load",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຍ້າຍ Pallet",
        href: "/movements/pallet-move",
        icon: <LayersIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ບ່ອນວ່າງ (Putaway)",
        href: "/movements/putaway",
        icon: <BuildingIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ແຜນຜັງ Rack",
        href: "/rack-visualization",
        icon: <LayersIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "Serial & ກວດສອບ",
    basePath: "/serials-check",
    icon: <PackageIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "Serial Number",
        href: "/serials",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "SN Samsung",
        href: "/samsung-serials",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ກວດ SN vs Stock",
        href: "/movements/sn-check",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄວາມຖືກຕ້ອງ stock",
        href: "/movements/accuracy",
        icon: <CheckIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "ກວດນັບສິນຄ້າ",
    basePath: "/stocktake",
    icon: <CheckIcon className="h-4.5 w-4.5" />,
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
    label: "ລາຍງານ & ວິເຄາະ",
    basePath: "/movements/reports",
    icon: <ListIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ເຄື່ອນໄຫວປະຈຳວັນ",
        href: "/movements/daily",
        icon: <CalendarIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄ້າງຈ່າຍອອກສາງ",
        href: "/movements/pending-out",
        icon: <ArrowUpIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ສິນຄ້າຄ້າງ (Aging)",
        href: "/movements/aging",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ສິນຄ້າເຄື່ອນໄຫວ (Movers)",
        href: "/movements/movers",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ປະຫວັດ (Audit)",
        href: "/movements/ledger",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ພິມ Label/Barcode",
        href: "/movements/labels",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "ຮັບຝາກເຄື່ອງ",
    basePath: "/deposits",
    icon: <PackageIcon className="h-4.5 w-4.5" />,
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
    icon: <SettingsIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ສາງ / Rack / Location",
        href: "/settings/warehouses",
        icon: <LayersIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ກວດສອບ PH Dimension",
        href: "/settings/ph-dimensions",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຈັດການສິດເຂົ້າເຖິງ",
        href: "/settings/access",
        icon: <ShieldIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຍີ່ຫໍ້ບັງຄັບ SN+ISN",
        href: "/settings/sn-dual-brands",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄ່າຝາກເຄື່ອງ",
        href: "/settings/deposit",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ລາຍງານທາງເມວ",
        href: "/settings/email-reports",
        icon: <MailIcon className="h-3.5 w-3.5" />,
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
        className="fixed left-3 top-3 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/80 bg-white/80 text-zinc-700 shadow-lg shadow-zinc-900/5 backdrop-blur-sm transition hover:bg-white md:hidden dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:text-zinc-200"
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
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-200/40 bg-white/80 backdrop-blur-xl shadow-xl shadow-zinc-200/30 transition-all duration-300 dark:border-zinc-800/40 dark:bg-zinc-950/80 dark:shadow-none ${
          isCollapsed ? "w-[72px]" : "w-60"
        } ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:translate-x-0`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200/40 px-3 py-3.5 dark:border-zinc-800/40">
          <Link
            href="/"
            onClick={closeMobile}
            className="flex items-center gap-2.5 overflow-hidden rounded-xl px-1.5 py-0.5"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-[10px] font-black tracking-wider text-white shadow-[0_0_12px_rgba(99,102,241,0.45)] dark:shadow-[0_0_12px_rgba(99,102,241,0.2)]">
              WMS
            </div>
            {!isCollapsed && (
              <div className="truncate">
                <div className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-1">
                  ODG <span className="bg-gradient-to-r from-indigo-500 to-pink-500 bg-clip-text text-transparent font-black">WMS</span>
                </div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  ຄຸ້ມຄອງຄັງສິນຄ້າ
                </div>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="hidden h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 md:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 transition-colors"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200/50 text-zinc-600 transition hover:bg-zinc-100 md:hidden dark:border-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                className="w-full rounded-xl border border-zinc-200/60 bg-zinc-50/50 py-1.5 pl-7 pr-2 text-xs text-zinc-900 placeholder:text-zinc-400 transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/10 dark:border-zinc-800/60 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-indigo-400 dark:focus:bg-zinc-950"
              />
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
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
            <div className="mt-4 space-y-2">
              {filteredGroups.map((group) => (
                <NavGroup
                  key={group.label}
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
            <div className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              ບໍ່ພົບເມນູ &quot;{search}&quot;
            </div>
          )}
        </nav>

        {!isCollapsed && (
          <div className="border-t border-zinc-200/40 px-4 py-3 text-[10px] text-zinc-400 flex items-center justify-between dark:border-zinc-800/40 dark:text-zinc-500 bg-zinc-50/30 dark:bg-zinc-950/10">
            <span>© ODG WMS</span>
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shadow-sm dark:shadow-none">v1.2.0</span>
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
      className={`group relative flex items-center gap-3 rounded-xl py-2 text-sm transition-all duration-200 ${
        collapsed ? "justify-center px-2" : indent ? "pl-6 pr-3 hover:translate-x-1" : "px-3 hover:translate-x-1"
      } ${
        isActive
          ? "bg-gradient-to-r from-indigo-50/80 to-transparent font-semibold text-indigo-700 dark:from-indigo-500/10 dark:to-transparent dark:text-indigo-200 shadow-sm dark:shadow-none"
          : "font-medium text-zinc-600 hover:bg-zinc-50/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/30 dark:hover:text-zinc-200"
      }`}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-500 to-purple-600"
        />
      )}
      {icon && (
        <span
          className={`shrink-0 transition-colors ${
            isActive
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-400 group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-300"
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
  const groupActive = group.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
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
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={isExpanded}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-200 ${
          groupActive
            ? "bg-gradient-to-r from-indigo-50/50 to-transparent text-indigo-700 dark:from-indigo-500/5 dark:to-transparent dark:text-indigo-200"
            : "text-zinc-700 hover:bg-zinc-50/50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/30 dark:hover:text-zinc-200 hover:translate-x-0.5"
        }`}
      >
        <span
          className={`shrink-0 transition-colors ${
            groupActive
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-400 dark:text-zinc-500"
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
