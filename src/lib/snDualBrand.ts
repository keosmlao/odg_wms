import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";

/** Minimal querier shape — the shared pool, or a transaction client. */
type Querier = Pick<PoolClient, "query">;

/**
 * Brands (ic_inventory.item_brand) whose units must carry BOTH sn and isn before
 * they can be issued out. Admin-configurable via `odg_wms_sn_dual_brand`; falls
 * back to ['SAMSUNG'] when the table is absent (pre-migration 024).
 */
export async function getSnDualBrands(client?: Querier): Promise<string[]> {
  const sql = `SELECT brand FROM public.odg_wms_sn_dual_brand ORDER BY brand`;
  try {
    const rows = client
      ? (await client.query<{ brand: string }>(sql)).rows
      : await query<{ brand: string }>(sql);
    return rows.map((r) => r.brand);
  } catch {
    return ["SAMSUNG"]; // table not present yet — preserve original behaviour
  }
}

/** Replace the whole brand list (manager settings). Brands are trimmed + de-duped. */
export async function setSnDualBrands(
  brands: string[],
  updatedBy: string | null,
): Promise<string[]> {
  const clean = Array.from(
    new Set(brands.map((b) => b.trim()).filter((b) => b.length > 0 && b.length <= 60)),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM public.odg_wms_sn_dual_brand`);
    if (clean.length > 0) {
      await client.query(
        `INSERT INTO public.odg_wms_sn_dual_brand (brand, updated_at, updated_by)
         SELECT unnest($1::text[]), now(), $2`,
        [clean, updatedBy],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return clean;
}
