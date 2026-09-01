import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  DEFAULT_WAREHOUSE_KIND,
  type WarehouseKind,
  toWarehouseKind,
} from "@/lib/warehouseKind";

/** Minimal querier shape — the shared pool, or a transaction client. */
type Querier = Pick<PoolClient, "query">;

/** SN flags, one per menu/flow. Each controls whether that flow handles serials. */
export type SnFlag =
  | "receive"
  | "issue"
  | "issue_pick"
  | "transfer"
  | "pallet"
  | "adjust"
  | "return";

export type SnFlags = Record<SnFlag, boolean>;

/** Menu metadata for the settings UI — order + Lao labels. */
export const SN_MENUS: { key: SnFlag; label: string; hint: string }[] = [
  { key: "receive", label: "ຮັບເຂົ້າ", hint: "gen/ຕິດຕາມ SN ຕອນຮັບເຂົ້າ" },
  { key: "issue", label: "ຈ່າຍອອກ", hint: "ຕິດຕາມ/scan SN ຕອນຢືນຢັນຈ່າຍ" },
  { key: "issue_pick", label: "ຈ່າຍ: pick", hint: "ບັງຄັບເລືອກ SN ຕັ້ງແຕ່ຕອນສ້າງໃບ pick (ປິດ = ໄປຍິງຕອນຢືນຢັນ)" },
  { key: "transfer", label: "ໂອນ", hint: "ຍ້າຍ SN ຕອນຮັບໂອນ 124" },
  { key: "pallet", label: "ຍ້າຍ pallet", hint: "ຍ້າຍ SN ຕາມ pallet" },
  { key: "adjust", label: "ປັບປຸງ", hint: "add/remove/generate SN" },
  { key: "return", label: "ຮັບຄືນ", hint: "SN ຕອນຮັບຄືນຂາຍ" },
];

const FLAG_COLUMN: Record<SnFlag, string> = {
  receive: "sn_receive",
  issue: "sn_issue",
  issue_pick: "sn_issue_pick",
  transfer: "sn_transfer",
  pallet: "sn_pallet",
  adjust: "sn_adjust",
  return: "sn_return",
};

const DEFAULT_FLAGS: SnFlags = {
  receive: true,
  issue: true,
  issue_pick: true,
  transfer: true,
  pallet: true,
  adjust: true,
  return: true,
};

type FlagRow = {
  sn_receive: boolean;
  sn_issue: boolean;
  sn_issue_pick: boolean;
  sn_transfer: boolean;
  sn_pallet: boolean;
  sn_adjust: boolean;
  sn_return: boolean;
};

function rowToFlags(r: FlagRow | undefined): SnFlags {
  if (!r) return { ...DEFAULT_FLAGS };
  return {
    receive: r.sn_receive ?? true,
    issue: r.sn_issue ?? true,
    issue_pick: r.sn_issue_pick ?? true,
    transfer: r.sn_transfer ?? true,
    pallet: r.sn_pallet ?? true,
    adjust: r.sn_adjust ?? true,
    return: r.sn_return ?? true,
  };
}

const SELECT_FLAGS =
  "sn_receive, sn_issue, sn_issue_pick, sn_transfer, sn_pallet, sn_adjust, sn_return";

/**
 * All per-menu SN flags for a warehouse. Every flag defaults to TRUE when the
 * warehouse has no config row (or the config table is absent pre-migration),
 * so unconfigured warehouses keep the original SN behaviour.
 */
export async function warehouseSnFlags(
  whCode: string,
  client?: Querier,
): Promise<SnFlags> {
  const sql = `SELECT ${SELECT_FLAGS} FROM public.odg_wms_warehouse_config WHERE wh_code = $1`;
  try {
    const rows = client
      ? (await client.query<FlagRow>(sql, [whCode])).rows
      : await query<FlagRow>(sql, [whCode]);
    return rowToFlags(rows[0]);
  } catch {
    // config table / columns not present yet (pre-migration) — safe default
    return { ...DEFAULT_FLAGS };
  }
}

