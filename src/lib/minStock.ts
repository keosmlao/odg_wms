import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";

/**
 * stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ ຕໍ່ (ສາງ, ສິນຄ້າ) — ເບິ່ງ migrations/035.
 *
 * ໂຄງສ້າງ 2 ຊັ້ນ:
 *   1) ສາງໃດຄຸມ (odg_wms_warehouse_config.min_stock) — ປິດໄວ້ໝົດ ຈົນກວ່າຈະເປີດ.
 *   2) ຄ່າ min/max ຕໍ່ສິນຄ້າ (odg_wms_min_stock) — ບໍ່ມີແຖວ = ບໍ່ຄຸມສິນຄ້ານັ້ນ.
 *
 * ຄົງເຫຼືອທີ່ເອົາມາທຽບຄື **ຍອດລວມທັງສາງ** (ບໍ່ແມ່ນຕໍ່ bin) = SUM(qty * calc_flag)
 * ຈາກ odg_wms_trans_detail ໂດຍ **ບໍ່ກັ່ນຕອງ status** — ເຫດຜົນດຽວກັນກັບໜ້າຄົງເຫຼືອ
 * (status=1 ຄືຂາອອກຂອງການຍ້າຍບ່ອນພາຍໃນ trans_flag 77 ບໍ່ແມ່ນແຖວທີ່ຖືກຍົກເລີກ).
 *
 * ທຸກຟັງຊັນອ່ານຫຸ້ມ try/catch ໄວ້ ເພື່ອໃຫ້ໜ້າຕ່າງໆ ຍັງເປີດໄດ້ກ່ອນ run migration 035.
 */

/** Minimal querier shape — the shared pool, or a transaction client. */
type Querier = Pick<PoolClient, "query">;

/** null = ທຸກສາງ, [] = ບໍ່ມີສາງ, [..] = ສະເພາະລະຫັດເຫຼົ່ານີ້ (ຄືກັນກັບ reportData). */
export type Scope = string[] | null;

export type MinStockStatus = "below" | "above" | "ok";

export type MinStockRule = {
  wh_code: string;
  wh_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  min_qty: number;
  max_qty: number | null;
  note: string | null;
  on_hand: number;
  status: MinStockStatus;
  /** ຂາດອີກເທົ່າໃດຈຶ່ງເຖິງຂັ້ນຕ່ຳ (0 ເມື່ອບໍ່ຕ່ຳກວ່າ). */
  shortfall: number;
  /** ເກີນຂັ້ນສູງເທົ່າໃດ (0 ເມື່ອບໍ່ເກີນ ຫຼື ບໍ່ໄດ້ຕັ້ງຂັ້ນສູງ). */
  excess: number;
  updated_at: string | null;
  updated_by: string | null;
};

type RuleRow = {
  wh_code: string;
  wh_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  min_qty: string;
  max_qty: string | null;
  note: string | null;
  on_hand: string;
  updated_at: string | null;
  updated_by: string | null;
};

const num = (v: string | null | undefined): number =>
  Math.round((Number.parseFloat(v ?? "0") || 0) * 10000) / 10000;

