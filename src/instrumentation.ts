/**
 * Server startup hook. Starts the in-process report scheduler on the Node
 * runtime only (never Edge, never during build). The app is a single long-lived
 * `next start` server, so one setInterval here is the whole scheduler — it wakes
 * every minute and runDueReports() sends anything whose time has come.
 *
 * If the deployment ever runs multiple instances, disable this (WMS_SCHEDULER=0)
 * and drive GET /api/cron/email-report from an external cron instead — the
 * last_sent_on day-guard makes both paths safe to combine.
 */
const TICK_MS = 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WMS_SCHEDULER === "0") return;

  // Guard against a second interval when Next re-invokes register (HMR / workers).
  const g = globalThis as typeof globalThis & { __wmsSchedulerStarted?: boolean };
  if (g.__wmsSchedulerStarted) return;
  g.__wmsSchedulerStarted = true;

  const { runDueReports } = await import("@/lib/reportRunner");
  const tick = async () => {
    try {
      const r = await runDueReports();
      if (r.sent.length || r.failed.length) {
        console.log(`[wms-scheduler] sent=${r.sent.length} failed=${r.failed.length}`, r.failed.length ? r.failed : "");
      }
    } catch (err) {
      console.error("[wms-scheduler] tick error:", err instanceof Error ? err.message : err);
    }
  };
  const timer = setInterval(tick, TICK_MS);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive on its own
  console.log("[wms-scheduler] started (60s tick)");
}
