import pg from "pg";

const useSsl = (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
const client = new pg.Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
  console.log("✓ Connected to", process.env.DATABASE_HOST);

  const ver = await client.query("SELECT version()");
  console.log("Server:", ver.rows[0].version.split(",")[0]);

  const schemas = await client.query(`
    SELECT nspname AS schema
    FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND nspname NOT LIKE 'pg_temp_%'
      AND nspname NOT LIKE 'pg_toast_temp_%'
    ORDER BY nspname
  `);
  console.log("\nSchemas:", schemas.rows.map((r) => r.schema).join(", ") || "(none)");

  const tables = await client.query(`
    SELECT n.nspname AS schema, c.relname AS table,
           c.reltuples::bigint AS approx_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY n.nspname, c.relname
  `);

  console.log(`\nTables (${tables.rows.length}):`);
  for (const t of tables.rows) {
    console.log(`  ${t.schema}.${t.table}  (~${t.approx_rows} rows)`);
  }

  if (tables.rows.length > 0 && tables.rows.length <= 80) {
    console.log("\nColumns per table:");
    for (const t of tables.rows) {
      const cols = await client.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
        `,
        [t.schema, t.table],
      );
      console.log(`\n  ${t.schema}.${t.table}:`);
      for (const c of cols.rows) {
        console.log(
          `    - ${c.column_name} : ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}`,
        );
      }
    }
  }
} catch (err) {
  console.error("✗ Connection failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
