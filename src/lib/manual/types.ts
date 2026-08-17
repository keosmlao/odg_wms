/**
 * ໂຄງສ້າງຂໍ້ມູນຂອງ "ຄູ່ມືການເຮັດວຽກ" (Workflow · SOP · WI · Form · ໜ້າທີ່).
 *
 * ເນື້ອໃນເປັນ data ບໍ່ແມ່ນ JSX ເພື່ອໃຫ້: ຄົ້ນຫາໄດ້ຂ້າມທຸກໝວດ, ອ້າງອີງກັນໄດ້ດ້ວຍລະຫັດ
 * (WF/SOP/WI/F/R) ແລະ ແກ້ໄຂເນື້ອໃນໄດ້ໂດຍບໍ່ຕ້ອງແຕະໜ້າຈໍ.
 */

import type { WmsRole } from "@/lib/session-shared";

export type AccentTone =
  | "emerald"
  | "red"
  | "aqua"
  | "navy"
  | "amber"
  | "brand"
  | "neutral";

/** ໜ້າຈໍໃນລະບົບທີ່ເອກະສານອ້າງເຖິງ. */
export type ScreenRef = { label: string; href: string };

/* ── ໜ້າທີ່ / ຕຳແໜ່ງ ─────────────────────────────────────────────── */

export type RoleId =
  | "manager"
  | "supervisor"
  | "keeper"
  | "receiver"
  | "picker"
  | "forklift"
  | "counter"
  | "driver"
  | "purchasing"
  | "accounting"
  | "sales"
  | "it";

export type Role = {
  id: RoleId;
  code: string;
  name: string;
  en: string;
  /** role ໃນລະບົບ WMS — null = ບໍ່ມີບັນຊີ WMS (ເຮັດວຽກຜ່ານເອກະສານ/ລະບົບອື່ນ). */
  systemRole: WmsRole | null;
  /** true = ຢູ່ນອກພະແນກສາງ (ຜູ້ກ່ຽວຂ້ອງ). */
  external?: boolean;
  reportsTo: string;
  purpose: string;
  duties: { when: string; items: string[] }[];
  screens: ScreenRef[];
  authority: string[];
  forbidden: string[];
  kpis: { name: string; target: string }[];
  sops: string[];
};

/* ── ຂະບວນການ (Workflow) ─────────────────────────────────────────── */

export type WorkflowStep = {
  no: number;
  role: RoleId;
  action: string;
  detail?: string;
  screen?: ScreenRef;
  /** ລະຫັດແບບຟອມ/ເອກະສານທີ່ເກີດ ຫຼື ໃຊ້ໃນຂັ້ນຕອນນີ້. */
  form?: string;
  /** ຈຸດຄວບຄຸມ — ສິ່ງທີ່ຕ້ອງກວດກ່ອນຜ່ານໄປຂັ້ນຕໍ່ໄປ. */
  control?: string;
};

export type Workflow = {
  code: string;
  name: string;
  tone: AccentTone;
  goal: string;
  trigger: string;
  scope: string;
  owner: RoleId;
  roles: RoleId[];
  steps: WorkflowStep[];
  exceptions: { case: string; action: string }[];
  outputs: string[];
  sops: string[];
  wis: string[];
  forms: string[];
  kpis: { name: string; target: string }[];
};

/* ── SOP ──────────────────────────────────────────────────────────── */

export type Sop = {
  code: string;
  title: string;
  tone: AccentTone;
  owner: RoleId;
  purpose: string;
  scope: string[];
  definitions: { term: string; meaning: string }[];
  responsibilities: { role: RoleId; duty: string }[];
  procedure: {
    no: number;
    title: string;
    actor: RoleId;
    steps: string[];
    wis?: string[];
  }[];
  controls: string[];
  records: string[];
  kpis: { name: string; target: string }[];
  workflow?: string;
};

/* ── ວິທີເຮັດ (Work Instruction) ──────────────────────────────────── */

export type WorkInstruction = {
  code: string;
  title: string;
  /** ໝວດ ສຳລັບຈັດກຸ່ມໃນລາຍການ. */
  group: string;
  sop: string;
  actors: RoleId[];
  screen: ScreenRef;
  prerequisites: string[];
  steps: { no: number; action: string; expect?: string; warn?: string }[];
  issues: { problem: string; fix: string }[];
  forms?: string[];
};

/* ── ແບບຟອມ / ເອກະສານ ────────────────────────────────────────────── */

export type FormKind = "ລະບົບ" | "ພິມ" | "Excel" | "ERP";

export type FormDoc = {
  code: string;
  name: string;
  kind: FormKind;
  /** ຮູບແບບເລກທີ່ເອກະສານ ຖ້າມີ. */
  docNo?: string;
  source: ScreenRef;
  printHref?: string;
  owner: RoleId;
  when: string;
  fields: string[];
  retention: string;
  sops: string[];
};

/* ── ຂໍ້ມູນຫົວເອກະສານລວມ ─────────────────────────────────────────── */

export const MANUAL_VERSION = "1.0";
export const MANUAL_EFFECTIVE = "11-08-2026";
export const MANUAL_OWNER_DEPT = "ພະແນກສາງ (501)";
