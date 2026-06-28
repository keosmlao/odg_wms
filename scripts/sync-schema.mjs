/**
 * Sync schema additively from a source DB (default: odg) into the target DB
 * configured in .env.local (e.g. odg_test). It ONLY adds what's missing — it
 * never drops or alters existing columns/tables, so it is safe to re-run.
 *
 *   node scripts/sync-schema.mjs            # dry-run: print what's missing
 *   node scripts/sync-schema.mjs --apply    # actually ADD the missing columns
 *
 * Source DB defaults to "odg"; override with SOURCE_DB=odg node scripts/...
 * Missing TABLES and SEQUENCES are reported (not auto-created) — for those use:
 *   pg_dump -s -t <table> -h <host> -U <user> odg | psql -h <host> -U <user> <target>
 */
import pg from "pg";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const APPLY = process.argv.includes("--apply");
const SOURCE_DB = process.env.SOURCE_DB || "odg";
const TARGET_DB = process.env.DATABASE_NAME;
const base = {
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 15000,
};

if (SOURCE_DB === TARGET_DB) {
  console.error(`Source and target are both "${TARGET_DB}". Set SOURCE_DB or DATABASE_NAME differently.`);
  process.exit(1);
}

/** Build the SQL type string from an information_schema.columns row. */
function typeOf(c) {
  const u = c.udt_name;
  if (c.data_type === "character varying") return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "varchar";
  if (c.data_type === "character") return c.character_maximum_length ? `char(${c.character_maximum_length})` : "char";
  if (c.data_type === "numeric") return c.numeric_precision ? `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})` : "numeric";
  if (c.data_type === "ARRAY") return `${u.replace(/^_/, "")}[]`;
  const map = { int2: "smallint", int4: "integer", int8: "bigint", bool: "boolean", timestamp: "timestamp", timestamptz: "timestamptz", bpchar: "char", text: "text", date: "date", float4: "real", float8: "double precision" };
  return map[u] ?? c.data_type;
}

async function columns(client) {
  const r = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
  );
  const byTable = new Map();
  for (const row of r.rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map());
    byTable.get(row.table_name).set(row.column_name, row);
  }
  return byTable;
}
async function relnames(client, kinds) {
  const r = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind = ANY($1)`,
    [kinds],
  );
  return new Set(r.rows.map((x) => x.relname));
}

const src = new pg.Client({ ...base, database: SOURCE_DB });
const tgt = new pg.Client({ ...base, database: TARGET_DB });
try {
  await src.connect();
  await tgt.connect();
  console.log(`source = ${SOURCE_DB}, target = ${TARGET_DB}, mode = ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const [srcCols, tgtCols] = await Promise.all([columns(src), columns(tgt)]);
  const [srcSeq, tgtSeq] = await Promise.all([relnames(src, ["S"]), relnames(tgt, ["S"])]);

  const missingTables = [];
  const missingColsByTable = [];
  for (const [table, cols] of srcCols) {
    if (!tgtCols.has(table)) {
      missingTables.push(table);
      continue;
    }
    const have = tgtCols.get(table);
    const missing = [...cols.values()].filter((c) => !have.has(c.column_name));
    if (missing.length) missingColsByTable.push([table, missing]);
  }
  const missingSeq = [...srcSeq].filter((s) => !tgtSeq.has(s));

  let added = 0;
  for (const [table, missing] of missingColsByTable) {
    for (const c of missing) {
      const sql = `ALTER TABLE public."${table}" ADD COLUMN IF NOT EXISTS "${c.column_name}" ${typeOf(c)};`;
      if (APPLY) {
        await tgt.query(sql);
        added++;
        console.log("✓ " + sql);
      } else {
        console.log("  " + sql);
      }
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`columns ${APPLY ? "added" : "missing"}: ${APPLY ? added : missingColsByTable.reduce((n, [, m]) => n + m.length, 0)} across ${missingColsByTable.length} table(s)`);
  if (missingTables.length) console.log(`\n⚠ TABLES missing in ${TARGET_DB} (not auto-created):\n  ${missingTables.join(", ")}`);
  if (missingSeq.length) console.log(`\n⚠ SEQUENCES missing in ${TARGET_DB}:\n  ${missingSeq.join(", ")}\n  create with: CREATE SEQUENCE IF NOT EXISTS public.<name>;`);
  if (!APPLY) console.log(`\nRe-run with --apply to add the missing columns.`);
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await src.end().catch(() => {});
  await tgt.end().catch(() => {});
}
