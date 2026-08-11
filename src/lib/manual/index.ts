/**
 * ຈຸດລວມຂອງຄູ່ມື — export ເນື້ອໃນທຸກໝວດ ພ້ອມ helper ຄົ້ນຫາ ແລະ ຕາຕະລາງ RACI.
 */
export * from "./types";
export { ROLES, ROLE_BY_ID, roleName } from "./roles";
export { WORKFLOWS, WORKFLOW_BY_CODE } from "./workflows";
export { SOPS, SOP_BY_CODE } from "./sops";
export { WORK_INSTRUCTIONS, WI_BY_CODE, WI_GROUPS } from "./wi";
export { FORMS, FORM_BY_CODE } from "./forms";

import { ROLES } from "./roles";
import { WORKFLOWS } from "./workflows";
import { SOPS } from "./sops";
import { WORK_INSTRUCTIONS } from "./wi";
import { FORMS } from "./forms";
import type { RoleId } from "./types";

export type ManualSection = "workflow" | "sop" | "wi" | "form" | "role";

export type ManualHit = {
  section: ManualSection;
  code: string;
  title: string;
  sub: string;
  href: string;
};

const SECTION_LABEL: Record<ManualSection, string> = {
  workflow: "ຂະບວນການ",
  sop: "SOP",
  wi: "ວິທີເຮັດ",
  form: "ແບບຟອມ",
  role: "ໜ້າທີ່",
};

export function sectionLabel(s: ManualSection): string {
  return SECTION_LABEL[s];
}

/** ດັດສະນີລວມ — ໃຊ້ໃນຊ່ອງຄົ້ນຫາຂອງໜ້າຄູ່ມື. */
export function manualIndex(): ManualHit[] {
  return [
    ...WORKFLOWS.map((w) => ({
      section: "workflow" as const,
      code: w.code,
      title: w.name,
      sub: w.goal,
      href: `/manual/workflow/${w.code}`,
    })),
    ...SOPS.map((s) => ({
      section: "sop" as const,
      code: s.code,
      title: s.title,
      sub: s.purpose,
      href: `/manual/sop/${s.code}`,
    })),
    ...WORK_INSTRUCTIONS.map((w) => ({
      section: "wi" as const,
      code: w.code,
      title: w.title,
      sub: `${w.group} · ${w.screen.label}`,
      href: `/manual/wi/${w.code}`,
    })),
    ...FORMS.map((f) => ({
      section: "form" as const,
      code: f.code,
      title: f.name,
      sub: `${f.kind} · ${f.when}`,
      href: `/manual/forms#${f.code}`,
    })),
    ...ROLES.map((r) => ({
      section: "role" as const,
      code: r.code,
      title: r.name,
      sub: r.purpose,
      href: `/manual/roles/${r.id}`,
    })),
  ];
}

/** ຄົ້ນຫາງ່າຍໆ ຂ້າມທຸກໝວດ (ບໍ່ສົນຕົວພິມນ້ອຍ-ໃຫຍ່). */
export function searchManual(q: string): ManualHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return manualIndex().filter((h) =>
    `${h.code} ${h.title} ${h.sub}`.toLowerCase().includes(needle),
  );
}

/* ── RACI ─────────────────────────────────────────────────────────
   R = ຜູ້ລົງມືເຮັດ (ຈາກຂັ້ນຕອນຂອງ workflow)
   A = ຜູ້ຮັບຜິດຊອບສຸດທ້າຍ (owner ຂອງ workflow)
   C = ຜູ້ຖືກປຶກສາ/ກ່ຽວຂ້ອງ (ຢູ່ໃນ roles ແຕ່ບໍ່ໄດ້ລົງມືໃນຂັ້ນຕອນ)      */

export type RaciMark = "A" | "R" | "C" | null;

export function raciFor(workflowCode: string, role: RoleId): RaciMark {
  const wf = WORKFLOWS.find((w) => w.code === workflowCode);
  if (!wf) return null;
  if (wf.owner === role) return "A";
  if (wf.steps.some((s) => s.role === role)) return "R";
  if (wf.roles.includes(role)) return "C";
  return null;
}

/** ຈຳນວນເອກະສານແຕ່ລະໝວດ — ໃຊ້ໃນການ໌ດໜ້າຫຼັກຂອງຄູ່ມື. */
export const MANUAL_COUNTS = {
  workflows: WORKFLOWS.length,
  sops: SOPS.length,
  wis: WORK_INSTRUCTIONS.length,
  forms: FORMS.length,
  roles: ROLES.length,
};
