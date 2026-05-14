import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/run-migration.mjs <sql-file>");
  process.exit(2);
}

const sql = readFileSync(file, "utf8");
const useSsl = (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
const client = new pg.Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
console.log("Running:", file);
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("✓ Migration applied");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
