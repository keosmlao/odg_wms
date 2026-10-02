import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool() {
  const useSsl = (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Keep idle sockets alive so the remote DB / network is less likely to drop
    // them out from under us.
    keepAlive: true,
  });
  // CRITICAL: a pooled idle client can lose its connection (the remote DB closes
  // idle sockets). node-postgres emits 'error' on that client; without this
  // handler Node escalates it to an uncaughtException and kills the dev server.
  pool.on("error", (err) => {
    console.error("[pg pool] idle client error (ignored):", err.message);
  });
  return pool;
}

export const pool: Pool = global.__pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(text, params as never);
  return res.rows as T[];
}

/**
 * Postgres includes WHICH table/column a write violated (length, not-null,
 * check, …) in the wire protocol's ErrorResponse, and `pg` exposes it as
 * `.table`/`.column`/`.constraint` on the thrown error — but a bare
 * `err.message` drops that, leaving e.g. "value too long for type character
 * varying(50)" with no clue which of a dozen columns in the statement it was.
 * Routes should format their catch-block error through this instead of
 * `err.message` alone, so the NEXT occurrence names the column outright.
 */
export function pgErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "ບໍ່ສຳເລັດ";
  const e = err as Error & { table?: string; column?: string; constraint?: string };
  const where = e.table && e.column ? ` (${e.table}.${e.column})` : e.constraint ? ` (constraint: ${e.constraint})` : "";
  return `${err.message}${where}`;
}
