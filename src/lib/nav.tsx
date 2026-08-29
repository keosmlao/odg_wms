import type { ReactNode } from "react";
import type { Session, WmsRole } from "@/lib/session-shared";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  BookIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  EyeIcon,
  FileTextIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  MailIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  RouteIcon,
  ScanIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  TrendIcon,
  UsersIcon,
} from "@/components/ui/Icons";

/**
 * ທະບຽນເມນູກາງ — ແຫຼ່ງຄວາມຈິງອັນດຽວຂອງການນຳທາງທັງໝົດ.
 *
 * ກ່ອນນີ້ລາຍການເມນູຢູ່ໃນ Sidebar.tsx ຢ່າງດຽວ ຈຶ່ງໃຊ້ຊ້ຳບໍ່ໄດ້. ຍ້າຍມາໄວ້ນີ້ເພື່ອໃຫ້
 * ແຖບຂ້າງ, ຄົ້ນຫາຄຳສັ່ງ (Ctrl+K) ແລະ ໜ້າຫຼັກມືຖື ໃຊ້ຂໍ້ມູນຊຸດດຽວກັນ —
 * ເພີ່ມເມນູໃໝ່ບ່ອນດຽວ ແລ້ວມັນຂຶ້ນຄົບທຸກບ່ອນ.
 */

export type NavLink = { label: string; href: string; icon?: ReactNode };
export type NavGroupDef = {
  label: string;
  basePath: string;
  icon: ReactNode;
  items: NavLink[];
  allowedRoles?: WmsRole[] | null;
};