/**
 * One SN flag for many warehouses, keyed by wh_code. Codes with no config row
 * (or a missing table pre-migration) resolve to true.
 */
export async function warehouseSnFlagMap(
  whCodes: string[],
  flag: SnFlag,
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const code of whCodes) out[code] = true;
  if (whCodes.length === 0) return out;
  const col = FLAG_COLUMN[flag];
  try {
    const rows = await query<{ wh_code: string; on: boolean | null }>(
      `SELECT wh_code, ${col} AS on
       FROM public.odg_wms_warehouse_config
       WHERE wh_code = ANY($1)`,
      [whCodes],
    );
    for (const r of rows) out[r.wh_code] = r.on ?? true;
  } catch {
    // config table / columns not present yet (pre-migration) — safe default
  }
  return out;
}

/** Whether a single menu/flow handles serials for this warehouse (default true). */
export async function warehouseSnEnabled(
  whCode: string,
  flag: SnFlag,
  client?: Querier,
): Promise<boolean> {
  return (await warehouseSnFlags(whCode, client))[flag];
}

/**
 * @deprecated location-move compat: transfer & pallet moved to per-menu flags.
 * Kept so callers not yet migrated still resolve. Returns the pallet flag.
 */
export async function warehouseMovesSerials(
  whCode: string,
  client?: Querier,
): Promise<boolean> {
  return warehouseSnEnabled(whCode, "pallet", client);
}

/** Upsert one SN flag for a warehouse. */
export async function setWarehouseSnFlag(
  whCode: string,
  flag: SnFlag,
  value: boolean,
  updatedBy: string | null,
  client?: Querier,
): Promise<void> {
  const col = FLAG_COLUMN[flag];
  const sql = `
    INSERT INTO public.odg_wms_warehouse_config (wh_code, ${col}, updated_at, updated_by)
    VALUES ($1, $2, now(), $3)
    ON CONFLICT (wh_code)
    DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  if (client) await client.query(sql, [whCode, value, updatedBy]);
  else await query(sql, [whCode, value, updatedBy]);
}

/** Upsert one SN flag for many warehouses at once (one round-trip). */
export async function setManyWarehousesSnFlag(
  whCodes: string[],
  flag: SnFlag,
  value: boolean,
  updatedBy: string | null,
): Promise<number> {
  if (whCodes.length === 0) return 0;
  const col = FLAG_COLUMN[flag];
  await query(
    `INSERT INTO public.odg_wms_warehouse_config (wh_code, ${col}, updated_at, updated_by)
     SELECT unnest($1::text[]), $2, now(), $3
     ON CONFLICT (wh_code)
     DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [whCodes, value, updatedBy],
  );
  return whCodes.length;
}

export function isSnFlag(v: unknown): v is SnFlag {
  return typeof v === "string" && v in FLAG_COLUMN;
}

/** ສາງຫຼັກ/ຍ່ອຍ ຂອງສາງໜຶ່ງ — ຮູບແບບທີ່ໜ້າອື່ນເອົາໄປໃຊ້ຕໍ່ໄດ້. */
export type WarehouseTree = {
  kind: WarehouseKind;
  /** ສາງແມ່ທັງໝົດ — ຍ່ອຍໜຶ່ງຮັບໃຊ້ໄດ້ຫຼາຍສາງຫຼັກ (migration 042). */
  parent_codes: string[];
};

const DEFAULT_TREE: WarehouseTree = { kind: DEFAULT_WAREHOUSE_KIND, parent_codes: [] };

/**
 * ສາງຫຼັກ/ຍ່ອຍ + ສາງແມ່ ຂອງຫຼາຍສາງ keyed ດ້ວຍລະຫັດສາງ.
 *
 * ສາງທີ່ບໍ່ມີແຖວ config (ຫຼື ຍັງບໍ່ໄດ້ run migration 041/042) ຄືນເປັນ "ສາງຫຼັກ
 * ບໍ່ມີແມ່" — ຄືສະພາບກ່ອນມີຄຸນສົມບັດນີ້ ຈຶ່ງບໍ່ມີໜ້າໃດພັງລະຫວ່າງ deploy.
 */