function toRule(r: RuleRow): MinStockRule {
  const min_qty = num(r.min_qty);
  const max_qty = r.max_qty === null ? null : num(r.max_qty);
  const on_hand = num(r.on_hand);
  const below = on_hand < min_qty - 1e-9;
  const above = max_qty !== null && on_hand > max_qty + 1e-9;
  return {
    wh_code: r.wh_code,
    wh_name: r.wh_name,
    item_code: r.item_code,
    item_name: r.item_name,
    unit_code: r.unit_code,
    min_qty,
    max_qty,
    note: r.note,
    on_hand,
    status: below ? "below" : above ? "above" : "ok",
    shortfall: below ? Math.round((min_qty - on_hand) * 10000) / 10000 : 0,
    excess: above ? Math.round((on_hand - (max_qty as number)) * 10000) / 10000 : 0,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}

/** ຄໍລຳຮ່ວມຂອງທຸກ query ທີ່ຄືນ MinStockRule (ຕ້ອງມີ alias `r` = odg_wms_min_stock). */
const RULE_COLS = `
  r.wh_code,
  w.name_1                       AS wh_name,
  r.item_code,
  i.name_1                       AS item_name,
  NULLIF(TRIM(i.unit_standard), '') AS unit_code,
  r.min_qty::text                AS min_qty,
  r.max_qty::text                AS max_qty,
  r.note,
  COALESCE(oh.qty, 0)::text      AS on_hand,
  to_char(r.updated_at, 'YYYY-MM-DD') AS updated_at,
  r.updated_by`;

// ─────────────────────── ສາງໃດເປີດຄຸມ min/max ───────────────────────

export type MinStockWarehouse = {
  wh_code: string;
  wh_name: string | null;
  enabled: boolean;
  rules: number;
  below: number;
  above: number;
};

/**
 * ທຸກສາງ ພ້ອມສະຖານະການຄຸມ + ຈຳນວນລາຍການທີ່ຕັ້ງ/ຕ່ຳກວ່າ/ເກີນ.
 * ນັບ below/above ໃຫ້ທຸກສາງທີ່ມີກົດ ເຖິງສາງນັ້ນຈະຍັງບໍ່ເປີດ — ຜູ້ຈັດການຈະໄດ້ເຫັນ
 * ຜົນກ່ອນຕັດສິນໃຈເປີດ.
 */
export async function listMinStockWarehouses(): Promise<MinStockWarehouse[]> {
  try {
    const rows = await query<{
      wh_code: string; wh_name: string | null; enabled: boolean;
      rules: number; below: number; above: number;
    }>(
      `WITH r AS (SELECT * FROM public.odg_wms_min_stock),
            oh AS (
              SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag) AS qty
                FROM public.odg_wms_trans_detail t
                JOIN r ON r.wh_code = t.wh_code AND r.item_code = t.item_code
               GROUP BY t.wh_code, t.item_code
            ),
            agg AS (
              SELECT r.wh_code,
                     count(*)::int AS rules,
                     count(*) FILTER (WHERE COALESCE(oh.qty, 0) < r.min_qty)::int AS below,
                     count(*) FILTER (WHERE r.max_qty IS NOT NULL AND COALESCE(oh.qty, 0) > r.max_qty)::int AS above
                FROM r
                LEFT JOIN oh ON oh.wh_code = r.wh_code AND oh.item_code = r.item_code
               GROUP BY r.wh_code
            )
       SELECT w.code                              AS wh_code,
              w.name_1                            AS wh_name,
              COALESCE(c.min_stock, false)        AS enabled,
              COALESCE(agg.rules, 0)              AS rules,
              COALESCE(agg.below, 0)              AS below,
              COALESCE(agg.above, 0)              AS above
         FROM public.ic_warehouse w
         LEFT JOIN public.odg_wms_warehouse_config c ON c.wh_code = w.code
         LEFT JOIN agg ON agg.wh_code = w.code
        ORDER BY w.code`,
    );
    return rows;
  } catch {
    return []; // ຍັງບໍ່ໄດ້ run migration 035
  }
}

/** ລະຫັດສາງທີ່ເປີດຄຸມ min/max (ຈຳກັດດ້ວຍ scope ໄດ້). */
export async function enabledMinStockWarehouses(scope: Scope = null): Promise<string[]> {
  if (Array.isArray(scope) && scope.length === 0) return [];
  try {
    const args: unknown[] = [];
    let clause = "";
    if (scope !== null) { args.push(scope); clause = `AND wh_code = ANY($${args.length})`; }
    const rows = await query<{ wh_code: string }>(
      `SELECT wh_code FROM public.odg_wms_warehouse_config
        WHERE min_stock IS TRUE ${clause}
        ORDER BY wh_code`,
      args,
    );
    return rows.map((r) => r.wh_code);
  } catch {
    return [];
  }
}

/** ສາງນີ້ຄຸມ min/max ບໍ (ຄ່າເລີ່ມຕົ້ນ false). */
export async function minStockEnabled(whCode: string, client?: Querier): Promise<boolean> {
  const sql = `SELECT min_stock FROM public.odg_wms_warehouse_config WHERE wh_code = $1`;
  try {
    const rows = client
      ? (await client.query<{ min_stock: boolean | null }>(sql, [whCode])).rows
      : await query<{ min_stock: boolean | null }>(sql, [whCode]);
    return rows[0]?.min_stock === true;
  } catch {
    return false;
  }
}

/** ເປີດ/ປິດ ການຄຸມ min/max ຂອງສາງ. */
export async function setMinStockWarehouse(
  whCode: string,
  value: boolean,
  updatedBy: string | null,
): Promise<void> {
  await query(
    `INSERT INTO public.odg_wms_warehouse_config (wh_code, min_stock, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (wh_code)
     DO UPDATE SET min_stock = EXCLUDED.min_stock, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [whCode.trim(), value, updatedBy],
  );
}

// ─────────────────────── ຄ່າ min/max ຕໍ່ສິນຄ້າ ───────────────────────

/** ກົດທັງໝົດຂອງສາງໜຶ່ງ ພ້ອມຄົງເຫຼືອປັດຈຸບັນ. ຄົ້ນດ້ວຍ q (ລະຫັດ ຫຼື ຊື່). */
export async function listMinStockRules(
  whCode: string,
  opts: { q?: string; only?: MinStockStatus | "all"; limit?: number } = {},
): Promise<MinStockRule[]> {
  const { q = "", only = "all", limit = 500 } = opts;
  try {
    const args: unknown[] = [whCode];
    let search = "";
    if (q.trim()) {
      args.push(`%${q.trim().replace(/[\\%_]/g, "\\$&")}%`);
      search = `AND (r.item_code ILIKE $${args.length} ESCAPE '\\' OR i.name_1 ILIKE $${args.length} ESCAPE '\\')`;
    }
    args.push(limit);
    const rows = await query<RuleRow>(
      `WITH r AS (SELECT * FROM public.odg_wms_min_stock WHERE wh_code = $1),
            oh AS (
              SELECT t.item_code, SUM(t.qty * t.calc_flag) AS qty
                FROM public.odg_wms_trans_detail t
                JOIN r ON r.item_code = t.item_code
               WHERE t.wh_code = $1
               GROUP BY t.item_code
            )
       SELECT ${RULE_COLS}
         FROM r
         LEFT JOIN oh ON oh.item_code = r.item_code
         LEFT JOIN public.ic_inventory i ON i.code = r.item_code
         LEFT JOIN public.ic_warehouse  w ON w.code = r.wh_code
        WHERE TRUE ${search}
        ORDER BY (COALESCE(oh.qty, 0) < r.min_qty) DESC, r.item_code
        LIMIT $${args.length}`,
      args,
    );
    const rules = rows.map(toRule);
    return only === "all" ? rules : rules.filter((x) => x.status === only);
  } catch {
    return [];
  }
}

export type MinStockInput = {
  item_code: string;
  min_qty: number;
  /** null = ບໍ່ຄຸມຂັ້ນສູງ */
  max_qty: number | null;
  note?: string | null;
};

/**
 * ບັນທຶກກົດເປັນຊຸດ (upsert). ຄືນຈຳນວນແຖວທີ່ບັນທຶກ.
 * ຄ່າທີ່ບໍ່ຖືກຕ້ອງ (min ຕິດລົບ, max < min) ຖືກປະຕິເສດຕັ້ງແຕ່ຊັ້ນນີ້ ເພື່ອໃຫ້ໄດ້
 * ຂໍ້ຄວາມພາສາລາວ ແທນ error ຂອງ CHECK constraint.
 */
export async function upsertMinStockRules(
  whCode: string,
  rows: MinStockInput[],
  updatedBy: string | null,
): Promise<number> {
  const clean: MinStockInput[] = [];
  for (const r of rows) {
    const item = r.item_code.trim();
    if (!item) continue;
    if (!Number.isFinite(r.min_qty) || r.min_qty < 0) {
      throw new Error(`${item}: ຂັ້ນຕ່ຳຕ້ອງເປັນຕົວເລກ ແລະ ບໍ່ຕິດລົບ`);
    }
    if (r.max_qty !== null && (!Number.isFinite(r.max_qty) || r.max_qty < r.min_qty)) {
      throw new Error(`${item}: ຂັ້ນສູງຕ້ອງບໍ່ນ້ອຍກວ່າຂັ້ນຕ່ຳ`);
    }
    clean.push({ item_code: item, min_qty: r.min_qty, max_qty: r.max_qty, note: r.note?.trim() || null });
  }
  if (clean.length === 0) return 0;

  await query(
    `INSERT INTO public.odg_wms_min_stock (wh_code, item_code, min_qty, max_qty, note, updated_at, updated_by)
     SELECT $1, x.item_code, x.min_qty, x.max_qty, x.note, now(), $2
       FROM unnest($3::text[], $4::numeric[], $5::numeric[], $6::text[])
            AS x(item_code, min_qty, max_qty, note)
     ON CONFLICT (wh_code, item_code) DO UPDATE
       SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty, note = EXCLUDED.note,
           updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [
      whCode.trim(),
      updatedBy,
      clean.map((c) => c.item_code),
      clean.map((c) => c.min_qty),
      clean.map((c) => c.max_qty),
      clean.map((c) => c.note ?? null),
    ],
  );
  return clean.length;
}

/** ລົບກົດ 1 ລາຍການ — ສິນຄ້ານັ້ນເຊົາຖືກຄຸມໃນສາງນີ້. */
export async function deleteMinStockRule(whCode: string, itemCode: string): Promise<boolean> {
  const rows = await query<{ item_code: string }>(
    `DELETE FROM public.odg_wms_min_stock WHERE wh_code = $1 AND item_code = $2 RETURNING item_code`,
    [whCode.trim(), itemCode.trim()],
  );
  return rows.length > 0;
}

export type MinStockItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  on_hand: number;
  /** ຄ່າທີ່ຕັ້ງໄວ້ແລ້ວໃນສາງນີ້ (null = ຍັງບໍ່ໄດ້ຕັ້ງ). */
  min_qty: number | null;
  max_qty: number | null;
};

