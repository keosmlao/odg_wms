import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";

/**
 * ຂອບເຂດສິນຄ້າທີ່ຕ້ອງເກັບ ISN — ຄຸມດ້ວຍ **ໝວດ** (odg_wms_isn_category) ພ້ອມ
 * **ຍົກເວັ້ນລາຍສິນຄ້າ** (odg_wms_isn_item) ທັບ. ເບິ່ງ migrations/034.
 *
 * ເປັນຫຍັງບໍ່ໃຊ້ `ic_inventory.is_isn`: SML ຕັ້ງ is_isn = 1 ໄວ້ 99.8% ຂອງລາຍການ
 * (24,172/24,211) ໃນຂະນະທີ່ມີ serial ຈິງພຽງ ~2,005 — ອ່ານທຸງນັ້ນຕົງໆ ຈຶ່ງບັງຄັບ
 * ສ້າງ ISN ໃສ່ທຸກສິ່ງທີ່ຮັບເຂົ້າສາງ.
 */

/** Minimal querier shape — the shared pool, or a transaction client. */
type Querier = Pick<PoolClient, "query">;

/**
 * SQL: ສິນຄ້ານີ້ຕ້ອງເກັບ ISN ບໍ. ໃຊ້ຝັງໃນ query ອື່ນທີ່ join ic_inventory ຢູ່ແລ້ວ —
 * ສົ່ງ alias ຂອງ ic_inventory ເຂົ້າມາ (ຄ່າເລີ່ມຕົ້ນ `inv`).
 *
 * ຕົວຢ່າງ: `SELECT ${needsIsnSql("i")} AS is_isn FROM public.ic_inventory i`
 */
export function needsIsnSql(invAlias = "inv"): string {
  return `COALESCE(
    (SELECT ov.require_isn FROM public.odg_wms_isn_item ov WHERE ov.item_code = ${invAlias}.code),
    (SELECT c.require_isn  FROM public.odg_wms_isn_category c
      WHERE c.category_code = NULLIF(TRIM(${invAlias}.item_category), '')),
    false)`;
}

export type IsnScope = { needs_isn: boolean; category: string };

/**
 * ຄຳຕອບຕໍ່ລາຍສິນຄ້າ: ຕ້ອງເກັບ ISN ບໍ + ໝວດ (ໝວດຄື prefix ຂອງເລກ ISN).
 * ຖ້າ view ຍັງບໍ່ທັນມີ (ຍັງບໍ່ໄດ້ run migration 034) ຈະຖອຍໄປໃຊ້ `is_isn` ແບບເກົ່າ
 * ເພື່ອບໍ່ໃຫ້ການຮັບເຂົ້າລົ້ມ.
 */
export async function getIsnScope(
  client: Querier,
  itemCodes: string[],
): Promise<Map<string, IsnScope>> {
  if (itemCodes.length === 0) return new Map();
  try {
    const r = await client.query<{ code: string; category: string | null; needs_isn: boolean }>(
      `SELECT code, category, needs_isn FROM public.odg_wms_isn_scope WHERE code = ANY($1)`,
      [itemCodes],
    );
    return new Map(r.rows.map((x) => [x.code, { needs_isn: x.needs_isn, category: (x.category ?? "").trim() }]));
  } catch {
    // pre-migration-034 fallback — ພຶດຕິກຳເກົ່າ (ກວ້າງເກີນໄປ ແຕ່ບໍ່ພັງ)
    const r = await client.query<{ code: string; item_category: string | null; is_isn: number | null }>(
      `SELECT code, item_category, is_isn FROM public.ic_inventory WHERE code = ANY($1)`,
      [itemCodes],
    );
    return new Map(
      r.rows.map((x) => [x.code, { needs_isn: (x.is_isn ?? 0) === 1, category: (x.item_category ?? "").trim() }]),
    );
  }
}

// ───────────────────────── ໜ້າຕັ້ງຄ່າ: ໝວດ ─────────────────────────

export type IsnCategoryRow = {
  category_code: string;
  category_name: string | null;
  items: number;
  /** ຈຳນວນລາຍການທີ່ມີ serial ຢູ່ໃນ sn_inventory ຈິງ — ໃຊ້ຕັດສິນວ່າຄວນເປີດບໍ. */
  items_with_sn: number;
  require_isn: boolean;
};

