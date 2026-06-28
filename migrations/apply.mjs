// One-time migrations for the transfer pro-features.
// Run from the project root:  node migrations/apply.mjs
import pg from "pg";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const c = new pg.Client({
  host: env.DATABASE_HOST || env.PGHOST,
  port: +(env.DATABASE_PORT || 5432),
  user: env.DATABASE_USER || env.PGUSER,
  password: env.DATABASE_PASSWORD || env.PGPASSWORD,
  database: env.DATABASE_NAME || "odg",
});

await c.connect();
try {
  await c.query("BEGIN");

  // 1) Approve the existing 124 backlog so only NEW requests need approval.
  const upd = await c.query(
    `UPDATE public.ic_trans SET status = 1 WHERE trans_flag = 124 AND COALESCE(status,0) = 0`,
  );
  console.log(`1) auto-approved backlog: ${upd.rowCount} rows (124 status 0 -> 1)`);

  // 2) Short-movement reason notes table.
  await c.query(`
    CREATE TABLE IF NOT EXISTS public.odg_wms_move_note (
      roworder     bigserial PRIMARY KEY,
      doc_no       varchar(40),
      ref_doc      varchar(40),
      item_code    varchar(40),
      reason_code  varchar(20),
      reason_text  varchar(200),
      short_qty    numeric,
      stage        varchar(20),
      user_created varchar(40),
      created_at   timestamp DEFAULT now()
    )`);
  console.log("2) table public.odg_wms_move_note ready");

  await c.query("COMMIT");
  console.log("\n✅ migrations committed");
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("❌ failed, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
