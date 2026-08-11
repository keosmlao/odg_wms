import "server-only";
import { query } from "@/lib/db";
import type { Scope } from "@/lib/reportData";
import type { ReportSections } from "@/lib/reportBuilder";

/**
 * CRUD for the scheduled email reports (migration 021, odg_wms_email_report).
 * One row = one scheduled email: what it contains, when it goes, who receives it.
 */
export type EmailReport = {
  id: number;
  name: string;
  enabled: boolean;
  sections: ReportSections;
  send_hour: number;
  send_minute: number;
  send_days: number[]; // 0=Sun..6=Sat (JS getDay())
  wh_scope: string[]; // empty = all warehouses
  recipients: string[];
  last_sent_on: string | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: string;
  updated_by: string | null;
};

type Row = {
  id: number; name: string; enabled: boolean;
  incl_receive: boolean; incl_issue: boolean; incl_pending: boolean; incl_health: boolean;
  incl_movers: boolean; incl_issue_pending: boolean; incl_min_stock: boolean;
  send_hour: number; send_minute: number; send_days: number[]; wh_scope: string[]; recipients: string[];
  last_sent_on: string | null; last_status: string | null; last_error: string | null;
  updated_at: string; updated_by: string | null;
};

function toReport(r: Row): EmailReport {
  return {
    id: r.id, name: r.name, enabled: r.enabled,
    sections: {
      receive: r.incl_receive, issue: r.incl_issue, pending: r.incl_pending, health: r.incl_health,
      movers: r.incl_movers, issue_pending: r.incl_issue_pending, min_stock: r.incl_min_stock,
    },
    send_hour: r.send_hour, send_minute: r.send_minute, send_days: r.send_days,
    wh_scope: r.wh_scope, recipients: r.recipients,
    last_sent_on: r.last_sent_on, last_status: r.last_status, last_error: r.last_error,
    updated_at: r.updated_at, updated_by: r.updated_by,
  };
}

/** [] in the table means "every warehouse" → null scope for the queries. */
export function scopeOf(report: EmailReport): Scope {
  return report.wh_scope.length ? report.wh_scope : null;
}

const COLS = `id, name, enabled, incl_receive, incl_issue, incl_pending, incl_health,
  incl_movers, incl_issue_pending, incl_min_stock,
  send_hour, send_minute, send_days, wh_scope, recipients,
  to_char(last_sent_on,'YYYY-MM-DD') AS last_sent_on, last_status, last_error,
  to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at, updated_by`;

export async function listReports(): Promise<EmailReport[]> {
  try {
    const rows = await query<Row>(`SELECT ${COLS} FROM public.odg_wms_email_report ORDER BY id`);
    return rows.map(toReport);
  } catch {
    return []; // table not migrated yet — settings page still renders
  }
}

export async function getReport(id: number): Promise<EmailReport | null> {
  const rows = await query<Row>(`SELECT ${COLS} FROM public.odg_wms_email_report WHERE id = $1`, [id]);
  return rows[0] ? toReport(rows[0]) : null;
}

export type ReportInput = {
  name: string; enabled: boolean; sections: ReportSections;
  send_hour: number; send_minute: number; send_days: number[];
  wh_scope: string[]; recipients: string[];
};

export async function createReport(input: ReportInput, by: string | null): Promise<EmailReport> {
  const rows = await query<Row>(
    `INSERT INTO public.odg_wms_email_report
       (name, enabled, incl_receive, incl_issue, incl_pending, incl_health, incl_movers, incl_issue_pending,
        send_hour, send_minute, send_days, wh_scope, recipients, updated_by, incl_min_stock)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING ${COLS}`,
    [input.name, input.enabled, input.sections.receive, input.sections.issue, input.sections.pending, input.sections.health,
     input.sections.movers, input.sections.issue_pending,
     input.send_hour, input.send_minute, input.send_days, input.wh_scope, input.recipients, by,
     input.sections.min_stock],
  );
  return toReport(rows[0]);
}

export async function updateReport(id: number, input: ReportInput, by: string | null): Promise<EmailReport | null> {
  const rows = await query<Row>(
    `UPDATE public.odg_wms_email_report SET
       name=$2, enabled=$3, incl_receive=$4, incl_issue=$5, incl_pending=$6, incl_health=$7,
       incl_movers=$14, incl_issue_pending=$15, incl_min_stock=$16,
       send_hour=$8, send_minute=$9, send_days=$10, wh_scope=$11, recipients=$12,
       updated_at=now(), updated_by=$13
     WHERE id=$1
     RETURNING ${COLS}`,
    [id, input.name, input.enabled, input.sections.receive, input.sections.issue, input.sections.pending, input.sections.health,
     input.send_hour, input.send_minute, input.send_days, input.wh_scope, input.recipients, by,
     input.sections.movers, input.sections.issue_pending, input.sections.min_stock],
  );
  return rows[0] ? toReport(rows[0]) : null;
}

export async function deleteReport(id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(`DELETE FROM public.odg_wms_email_report WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

/** Record the outcome of a send attempt. sentOn set only on success (idempotency key). */
export async function markSent(id: number, status: "ok" | "error", error: string | null, sentOn: string | null): Promise<void> {
  await query(
    `UPDATE public.odg_wms_email_report
       SET last_status=$2, last_error=$3, last_sent_on=COALESCE($4::date, last_sent_on)
     WHERE id=$1`,
    [id, status, error, sentOn],
  );
}