/**
 * ຄົ້ນສິນຄ້າເພື່ອເພີ່ມກົດ. ຈັດລຳດັບໃຫ້ສິນຄ້າທີ່ມີເຄື່ອນໄຫວໃນສາງນີ້ຂຶ້ນກ່ອນ —
 * ຄັງມີ 24k ລາຍການ ແຕ່ສາງໜຶ່ງແຕະຕ້ອງພຽງ ~5k.
 */
export async function searchMinStockItems(
  whCode: string,
  q: string,
  limit = 30,
): Promise<MinStockItemHit[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  try {
    const rows = await query<{
      item_code: string; item_name: string | null; unit_code: string | null;
      on_hand: string | null; min_qty: string | null; max_qty: string | null;
    }>(
      `SELECT i.code                              AS item_code,
              i.name_1                            AS item_name,
              NULLIF(TRIM(i.unit_standard), '')   AS unit_code,
              oh.qty::text                        AS on_hand,
              m.min_qty::text                     AS min_qty,
              m.max_qty::text                     AS max_qty
         FROM public.ic_inventory i
         LEFT JOIN LATERAL (
           SELECT SUM(t.qty * t.calc_flag) AS qty
             FROM public.odg_wms_trans_detail t
            WHERE t.wh_code = $1 AND t.item_code = i.code
         ) oh ON TRUE
         LEFT JOIN public.odg_wms_min_stock m ON m.wh_code = $1 AND m.item_code = i.code
        WHERE i.code ILIKE $2 ESCAPE '\\' OR i.name_1 ILIKE $2 ESCAPE '\\'
        ORDER BY (oh.qty IS NULL) ASC,
                 CASE WHEN i.code ILIKE $2 ESCAPE '\\' THEN 0 ELSE 1 END,
                 i.code
        LIMIT $3`,
      [whCode, like, limit],
    );
    return rows.map((r) => ({
      item_code: r.item_code,
      item_name: r.item_name,
      unit_code: r.unit_code,
      on_hand: num(r.on_hand),
      min_qty: r.min_qty === null ? null : num(r.min_qty),
      max_qty: r.max_qty === null ? null : num(r.max_qty),
    }));
  } catch {
    return [];
  }
}

