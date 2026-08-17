import type { PoolClient } from "pg";

/**
 * `odg_product_defect` tracks defective units by serial (sn/isn) — a pre-existing
 * ERP-adjacent table (like ic_inventory/sn_inventory) this app queries directly;
 * no migration owns its schema. A row's `sn`/`isn` identifies the same physical
 * unit as `sn_inventory.sn`/`.isn`, so it's matched the same way: by whichever id
 * was actually scanned, against either column.
 */

/** A unit issued out (trans_flag 56) or sold (44) leaves the company — close out
 *  its defect record so it stops showing as on-hand. */
export async function markDefectDispatched(client: PoolClient, serials: string[]): Promise<number> {
  if (serials.length === 0) return 0;
  const res = await client.query(
    `UPDATE public.odg_product_defect SET status = 1 WHERE sn = ANY($1) OR isn = ANY($1)`,
    [serials],
  );
  return res.rowCount ?? 0;
}

/** A unit relocates (a transfer leg, out to in-transit or in-transit to a real
 *  warehouse) — follow it so the defect record always names where it actually is. */
export async function moveDefectWarehouse(client: PoolClient, serials: string[], warehouse: string): Promise<number> {
  if (serials.length === 0) return 0;
  const res = await client.query(
    `UPDATE public.odg_product_defect SET warehouse = $2 WHERE sn = ANY($1) OR isn = ANY($1)`,
    [serials, warehouse],
  );
  return res.rowCount ?? 0;
}
