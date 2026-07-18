import { NextResponse } from "next/server";
import { runDueReports } from "@/lib/reportRunner";

/**
 * External trigger for the report scheduler — an alternative to the in-process
 * instrumentation timer, for when the app runs on serverless / multiple
 * instances. Guarded by a shared secret so it can't be poked publicly.
 *
 *   curl -H "x-cron-key: $WMS_CRON_KEY" https://wms.../api/cron/email-report
 *
 * Idempotent by the same last_sent_on day-guard the in-process timer uses, so it
 * is safe to call every minute and safe to run alongside the timer.
 */
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const key = process.env.WMS_CRON_KEY;
  if (!key) return false; // no key configured → endpoint disabled
  const got = request.headers.get("x-cron-key") ?? new URL(request.url).searchParams.get("key");
  return got === key;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDueReports();
  return NextResponse.json({ ok: true, ...result });
}