// ─────────────────────── ການເຕືອນ (ລາຍງານ / badge / ເມວ) ───────────────────────

/**
 * ລາຍການທີ່ຕ່ຳກວ່າຂັ້ນຕ່ຳ ຫຼື ເກີນຂັ້ນສູງ — ສະເພາະສາງທີ່**ເປີດ**ຄຸມ.
 * ຮຸນແຮງສຸດກ່ອນ: ຕ່ຳກວ່າກ່ອນ, ແລ້ວຕາມສັດສ່ວນທີ່ຂາດ.
 */
export async function minStockAlerts(
  scope: Scope = null,
  opts: { only?: "below" | "above" | "all"; limit?: number } = {},
): Promise<MinStockRule[]> {
  const { only = "all", limit = 200 } = opts;
  if (Array.isArray(scope) && scope.length === 0) return [];
  try {
    const args: unknown[] = [];
    let clause = "";
    if (scope !== null) { args.push(scope); clause = `AND c.wh_code = ANY($${args.length})`; }
    args.push(limit);
    const rows = await query<RuleRow>(
      `WITH wh AS (
         SELECT c.wh_code FROM public.odg_wms_warehouse_config c
          WHERE c.min_stock IS TRUE ${clause}
       ),
       r AS (
         SELECT m.* FROM public.odg_wms_min_stock m JOIN wh ON wh.wh_code = m.wh_code
       ),
       oh AS (
         SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag) AS qty
           FROM public.odg_wms_trans_detail t
           JOIN r ON r.wh_code = t.wh_code AND r.item_code = t.item_code
          GROUP BY t.wh_code, t.item_code
       )
       SELECT ${RULE_COLS}
         FROM r
         LEFT JOIN oh ON oh.wh_code = r.wh_code AND oh.item_code = r.item_code
         LEFT JOIN public.ic_inventory i ON i.code = r.item_code
         LEFT JOIN public.ic_warehouse  w ON w.code = r.wh_code
        WHERE COALESCE(oh.qty, 0) < r.min_qty
           OR (r.max_qty IS NOT NULL AND COALESCE(oh.qty, 0) > r.max_qty)
        ORDER BY (COALESCE(oh.qty, 0) < r.min_qty) DESC,
                 CASE WHEN r.min_qty > 0
                      THEN (r.min_qty - COALESCE(oh.qty, 0)) / r.min_qty ELSE 0 END DESC,
                 r.wh_code, r.item_code
        LIMIT $${args.length}`,
      args,
    );
    const rules = rows.map(toRule);
    return only === "all" ? rules : rules.filter((x) => x.status === only);
  } catch {
    return [];
  }
}

