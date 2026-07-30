import type { PoolClient } from "pg";
import { query } from "@/lib/db";

/**
 * Audit trail of the goods-issue confirm step — see
 * `migrations/025_wms_pick_scan_log.sql` for the DDL.
 *
 * The finished issue only records the end state (what left, from which bin).
 * This records how the operator got there: every SN/ISN scan including the ones
 * the screen rejected, every un-scan, every location re-point, and the confirm
 * itself. That is what you need when a unit turns out to have left from the
 * wrong bin, or a short pick has to be explained after the fact.
 *
 * Every write here is BEST-EFFORT and must never break an issue: a missing
 * table (pre-migration) or a bad row is swallowed.
 */

/** What happened. `scan` covers rejects too — the `result` column says which. */
export type ScanLogEvent = {
  event: "scan" | "unscan" | "move" | "confirm";
  /** ok | not_found | duplicate | over_qty */
  result?: string | null;
  item_code?: string | null;
  scan_input?: string | null;
  sn?: string | null;
  isn?: string | null;
  rack?: string | null;
  location?: string | null;
  pallet?: string | null;
  from_node?: string | null;
  to_node?: string | null;
  qty?: number | null;
  note?: string | null;
};

type Querier = Pick<PoolClient, "query">;

const EVENTS = new Set(["scan", "unscan", "move", "confirm"]);
/** Keep a runaway client (or a stuck scanner) from flooding the table. */
const MAX_PER_CALL = 200;

function cut(v: unknown, n: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, n) : null;
}

/** Append events for one pick slip. Never throws. */
export async function appendScanLog(
  p: {
    docNo: string;
    refDoc?: string | null;
    wh?: string | null;
    user?: string | null;
    events: ScanLogEvent[];
  },
  client?: Querier,
): Promise<number> {
  const rows = p.events.filter((e) => e && EVENTS.has(e.event)).slice(0, MAX_PER_CALL);
  if (!p.docNo || rows.length === 0) return 0;
  const sql = `
    INSERT INTO public.odg_wms_pick_scan_log
      (doc_no, ref_doc, wh_code, event, result, item_code, scan_input, sn, isn,
       rack, location, pallet, from_node, to_node, qty, note, user_created)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`;
  let written = 0;
  try {
    for (const e of rows) {
      const args = [
        p.docNo.slice(0, 40),
        cut(p.refDoc, 40),
        cut(p.wh, 20),
        e.event,
        cut(e.result, 20),
        cut(e.item_code, 40),
        cut(e.scan_input, 120),
        cut(e.sn, 120),
        cut(e.isn, 120),
        cut(e.rack, 40),
        cut(e.location, 40),
        cut(e.pallet, 40),
        cut(e.from_node, 140),
        cut(e.to_node, 140),
        typeof e.qty === "number" && Number.isFinite(e.qty) ? e.qty : null,
        cut(e.note, 200),
        cut(p.user, 50),
      ];
      if (client) await client.query(sql, args);
      else await query(sql, args);
      written += 1;
    }
  } catch {
    // table not created yet (pre-migration) — skip silently, the issue still commits.
  }
  return written;
}

/**
 * Tie this pick slip's whole trail to the DP issue doc it became, so the history
 * screen can still find it once the pick slip rows are deleted. Never throws.
 */
export async function stampIssueDoc(client: Querier, docNo: string, issueDoc: string): Promise<void> {
  try {
    await client.query(
      `UPDATE public.odg_wms_pick_scan_log SET issue_doc = $2 WHERE doc_no = $1 AND issue_doc IS NULL`,
      [docNo, issueDoc],
    );
  } catch {
    // pre-migration — ignore.
  }
}
