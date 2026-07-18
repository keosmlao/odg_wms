import { NextResponse } from "next/server";
import { requireManager } from "@/lib/session";
import { getReport, updateReport, deleteReport, markSent } from "@/lib/emailReportConfig";
import { parseReportInput } from "@/lib/emailReportParse";
import { sendReportNow } from "@/lib/reportRunner";
import { mailEnabled, mailConfigError } from "@/lib/mailer";

function idOf(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** PATCH: update. DELETE: remove. POST: send now (test). Managers only. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const id = idOf((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const parsed = parseReportInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const report = await updateReport(id, parsed.value, guard.session.employee_code);
  if (!report) return NextResponse.json({ error: "ບໍ່ພົບລາຍງານ" }, { status: 404 });
  return NextResponse.json({ ok: true, report });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const id = idOf((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  const ok = await deleteReport(id);
  if (!ok) return NextResponse.json({ error: "ບໍ່ພົບລາຍງານ" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Send this report immediately, ignoring the schedule. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const id = idOf((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (!mailEnabled()) return NextResponse.json({ error: mailConfigError() ?? "ສົ່ງເມວບໍ່ໄດ້" }, { status: 400 });
  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "ບໍ່ພົບລາຍງານ" }, { status: 404 });
  if (report.recipients.length === 0) return NextResponse.json({ error: "ບໍ່ມີຜູ້ຮັບ" }, { status: 400 });
  try {
    await sendReportNow(report);
    await markSent(id, "ok", null, null); // test send: record status, don't consume today's slot
    return NextResponse.json({ ok: true, sent_to: report.recipients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ສົ່ງບໍ່ສຳເລັດ";
    await markSent(id, "error", msg, null);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