export const topItems: NavLink[] = [
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

export const groups: NavGroupDef[] = [
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
    label: "ລາຍການສິນຄ້າມີຕຳນິ",
    basePath: "/defects",
    icon: <AlertIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ບັນທຶກເຄື່ອງມີຕຳນິ",
        href: "/defects/new",
        icon: <PlusIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄົງເຫຼືອ (ຍັງບໍ່ເບີກຈ່າຍ)",
        href: "/defects",
        icon: <ListIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄົງເຫຼືອ (ເບີກຈ່າຍແລ້ວ)",
        href: "/defects/dispatched",
        icon: <ArrowUpIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄົງເຫຼືອໃນສາງມີຕຳນິ",
        href: "/defects/sml",
        icon: <BuildingIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຮູບພາບ & ໝາຍເລກເຄື່ອງ",
        href: "/defects/photos",
        icon: <EyeIcon className="h-3.5 w-3.5" />,
      },
    ],
  },
  {
    label: "ລາຍງານ & ວິເຄາະ",
    basePath: "/movements/reports",
    icon: <ListIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ປະສິດທິພາບສາງ (KPI)",
        href: "/movements/performance",
        icon: <TrendIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ເຄື່ອນໄຫວປະຈຳວັນ",
        href: "/movements/daily",
        icon: <CalendarIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ເຄື່ອນໄຫວຕາມບ່ອນເກັບ",
        href: "/movements/daily-location",
        icon: <MapPinIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ເຄື່ອນໄຫວລາຍເດືອນ (ຕາມສິນຄ້າ)",
        href: "/movements/monthly",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
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
        label: "stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ",
        href: "/movements/min-stock",
        icon: <AlertIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຄວາມພຽງພໍ (Coverage)",
        href: "/movements/coverage",
        icon: <TrendIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຂໍ້ສະເໜີການໂອນ",
        href: "/movements/rebalance",
        icon: <ArrowLeftRightIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຊ່ອງຫວ່າງລາຍການ",
        href: "/movements/assortment",
        icon: <SearchIcon className="h-3.5 w-3.5" />,
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
    label: "ຄູ່ມືການເຮັດວຽກ",
    basePath: "/manual",
    icon: <BookIcon className="h-4.5 w-4.5" />,
    items: [
      {
        label: "ພາບລວມ / ຄົ້ນຫາ",
        href: "/manual",
        icon: <SearchIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຂະບວນການ (Workflow)",
        href: "/manual/workflow",
        icon: <RouteIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "SOP",
        href: "/manual/sop",
        icon: <ClipboardIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ວິທີເຮັດ (WI)",
        href: "/manual/wi",
        icon: <BookIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ແບບຟອມ & ເອກະສານ",
        href: "/manual/forms",
        icon: <FileTextIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ໜ້າທີ່ແຕ່ລະຄົນ",
        href: "/manual/roles",
        icon: <UsersIcon className="h-3.5 w-3.5" />,
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
        label: "ສິນຄ້າທີ່ຕ້ອງເກັບ ISN",
        href: "/settings/isn-scope",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "ຍີ່ຫໍ້ບັງຄັບ SN+ISN",
        href: "/settings/sn-dual-brands",
        icon: <PackageIcon className="h-3.5 w-3.5" />,
      },
      {
        label: "stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ",
        href: "/settings/min-stock",
        icon: <AlertIcon className="h-3.5 w-3.5" />,
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

/**
 * ວຽກທີ່ຖືກກົດຫຼາຍທີ່ສຸດ — ຄ້າງໄວ້ເທິງສຸດສະເໝີ ບໍ່ຕ້ອງໄປຫາໃນເມນູ.
 *
 * ຄົນໃໝ່ອາຍຸ 16 ປີຈະບໍ່ຈື່ວ່າ “ປັບປຸງ stock” ຢູ່ກຸ່ມໃດ — ແຕ່ຈື່ໄດ້ວ່າປຸ່ມ 4 ອັນນີ້
 * ຢູ່ບ່ອນເກົ່າສະເໝີ. ນີ້ຄື 90% ຂອງວຽກປະຈຳວັນ.
 */
export const quickActions: NavLink[] = [
  { label: "ຮັບສິນຄ້າ", href: "/movements/receive", icon: <ArrowDownIcon className="h-5 w-5" /> },
  { label: "ຈ່າຍສິນຄ້າ", href: "/movements/issue", icon: <ArrowUpIcon className="h-5 w-5" /> },
  { label: "ຈັດເຄື່ອງ (Pick)", href: "/movements/pick", icon: <RouteIcon className="h-5 w-5" /> },
  { label: "ນັບ / ປັບປຸງ stock", href: "/m/adjust", icon: <ScanIcon className="h-5 w-5" /> },
];

/** ກຸ່ມເມນູທີ່ບັນຊີນີ້ເຫັນໄດ້ຈິງ (ບາງກຸ່ມຈຳກັດສະເພາະ manager). */
export function visibleGroupsFor(session: Session | null): NavGroupDef[] {
  return groups.filter((g) => {
    if (!g.allowedRoles) return true;
    return session?.role ? g.allowedRoles.includes(session.role) : false;
  });
}

export type NavHit = NavLink & { group: string | null };

/**
 * ລວມທຸກເມນູເປັນລາຍການແປ ພ້ອມຊື່ກຸ່ມ — ໃຊ້ໂດຍຊ່ອງຄົ້ນຫາຄຳສັ່ງ.
 * ໜ້າຊ້ຳ (href ດຽວກັນ) ຖືກຕັດອອກ ເພື່ອບໍ່ໃຫ້ຜົນຄົ້ນຫາມີແຖວຄື່ກັນສອງແຖວ.
 */
export function flattenNav(session: Session | null): NavHit[] {
  const out: NavHit[] = topItems.map((i) => ({ ...i, group: null }));
  for (const g of visibleGroupsFor(session)) {
    for (const item of g.items) out.push({ ...item, group: g.label });
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true)));
}

/** ຈັບຄູ່ຄຳຄົ້ນຫາກັບປ້າຍເມນູ ຫຼື ຊື່ກຸ່ມ ຫຼື ເສັ້ນທາງ. */
export function matchNav(hit: NavHit, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return (
    hit.label.toLowerCase().includes(needle) ||
    (hit.group?.toLowerCase().includes(needle) ?? false) ||
    hit.href.toLowerCase().includes(needle)
  );
}