/** ທຸກໝວດທີ່ມີສິນຄ້າ ພ້ອມສະຖິຕິ serial ຈິງ ແລະ ຄ່າທີ່ຕັ້ງໄວ້. */
export async function listIsnCategories(): Promise<IsnCategoryRow[]> {
  return query<IsnCategoryRow>(
    `WITH ser AS (SELECT DISTINCT item_code FROM public.sn_inventory)
     SELECT cat                                            AS category_code,
            MAX(cname)                                     AS category_name,
            count(*)::int                                  AS items,
            count(*) FILTER (WHERE has_sn)::int            AS items_with_sn,
            bool_or(COALESCE(cfg.require_isn, false))      AS require_isn
       FROM (
         SELECT NULLIF(TRIM(i.item_category), '')     AS cat,
                cg.name_1                             AS cname,
                (s.item_code IS NOT NULL)             AS has_sn
           FROM public.ic_inventory i
           LEFT JOIN ser              s  ON s.item_code = i.code
           LEFT JOIN public.ic_category cg ON cg.code   = NULLIF(TRIM(i.item_category), '')
       ) x
       LEFT JOIN public.odg_wms_isn_category cfg ON cfg.category_code = x.cat
      WHERE cat IS NOT NULL
      GROUP BY cat
      ORDER BY items_with_sn DESC, items DESC, cat`,
  );
}

