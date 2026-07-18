import type { ReportInput } from "@/lib/emailReportConfig";

/** Basic email shape check — the same permissive rule the browser's type=email uses. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParseResult = { ok: true; value: ReportInput } | { ok: false; error: string };

function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isInteger(n) || n < lo || n > hi) return null;
  return n;
}

/** Validate + normalize the settings-form body into a ReportInput. */
export function parseReportInput(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "ກະລຸນາໃສ່ຊື່ລາຍງານ" };
  if (name.length > 100) return { ok: false, error: "ຊື່ລາຍງານຍາວເກີນໄປ" };

  const s = (b.sections ?? {}) as Record<string, unknown>;
  const sections = {
    receive: bool(s.receive), issue: bool(s.issue), pending: bool(s.pending), health: bool(s.health),
    movers: bool(s.movers), issue_pending: bool(s.issue_pending),
  };
  if (!Object.values(sections).some(Boolean)) {
    return { ok: false, error: "ເລືອກເນື້ອໃນລາຍງານຢ່າງໜ້ອຍ 1 ຢ່າງ" };
  }

  const send_hour = intIn(b.send_hour, 0, 23);
  if (send_hour === null) return { ok: false, error: "ຊົ່ວໂມງບໍ່ຖືກຕ້ອງ" };
  const send_minute = intIn(b.send_minute, 0, 59);
  if (send_minute === null) return { ok: false, error: "ນາທີບໍ່ຖືກຕ້ອງ" };

  const daysRaw = Array.isArray(b.send_days) ? b.send_days : [];
  const send_days = [...new Set(daysRaw.map((d) => intIn(d, 0, 6)).filter((d): d is number => d !== null))].sort();
  if (send_days.length === 0) return { ok: false, error: "ເລືອກມື້ສົ່ງຢ່າງໜ້ອຍ 1 ມື້" };

  const wh_scope = Array.isArray(b.wh_scope)
    ? [...new Set(b.wh_scope.map((w) => (typeof w === "string" ? w.trim() : "")).filter(Boolean))]
    : [];

  const recipientsRaw = Array.isArray(b.recipients) ? b.recipients : [];
  const recipients = [...new Set(recipientsRaw.map((r) => (typeof r === "string" ? r.trim().toLowerCase() : "")).filter(Boolean))];
  if (recipients.length === 0) return { ok: false, error: "ໃສ່ອີເມວຜູ້ຮັບຢ່າງໜ້ອຍ 1 ຄົນ" };
  const bad = recipients.find((r) => !EMAIL.test(r));
  if (bad) return { ok: false, error: `ອີເມວບໍ່ຖືກຕ້ອງ: ${bad}` };

  return {
    ok: true,
    value: { name, enabled: bool(b.enabled, true), sections, send_hour, send_minute, send_days, wh_scope, recipients },
  };
}