export async function warehouseTreeMap(
  whCodes: string[],
): Promise<Record<string, WarehouseTree>> {
  const out: Record<string, WarehouseTree> = {};
  for (const code of whCodes) out[code] = { ...DEFAULT_TREE, parent_codes: [] };
  if (whCodes.length === 0) return out;
  try {
    const rows = await query<{ wh_code: string; wh_kind: string | null }>(
      `SELECT wh_code, wh_kind
       FROM public.odg_wms_warehouse_config
       WHERE wh_code = ANY($1)`,
      [whCodes],
    );
    for (const r of rows) {
      const t = out[r.wh_code];
      if (t) t.kind = toWarehouseKind(r.wh_kind);
    }
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 041 — ໃຊ້ຄ່າເລີ່ມຕົ້ນ
  }
  try {
    const links = await query<{ wh_code: string; parent_code: string }>(
      `SELECT wh_code, parent_code
       FROM public.odg_wms_warehouse_parent
       WHERE wh_code = ANY($1)
       ORDER BY parent_code`,
      [whCodes],
    );
    for (const l of links) out[l.wh_code]?.parent_codes.push(l.parent_code);
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 042
  }
  // ສາງຫຼັກມີແມ່ບໍ່ໄດ້ — ລ້າງໃຫ້ ເຜື່ອຂໍ້ມູນເກົ່າຄ້າງໄວ້
  for (const t of Object.values(out)) if (t.kind === "main") t.parent_codes = [];
  return out;
}

/**
 * ຕັ້ງສາງຫຼັກ/ຍ່ອຍ ແລະ **ລາຍການສາງແມ່ທັງໝົດ** ຂອງສາງໜຶ່ງ (ແທນທີ່ຂອງເກົ່າ).
 *
 * ຂຽນ `parent_code` ເກົ່າເປັນ NULL ສະເໝີ — ຄໍລຳນັ້ນເລີກໃຊ້ຕັ້ງແຕ່ 042 ແລ້ວ
 * ການປະໄວ້ໃຫ້ມີຄ່າ ຈະກາຍເປັນແຫຼ່ງຄວາມຈິງທີ່ສອງທີ່ຂັດກັບຕາຕະລາງເຊື່ອມ.
 */
export async function setWarehouseKind(
  whCode: string,
  kind: WarehouseKind,
  parents: string[],
  updatedBy: string | null,
): Promise<void> {
  const list = kind === "sub" ? [...new Set(parents.filter((c) => c && c !== whCode))] : [];
  await query(
    `INSERT INTO public.odg_wms_warehouse_config (wh_code, wh_kind, parent_code, updated_at, updated_by)
     VALUES ($1, $2, NULL, now(), $3)
     ON CONFLICT (wh_code)
     DO UPDATE SET wh_kind = EXCLUDED.wh_kind,
                   parent_code = NULL,
                   updated_at = now(),
                   updated_by = EXCLUDED.updated_by`,
    [whCode, kind, updatedBy],
  );
  try {
    // ແທນທີ່ທັງຊຸດ — ງ່າຍກວ່າ ແລະ ບໍ່ປະແມ່ເກົ່າຄ້າງ ເມື່ອຄົນຖອດອອກຈາກຟອມ
    await query(`DELETE FROM public.odg_wms_warehouse_parent WHERE wh_code = $1`, [whCode]);
    if (list.length > 0) {
      await query(
        `INSERT INTO public.odg_wms_warehouse_parent (wh_code, parent_code, updated_by)
         SELECT $1, unnest($2::text[]), $3
         ON CONFLICT DO NOTHING`,
        [whCode, list, updatedBy],
      );
    }
  } catch (err) {
    // ຕາຕະລາງບໍ່ມີ = ຍັງບໍ່ໄດ້ run 042. ບອກໃຫ້ຊັດ ດີກວ່າປ່ອຍເປັນ 500 ລອຍໆ
    // ຫຼື ກືນມັນແລ້ວໃຫ້ຄົນນຶກວ່າບັນທຶກສຳເລັດທັງທີ່ແມ່ຫາຍໝົດ.
    if ((err as { code?: string }).code === "42P01") {
      throw new Error("ຍັງບໍ່ໄດ້ run migration 042 — ຕາຕະລາງສາງແມ່ຍັງບໍ່ມີໃນ DB");
    }
    throw err;
  }
}

