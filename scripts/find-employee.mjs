import pg from "pg";

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

const matches = await client.query(`
  SELECT table_schema, table_name, table_type
  FROM information_schema.tables
  WHERE table_name ILIKE '%employee%' OR table_name ILIKE '%odg%'
  ORDER BY table_schema, table_name
`);
console.log("Tables matching employee/odg:", matches.rows);

if (matches.rows.length > 0) {
  for (const t of matches.rows) {
    const cols = await client.query(
      `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [t.table_schema, t.table_name],
    );
    console.log(`\n${t.table_schema}.${t.table_name}:`);
    for (const c of cols.rows) {
      console.log(
        `  - ${c.column_name} : ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${c.column_default ? " DEFAULT " + c.column_default : ""}`,
      );
    }
    const sample = await client.query(
      `SELECT * FROM "${t.table_schema}"."${t.table_name}" LIMIT 1`,
    );
    if (sample.rows.length > 0) {
      const row = { ...sample.rows[0] };
      for (const k of Object.keys(row)) {
        if (/pass|secret|token|hash/i.test(k) && row[k]) {
          row[k] = "[REDACTED]";
        }
      }
      console.log("  sample row:", row);
    }
  }
}

await client.end();