/** ຕັ້ງຄ່າໝວດເປັນຊຸດ. ໝວດທີ່ປິດຈະຖືກລົບອອກ (ບໍ່ມີແຖວ = ບໍ່ຕ້ອງເກັບ ISN). */
export async function setIsnCategories(
  changes: { category_code: string; require_isn: boolean }[],
  updatedBy: string | null,
): Promise<void> {
  const on = changes.filter((c) => c.require_isn).map((c) => c.category_code.trim()).filter(Boolean);
  const off = changes.filter((c) => !c.require_isn).map((c) => c.category_code.trim()).filter(Boolean);
  if (on.length === 0 && off.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (off.length > 0) {
      await client.query(`DELETE FROM public.odg_wms_isn_category WHERE category_code = ANY($1)`, [off]);
    }
    if (on.length > 0) {
      await client.query(
        `INSERT INTO public.odg_wms_isn_category (category_code, require_isn, updated_at, updated_by)
         SELECT unnest($1::text[]), true, now(), $2
         ON CONFLICT (category_code)
         DO UPDATE SET require_isn = true, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [on, updatedBy],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────── ໜ້າຕັ້ງຄ່າ: ຍົກເວັ້ນລາຍສິນຄ້າ ────────────────────

export type IsnItemRow = {
  item_code: string;
  item_name: string | null;
  category: string | null;
  category_name: string | null;
  require_isn: boolean;
  note: string | null;
  /** ຄ່າທີ່ໝວດຂອງມັນໃຫ້ — ໃຫ້ເຫັນວ່າແຖວນີ້ກຳລັງທັບຫຍັງຢູ່. */
  category_require_isn: boolean;
};

/** ລາຍການຍົກເວັ້ນທັງໝົດ (ຈຳນວນນ້ອຍ — ບໍ່ຕ້ອງແບ່ງໜ້າ). */
export async function listIsnItemOverrides(): Promise<IsnItemRow[]> {
  return query<IsnItemRow>(
    `SELECT ov.item_code,
            i.name_1                                          AS item_name,
            NULLIF(TRIM(i.item_category), '')                 AS category,
            cg.name_1                                         AS category_name,
            ov.require_isn,
            ov.note,
            COALESCE(c.require_isn, false)                    AS category_require_isn
       FROM public.odg_wms_isn_item ov
       LEFT JOIN public.ic_inventory i  ON i.code = ov.item_code
       LEFT JOIN public.ic_category cg  ON cg.code = NULLIF(TRIM(i.item_category), '')
       LEFT JOIN public.odg_wms_isn_category c ON c.category_code = NULLIF(TRIM(i.item_category), '')
      ORDER BY ov.item_code`,
  );
}

export type IsnItemHit = {
  item_code: string;
  item_name: string | null;
  category: string | null;
  category_name: string | null;
  /** ຄຳຕອບປັດຈຸບັນ (ຫຼັງລວມໝວດ + ຍົກເວັ້ນ). */
  needs_isn: boolean;
  /** ມີ serial ຢູ່ໃນ sn_inventory ຈິງບໍ — ຊ່ວຍຕັດສິນ. */
  has_serial: boolean;
  is_override: boolean;
};

/** ຄົ້ນສິນຄ້າຕາມລະຫັດ/ຊື່ ເພື່ອເພີ່ມເປັນຍົກເວັ້ນ. */
export async function searchIsnItems(q: string, limit = 30): Promise<IsnItemHit[]> {
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return query<IsnItemHit>(
    `SELECT i.code                             AS item_code,
            i.name_1                           AS item_name,
            NULLIF(TRIM(i.item_category), '')  AS category,
            cg.name_1                          AS category_name,
            ${needsIsnSql("i")}                AS needs_isn,
            EXISTS (SELECT 1 FROM public.sn_inventory s WHERE s.item_code = i.code) AS has_serial,
            (ov.item_code IS NOT NULL)         AS is_override
       FROM public.ic_inventory i
       LEFT JOIN public.ic_category cg     ON cg.code = NULLIF(TRIM(i.item_category), '')
       LEFT JOIN public.odg_wms_isn_item ov ON ov.item_code = i.code
      WHERE i.code ILIKE $1 ESCAPE '\\' OR i.name_1 ILIKE $1 ESCAPE '\\'
      ORDER BY CASE WHEN i.code ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END, i.code
      LIMIT $2`,
    [like, limit],
  );
}

/** ເພີ່ມ/ແກ້ ຍົກເວັ້ນ 1 ລາຍການ. */
export async function upsertIsnItemOverride(
  itemCode: string,
  requireIsn: boolean,
  note: string | null,
  updatedBy: string | null,
): Promise<void> {
  await query(
    `INSERT INTO public.odg_wms_isn_item (item_code, require_isn, note, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (item_code) DO UPDATE
       SET require_isn = EXCLUDED.require_isn, note = EXCLUDED.note,
           updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [itemCode.trim(), requireIsn, note?.trim() || null, updatedBy],
  );
}

/** ລົບຍົກເວັ້ນ — ລາຍການນັ້ນກັບໄປໃຊ້ຄ່າຂອງໝວດ. */
export async function deleteIsnItemOverride(itemCode: string): Promise<void> {
  await query(`DELETE FROM public.odg_wms_isn_item WHERE item_code = $1`, [itemCode.trim()]);
}

// ──────────────────── ໝວດຂອງສິນຄ້າ (ic_inventory.item_category) ────────────────────

/**
 * ຕັ້ງໝວດໃຫ້ສິນຄ້າ — ຂຽນລົງ `ic_inventory.item_category` ໂດຍກົງ (ຂໍ້ມູນຫຼັກ ERP).
 * ຈຳເປັນເພາະໝວດຄື **prefix ຂອງເລກ ISN**: ລາຍການທີ່ໝວດຫວ່າງອອກ ISN ບໍ່ໄດ້ເລີຍ
 * (ເບິ່ງ writeCountSerials → serializedNoCategory). ຮັບສະເພາະລະຫັດທີ່ມີໃນ ic_category.
 */
export async function setItemCategory(itemCode: string, categoryCode: string): Promise<void> {
  const code = categoryCode.trim();
  const ok = await query<{ code: string }>(`SELECT code FROM public.ic_category WHERE code = $1`, [code]);
  if (ok.length === 0) throw new Error(`ບໍ່ພົບໝວດ ${code} ໃນ ic_category`);
  await query(`UPDATE public.ic_inventory SET item_category = $2 WHERE code = $1`, [itemCode.trim(), code]);
}

/** ສິນຄ້າທີ່ຕ້ອງເກັບ ISN ແຕ່ໝວດຫວ່າງ → ອອກ ISN ບໍ່ໄດ້. ໃຫ້ໜ້າຕັ້ງຄ່າເຕືອນ. */
export async function listIsnItemsMissingCategory(): Promise<
  { item_code: string; item_name: string | null; item_brand: string | null }[]
> {
  return query(
    `SELECT i.code AS item_code, i.name_1 AS item_name, i.item_brand
       FROM public.ic_inventory i
       JOIN public.odg_wms_isn_item ov ON ov.item_code = i.code AND ov.require_isn
      WHERE COALESCE(TRIM(i.item_category), '') = ''
      ORDER BY i.code`,
  );
}