/**
 * ຕັດສາງຍ່ອຍທຸກສາງອອກຈາກແມ່ທີ່ຖືກລຶບ.
 *
 * ຍ່ອຍທີ່ຍັງເຫຼືອແມ່ອື່ນ ຍັງເປັນຍ່ອຍຄືເກົ່າ — ມີແຕ່ຜູ້ທີ່ໝົດແມ່ແທ້ໆຈຶ່ງກັບໄປ
 * ເປັນ "ສາງຫຼັກ" ບໍ່ດັ່ງນັ້ນຈະເປັນຍ່ອຍທີ່ບໍ່ຂຶ້ນກັບໃຜ ຊຶ່ງບໍ່ມີຄວາມໝາຍ.
 */
export async function detachChildWarehouses(parentCode: string): Promise<number> {
  try {
    const rows = await query<{ wh_code: string }>(
      `DELETE FROM public.odg_wms_warehouse_parent
        WHERE parent_code = $1
        RETURNING wh_code`,
      [parentCode],
    );
    if (rows.length > 0) {
      await query(
        `UPDATE public.odg_wms_warehouse_config c
            SET wh_kind = 'main', updated_at = now()
          WHERE c.wh_code = ANY($1)
            AND NOT EXISTS (
              SELECT 1 FROM public.odg_wms_warehouse_parent p WHERE p.wh_code = c.wh_code
            )`,
        [rows.map((r) => r.wh_code)],
      );
    }
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * ກວດຄວາມສົມເຫດສົມຜົນຂອງ ສາງຫຼັກ/ຍ່ອຍ ກ່ອນບັນທຶກ — ຄືນຂໍ້ຄວາມຜິດພາດ (ພາສາລາວ)
 * ຫຼື null ຖ້າຜ່ານ.
 *
 * ຈຳກັດໃຫ້ເລິກພຽງ **ຊັ້ນດຽວ**: ຍ່ອຍຂອງຍ່ອຍ ຈະເຮັດໃຫ້ທຸກໜ້າທີ່ລວມຍອດ "ສາງຫຼັກ
 * + ຍ່ອຍ" ຕ້ອງໄລ່ຕົ້ນໄມ້ແບບ recursive ໂດຍບໍ່ມີໃຜຮ້ອງຂໍ.
 */
export async function warehouseKindError(
  whCode: string,
  kind: WarehouseKind,
  parents: string[],
): Promise<string | null> {
  if (kind === "main") return null;

  const list = [...new Set(parents.filter(Boolean))];
  if (list.length === 0) return "ສາງຍ່ອຍ ຕ້ອງເລືອກສາງແມ່ຢ່າງໜ້ອຍ 1 ສາງ";
  if (list.includes(whCode)) return "ສາງເປັນແມ່ຂອງຕົນເອງບໍ່ໄດ້";

  const found = await query<{ code: string }>(
    `SELECT code FROM public.ic_warehouse WHERE code = ANY($1)`,
    [list],
  );
  const known = new Set(found.map((r) => r.code));
  const missing = list.filter((c) => !known.has(c));
  if (missing.length > 0) return `ບໍ່ພົບສາງແມ່ ${missing.join(", ")}`;

  try {
    const subs = await query<{ wh_code: string }>(
      `SELECT wh_code FROM public.odg_wms_warehouse_config
        WHERE wh_code = ANY($1) AND wh_kind = 'sub'`,
      [list],
    );
    if (subs.length > 0) {
      return `${subs.map((r) => r.wh_code).join(", ")} ເປັນສາງຍ່ອຍຢູ່ແລ້ວ — ສາງແມ່ຕ້ອງເປັນສາງຫຼັກ`;
    }

    const children = await query<{ wh_code: string }>(
      `SELECT wh_code FROM public.odg_wms_warehouse_parent WHERE parent_code = $1`,
      [whCode],
    );
    if (children.length > 0) {
      return `ສາງນີ້ມີສາງຍ່ອຍ ${children.length} ສາງຢູ່ແລ້ວ — ປ່ຽນເປັນສາງຍ່ອຍບໍ່ໄດ້`;
    }
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 041/042 — ປ່ອຍໃຫ້ຜ່ານ ແລ້ວໃຫ້ການບັນທຶກລົ້ມເອງ
  }
  return null;
}

/* ── ວັນທີເລີ່ມໃຊ້ WMS ຕໍ່ສາງ (migration 043) ─────────────────────────── */

/**
 * ວັນທີທີ່ສາງນີ້ເລີ່ມຈ່າຍຜ່ານ WMS (YYYY-MM-DD) ຫຼື null ເມື່ອບໍ່ຈຳກັດ.
 *
 * ການເປີດໃຊ້ WMS ເປັນການທະຍອຍເປີດເປັນສາງໆ. ສາງທີ່ຫາກໍ່ເປີດຈະມີບິນຄ້າງເກົ່າ
 * ຢູ່ ERP ທີ່ຈັດການໄປແລ້ວນອກລະບົບ — ຖ້າເອົາມາສະແດງນຳ ລາຍການຄ້າງຈ່າຍຈະເຕັມ
 * ໄປດ້ວຍບິນທີ່ບໍ່ຕ້ອງເຮັດຫຍັງ ຈົນຫາບິນຈິງບໍ່ພົບ.
 */
export async function warehouseStartDate(whCode: string): Promise<string | null> {
  try {
    const rows = await query<{ d: string | null }>(
      `SELECT to_char(wms_start_date, 'YYYY-MM-DD') AS d
         FROM public.odg_wms_warehouse_config WHERE wh_code = $1`,
      [whCode],
    );
    return rows[0]?.d ?? null;
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 043 — ຖືວ່າບໍ່ຈຳກັດ (ພຶດຕິກຳເກົ່າ)
    return null;
  }
}

/** ວັນທີເລີ່ມໃຊ້ຂອງທຸກສາງທີ່ຕັ້ງໄວ້ — ສາງທີ່ບໍ່ໄດ້ຕັ້ງຈະບໍ່ຢູ່ໃນ map. */
export async function warehouseStartDateMap(): Promise<Map<string, string>> {
  try {
    const rows = await query<{ wh_code: string; d: string }>(
      `SELECT wh_code, to_char(wms_start_date, 'YYYY-MM-DD') AS d
         FROM public.odg_wms_warehouse_config WHERE wms_start_date IS NOT NULL`,
    );
    return new Map(rows.map((r) => [r.wh_code, r.d]));
  } catch {
    return new Map();
  }
}

/** ຕັ້ງ/ລ້າງວັນທີເລີ່ມໃຊ້. ສົ່ງ null ເພື່ອລ້າງ (ກັບໄປບໍ່ຈຳກັດ). */
export async function setWarehouseStartDate(
  whCode: string,
  date: string | null,
  updatedBy: string | null,
): Promise<void> {
  await query(
    `INSERT INTO public.odg_wms_warehouse_config (wh_code, wms_start_date, updated_at, updated_by)
     VALUES ($1, $2::date, now(), $3)
     ON CONFLICT (wh_code) DO UPDATE SET
       wms_start_date = EXCLUDED.wms_start_date,
       updated_at     = now(),
       updated_by     = EXCLUDED.updated_by`,
    [whCode, date, updatedBy],
  );
}
