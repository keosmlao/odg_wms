import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool() {
  const useSsl = (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
  return new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
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
