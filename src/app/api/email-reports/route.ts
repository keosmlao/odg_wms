import { NextResponse } from "next/server";
import { requireManager } from "@/lib/session";
import { listReports, createReport } from "@/lib/emailReportConfig";
import { parseReportInput } from "@/lib/emailReportParse";

/** GET: all scheduled reports. POST: create one. Managers only. */
export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, reports: await listReports() });
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const parsed = parseReportInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const report = await createReport(parsed.value, guard.session.employee_code);
  return NextResponse.json({ ok: true, report });
}
