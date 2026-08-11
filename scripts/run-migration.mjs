import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/run-migration.mjs <sql-file>");
  process.exit(2);
}

// Load .env.local when the shell has not exported the DB vars. Without this the
// pg defaults kick in and the script silently connects to a local database
// named after the OS user instead of the WMS database.
if (!process.env.DATABASE_HOST && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const missing = ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`✗ Missing env: ${missing.join(", ")} — run from the project root so .env.local is found.`);
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
