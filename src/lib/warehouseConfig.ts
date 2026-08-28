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
export type WarehouseTree = { kind: WarehouseKind; parent_code: string | null };

const DEFAULT_TREE: WarehouseTree = { kind: DEFAULT_WAREHOUSE_KIND, parent_code: null };

/**
 * ສາງຫຼັກ/ຍ່ອຍ ຂອງຫຼາຍສາງ keyed ດ້ວຍລະຫັດສາງ.
 *
 * ສາງທີ່ບໍ່ມີແຖວ config (ຫຼື ຍັງບໍ່ໄດ້ run migration 041) ຄືນເປັນ "ສາງຫຼັກ
 * ບໍ່ມີແມ່" — ຄືສະພາບກ່ອນມີຄຸນສົມບັດນີ້ ຈຶ່ງບໍ່ມີໜ້າໃດພັງລະຫວ່າງ deploy.
 */
export async function warehouseTreeMap(
  whCodes: string[],
): Promise<Record<string, WarehouseTree>> {
  const out: Record<string, WarehouseTree> = {};
  for (const code of whCodes) out[code] = { ...DEFAULT_TREE };
  if (whCodes.length === 0) return out;
  try {
    const rows = await query<{ wh_code: string; wh_kind: string | null; parent_code: string | null }>(
      `SELECT wh_code, wh_kind, parent_code
       FROM public.odg_wms_warehouse_config
       WHERE wh_code = ANY($1)`,
      [whCodes],
    );
    for (const r of rows) {
      const kind = toWarehouseKind(r.wh_kind);
      out[r.wh_code] = { kind, parent_code: kind === "sub" ? r.parent_code : null };
    }
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 041 — ໃຊ້ຄ່າເລີ່ມຕົ້ນ
  }
  return out;
}

/**
 * ຕັ້ງສາງຫຼັກ/ຍ່ອຍ ຂອງສາງໜຶ່ງ.
 *
 * `parent` ຖືກລ້າງເປັນ null ສະເໝີເມື່ອ kind = main — ບໍ່ດັ່ງນັ້ນສາງທີ່ຖືກ
 * ຍົກຂຶ້ນເປັນຫຼັກຈະຍັງແບກລະຫັດແມ່ເກົ່າໄວ້ ແລະ CHECK ຢູ່ DB ຈະປະຕິເສດ.
 */
export async function setWarehouseKind(
  whCode: string,
  kind: WarehouseKind,
  parent: string | null,
  updatedBy: string | null,
  client?: Querier,
): Promise<void> {
  const parentCode = kind === "sub" ? parent : null;
  const sql = `
    INSERT INTO public.odg_wms_warehouse_config (wh_code, wh_kind, parent_code, updated_at, updated_by)
    VALUES ($1, $2, $3, now(), $4)
    ON CONFLICT (wh_code)
    DO UPDATE SET wh_kind = EXCLUDED.wh_kind,
                  parent_code = EXCLUDED.parent_code,
                  updated_at = now(),
                  updated_by = EXCLUDED.updated_by`;
  if (client) await client.query(sql, [whCode, kind, parentCode, updatedBy]);
  else await query(sql, [whCode, kind, parentCode, updatedBy]);
}

/**
 * ຕັດສາງຍ່ອຍທຸກສາງອອກຈາກແມ່ທີ່ຖືກລຶບ — ກັບໄປເປັນ "ສາງຫຼັກ".
 *
 * ປະໄວ້ຊື່ໆບໍ່ໄດ້: parent_code ຈະຊີ້ໄປສາງທີ່ບໍ່ມີແລ້ວ ແລະ ໜ້າຈັດການສາງຈະ
 * ສະແດງແມ່ເປັນລະຫັດເປົ່າໆທີ່ບໍ່ມີໃຜແກ້ໄດ້.
 */
export async function detachChildWarehouses(parentCode: string): Promise<number> {
  try {
    const rows = await query<{ wh_code: string }>(
      `UPDATE public.odg_wms_warehouse_config
          SET wh_kind = 'main', parent_code = NULL, updated_at = now()
        WHERE parent_code = $1
        RETURNING wh_code`,
      [parentCode],
    );
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
  parent: string | null,
): Promise<string | null> {
  if (kind === "main") return null;

  if (!parent) return "ສາງຍ່ອຍ ຕ້ອງລະບຸສາງແມ່";
  if (parent === whCode) return "ສາງເປັນແມ່ຂອງຕົນເອງບໍ່ໄດ້";

  const exists = await query<{ code: string }>(
    `SELECT code FROM public.ic_warehouse WHERE code = $1`,
    [parent],
  );
  if (exists.length === 0) return `ບໍ່ພົບສາງແມ່ ${parent}`;

  try {
    const parentRow = await query<{ wh_kind: string | null }>(
      `SELECT wh_kind FROM public.odg_wms_warehouse_config WHERE wh_code = $1`,
      [parent],
    );
    if (toWarehouseKind(parentRow[0]?.wh_kind) === "sub") {
      return `${parent} ເປັນສາງຍ່ອຍຢູ່ແລ້ວ — ສາງແມ່ຕ້ອງເປັນສາງຫຼັກ`;
    }

    const children = await query<{ wh_code: string }>(
      `SELECT wh_code FROM public.odg_wms_warehouse_config WHERE parent_code = $1`,
      [whCode],
    );
    if (children.length > 0) {
      return `ສາງນີ້ມີສາງຍ່ອຍ ${children.length} ສາງຢູ່ແລ້ວ — ປ່ຽນເປັນສາງຍ່ອຍບໍ່ໄດ້`;
    }
  } catch {
    // ຍັງບໍ່ໄດ້ run migration 041 — ປ່ອຍໃຫ້ຜ່ານ ແລ້ວໃຫ້ການບັນທຶກລົ້ມເອງ
  }
  return null;
}
