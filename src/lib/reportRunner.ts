import "server-only";
import { query } from "@/lib/db";
import { listReports, markSent, scopeOf, type EmailReport } from "@/lib/emailReportConfig";
import { buildReportHtml } from "@/lib/reportBuilder";
import { sendMail, mailEnabled } from "@/lib/mailer";

/**
 * The scheduler tick: send every report that is due and hasn't gone out today.
 *
 * "Now" is the DATABASE's local clock (Asia/Vientiane), read once per tick, so a
 * report's send_hour/send_minute/send_days are compared in the same timezone a
 * manager set them in — regardless of the server's own TZ. last_sent_on (a local
 * date) is the idempotency key: a report whose last_sent_on is already today is
 * skipped, so a restart, an overlapping tick, or a manual poke cannot double-send.
 */
export type TickResult = { checked: number; sent: string[]; failed: { name: string; error: string }[]; skipped: number };

type DbNow = { today: string; dow: number; minutes: number };

async function dbNow(): Promise<DbNow> {
  const r = await query<{ today: string; dow: string; minutes: string }>(
    `SELECT to_char(now(),'YYYY-MM-DD') AS today,
            EXTRACT(DOW FROM now())::int::text AS dow,
            (EXTRACT(HOUR FROM now())*60 + EXTRACT(MINUTE FROM now()))::int::text AS minutes`,
  );
  return { today: r[0].today, dow: Number.parseInt(r[0].dow, 10), minutes: Number.parseInt(r[0].minutes, 10) };
}

/** Is the report due at this moment (right weekday, scheduled time reached, not yet sent today)? */
function isDue(report: EmailReport, now: DbNow): boolean {
  if (!report.enabled) return false;
  if (report.recipients.length === 0) return false;
  if (report.last_sent_on === now.today) return false; // already sent today
  if (!report.send_days.includes(now.dow)) return false;
  const target = report.send_hour * 60 + report.send_minute;
  // Fire once the scheduled minute is reached. A tick that lands after the minute
  // (server was down, or coarse interval) still sends — the day guard stops repeats.
  return now.minutes >= target;
}

async function sendOne(report: EmailReport, today: string): Promise<void> {
  const { html, subject, hasContent } = await buildReportHtml({
    name: report.name, scope: scopeOf(report), date: today, sections: report.sections,
  });
  if (!hasContent) throw new Error("ບໍ່ໄດ້ເລືອກເນື້ອໃນລາຍງານ");
  await sendMail({ to: report.recipients, subject, html });
}

export async function runDueReports(): Promise<TickResult> {
  const result: TickResult = { checked: 0, sent: [], failed: [], skipped: 0 };
  if (!mailEnabled()) return result; // master switch off — do nothing
  const now = await dbNow();
  const reports = await listReports();
  result.checked = reports.length;
  for (const report of reports) {
    if (!isDue(report, now)) { result.skipped++; continue; }
    try {
      await sendOne(report, now.today);
      await markSent(report.id, "ok", null, now.today);
      result.sent.push(report.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markSent(report.id, "error", msg, null); // no sentOn → retried next tick
      result.failed.push({ name: report.name, error: msg });
    }
  }
  return result;
}

/** Send one report immediately regardless of schedule — the settings "test send". */
export async function sendReportNow(report: EmailReport): Promise<void> {
  const now = await dbNow();
  await sendOne(report, now.today);
}