export type MinStockSummary = { below: number; above: number; rules: number; warehouses: number };

/** ຕົວເລກສະຫຼຸບສຳລັບ badge ໜ້າຫຼັກ / KPI — ສະເພາະສາງທີ່ເປີດຄຸມ. */
export async function minStockSummary(scope: Scope = null): Promise<MinStockSummary> {
  const empty: MinStockSummary = { below: 0, above: 0, rules: 0, warehouses: 0 };
  if (Array.isArray(scope) && scope.length === 0) return empty;
  try {
    const args: unknown[] = [];
    let clause = "";
    if (scope !== null) { args.push(scope); clause = `AND c.wh_code = ANY($${args.length})`; }
    const rows = await query<{ below: number; above: number; rules: number; warehouses: number }>(
      `WITH wh AS (
         SELECT c.wh_code FROM public.odg_wms_warehouse_config c
          WHERE c.min_stock IS TRUE ${clause}
       ),
       r AS (
         SELECT m.* FROM public.odg_wms_min_stock m JOIN wh ON wh.wh_code = m.wh_code
       ),
       oh AS (
         SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag) AS qty
           FROM public.odg_wms_trans_detail t
           JOIN r ON r.wh_code = t.wh_code AND r.item_code = t.item_code
          GROUP BY t.wh_code, t.item_code
       )
       SELECT count(*) FILTER (WHERE COALESCE(oh.qty, 0) < r.min_qty)::int AS below,
              count(*) FILTER (WHERE r.max_qty IS NOT NULL AND COALESCE(oh.qty, 0) > r.max_qty)::int AS above,
              count(*)::int AS rules,
              (SELECT count(*)::int FROM wh) AS warehouses
         FROM r
         LEFT JOIN oh ON oh.wh_code = r.wh_code AND oh.item_code = r.item_code`,
      args,
    );
    return rows[0] ?? empty;
  } catch {
    return empty;
  }
}

export type MinStockLevel = {
  min_qty: number;
  max_qty: number | null;
  /** ຄົງເຫຼືອລວມທັງສາງ (ບໍ່ແມ່ນຕໍ່ bin). */
  on_hand: number;
};

/**
 * ຄ່າ min/max + ຄົງເຫຼືອລວມ ຂອງສິນຄ້າໃນສາງໜຶ່ງ — ໃຫ້ໜ້າຈ່າຍອອກ ແລະ ໜ້າຄົງເຫຼືອ
 * ເອົາໄປເຕືອນ. ຄືນ Map ຫວ່າງ ຖ້າສາງບໍ່ໄດ້ເປີດຄຸມ (ຈຶ່ງບໍ່ຕ້ອງກວດ flag ຊ້ຳຢູ່ຝັ່ງ caller).
 */
export async function minStockLevels(
  whCode: string,
  itemCodes: string[],
): Promise<Map<string, MinStockLevel>> {
  const out = new Map<string, MinStockLevel>();
  if (itemCodes.length === 0) return out;
  try {
    const rows = await query<{ item_code: string; min_qty: string; max_qty: string | null; on_hand: string }>(
      `WITH r AS (
         SELECT m.item_code, m.min_qty, m.max_qty
           FROM public.odg_wms_min_stock m
           JOIN public.odg_wms_warehouse_config c
             ON c.wh_code = m.wh_code AND c.min_stock IS TRUE
          WHERE m.wh_code = $1 AND m.item_code = ANY($2)
       ),
       oh AS (
         SELECT t.item_code, SUM(t.qty * t.calc_flag) AS qty
           FROM public.odg_wms_trans_detail t
           JOIN r ON r.item_code = t.item_code
          WHERE t.wh_code = $1
          GROUP BY t.item_code
       )
       SELECT r.item_code, r.min_qty::text AS min_qty, r.max_qty::text AS max_qty,
              COALESCE(oh.qty, 0)::text AS on_hand
         FROM r LEFT JOIN oh ON oh.item_code = r.item_code`,
      [whCode, itemCodes],
    );
    for (const r of rows) {
      out.set(r.item_code, {
        min_qty: num(r.min_qty),
        max_qty: r.max_qty === null ? null : num(r.max_qty),
        on_hand: num(r.on_hand),
      });
    }
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 035 — ບໍ່ມີການເຕືອນ, ໜ້າອື່ນເຮັດວຽກປົກກະຕິ
  }
  return out;
}

/** ລົບກົດທັງໝົດຂອງສາງ (ໃຊ້ຕອນຕັ້ງຄ່າໃໝ່ຈາກ Excel ແບບແທນທີ່). */
export async function clearMinStockRules(whCode: string): Promise<number> {
  const client = await pool.connect();
  try {
    const res = await client.query(`DELETE FROM public.odg_wms_min_stock WHERE wh_code = $1`, [whCode.trim()]);
    return res.rowCount ?? 0;
  } finally {
    client.release();
  }
}
