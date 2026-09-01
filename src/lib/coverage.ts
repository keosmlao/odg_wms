/**
 * ວິເຄາະຄວາມພຽງພໍຂອງສິນຄ້າຕໍ່ການຂາຍ (stock coverage / days-of-cover).
 *
 * ຄຳຖາມທີ່ໜ້ານີ້ຕອບ: **ຂອງທີ່ຈັດເກັບຢູ່ໃນສາງ ພຽງພໍສຳລັບການຂາຍບໍ?**
 * ຄຳຕອບຄິດຕໍ່ (ສາງ × ສິນຄ້າ) ດ້ວຍສູດດຽວ:
 *
 *     ຂາຍສະເລ່ຍ/ມື້ = (ຂາຍສຸດທິໃນຊ່ວງ) ÷ ຈຳນວນມື້ຂອງຊ່ວງ
 *     ວັນທີ່ພໍໃຊ້    = ຄົງເຫຼືອ ÷ ຂາຍສະເລ່ຍ/ມື້
 *
 * ── ແຫຼ່ງຂໍ້ມູນ 2 ຂາ ແລະ ເຫດຜົນທີ່ເລືອກ ──────────────────────────────────
 *
 * ຄົງເຫຼືອ (ຕົວຕັ້ງ) ມາຈາກ **ຄົງເຫຼືອ ERP** ບໍ່ແມ່ນ `odg_wms_trans_detail`.
 * ເຫດຜົນ: ການຂາຍ (ບິນ 44) ເປັນເຫດການຝັ່ງ ERP — ຖ້າເອົາຄົງເຫຼືອ WMS ມາທຽບກັບ
 * ຍອດຂາຍ ERP ຈະເປັນການທຽບຄົນລະຊຸດຂໍ້ມູນ. ວັດແທ້ໃນຖານຂໍ້ມູນນີ້ (2026-08):
 * ສາງ 1302/1304 ສອງຂາກົງກັນເກືອບ 100% ແຕ່ ສາງ 1203 ແລະ 1301 ຄົງເຫຼືອ WMS
 * ສູງກວ່າ ERP ຫຼາຍເທົ່າ ເພາະບິນຂາຍຂອງສອງສາງນັ້ນບໍ່ໄດ້ຜ່ານ WMS (doc_ref ຂອງ
 * ແຖວຂາອອກໃນ WMS ເປັນ FT…/WPOH… ຄືໃບໂອນ/ໃບເບີກ ບໍ່ແມ່ນເລກບິນຂາຍ).
 *
 * ບໍ່ອ່ານຜ່ານ view `stock_balance` ເພາະ view ນັ້ນເອີ້ນຟັງຊັນຄິດຄົງເຫຼືອ **ທຸກສາງ**
 * ກ່ອນຈຶ່ງຄ່ອຍກອງ (19 ວິນາທີ). ເອີ້ນ `sml_ic_function_stock_balance_warehouse`
 * ໂດຍກົງເປັນສາງລະຄຳຮ້ອງ ໄດ້ຜົນລວມຄືກັນເປັ໊ະ ແຕ່ເຫຼືອ 0.4–6 ວິນາທີ/ສາງ.
 *
 * ຈຶ່ງຄືນ **ທັງສອງຄ່າ** ສະເໝີ (`on_hand` = ERP, `wms_on_hand` = WMS) ແລະ ໃຫ້
 * `WarehouseSummary.sync_gap` ເພື່ອໃຫ້ຜູ້ໃຊ້ເຫັນວ່າສາງໃດເຊື່ອຖືໄດ້ພຽງໃດ —
 * ຕົວເລກທີ່ຜິດແບບງຽບໆ ອັນຕະລາຍກວ່າຕົວເລກທີ່ບອກວ່າມັນບໍ່ກົງ.
 *
 * ຄວາມຕ້ອງການ (ຕົວຫານ) = ບິນຂາຍ `trans_flag` 44 ຫັກ ໃບຮັບຄືນ CN 48 ໂດຍໃຊ້
 * ກົດຕັດໃບຕາຍ/ບໍລິການ ຊຸດດຽວກັນກັບ `pendingOut` — ບໍ່ນັບ ໃບເບີກ 122 ຫຼື ໃບໂອນ
 * 124 ເພາະນັ້ນຄືການຍ້າຍພາຍໃນກຸ່ມ ບໍ່ແມ່ນ "ການຂາຍ".
 */
import { query } from "@/lib/db";
import { DEAD_DOC_RE, RETURN_DOC_FLAG } from "@/lib/pendingOut";
import { classifyAbc, classifyFsn, type AbcClass, type FsnClass } from "@/lib/classify";

/** ບິນຂາຍ — ຄວາມຕ້ອງການທີ່ແທ້ຈິງຂອງລູກຄ້າ. */
const SALE_FLAG = 44;

export type CoverageStatus =
  /** ຂາຍຢູ່ ແຕ່ຄົງເຫຼືອໝົດ — ເສຍໂອກາດຂາຍທັນທີ. */
  | "out"
  /** ພໍໃຊ້ບໍ່ເຖິງ `critical` ວັນ. */
  | "critical"
  /** ພໍໃຊ້ບໍ່ເຖິງ `low` ວັນ. */
  | "low"
  /** ພຽງພໍ. */
  | "ok"
  /** ພໍໃຊ້ເກີນ `over` ວັນ — ເງິນຈົມ. */
  | "over"
  /** ມີຂອງ ແຕ່ບໍ່ມີການຂາຍເລີຍໃນຊ່ວງ — ສິນຄ້າຄ້າງ. */
  | "idle"
  /** ຄົງເຫຼືອຕິດລົບ — ຂໍ້ມູນຜິດ ຕ້ອງກວດ. */
  | "negative";

export const STATUS_LABEL_LO: Record<CoverageStatus, string> = {
  out: "ໝົດ",
  critical: "ວິກິດ",
  low: "ສ່ຽງ",
  ok: "ພຽງພໍ",
  over: "ເກີນ",
  idle: "ບໍ່ເຄື່ອນໄຫວ",
  negative: "ຕິດລົບ",
};

/**
 * ຮູບແບບຄວາມຕ້ອງການ — ສຳຄັນກວ່າທີ່ຄິດ.
 *
 * ວັດແທ້ໃນຖານຂໍ້ມູນນີ້ (5 ສາງ, 90 ມື້): ມີພຽງ **8%** ຂອງສິນຄ້າທີ່ຂາຍເກີນ 20 ມື້
 * ສ່ວນ 35% ຂາຍພຽງ **ມື້ດຽວ** ໃນ 90 ມື້. ການເອົາ "ຂາຍ 90 ມື້ ÷ 90" ມາເປັນ
 * ຂາຍຕໍ່ມື້ ຈຶ່ງຫຼອກຕາສຳລັບສິນຄ້າສ່ວນໃຫຍ່ — ເລກ "ວັນທີ່ພໍໃຊ້" ຈະເບິ່ງຄືກັນໝົດ
 * ທັງທີ່ອັນໜຶ່ງຂາຍທຸກມື້ ອີກອັນຂາຍລ໋ອດດຽວແລ້ວງຽບ.
 *
 * ຈຶ່ງຈຳແນກໄວ້ໃຫ້ຜູ້ໃຊ້ເຫັນ ແລະ ກອງອອກໄດ້ ແທນທີ່ຈະລວມໝົດເປັນເລກດຽວ.
 */
export type DemandPattern =
  /** ຂາຍສະໝ່ຳສະເໝີ — ຄ່າສະເລ່ຍຕໍ່ມື້ເຊື່ອຖືໄດ້. */
  | "steady"
  /** ຂາຍຂາດໆ — ຄ່າສະເລ່ຍໃຊ້ໄດ້ຢ່າງລະມັດລະວັງ. */
  | "intermittent"
  /** ຂາຍເທື່ອດຽວໃນຊ່ວງ — ຢ່າໃຊ້ຄ່າສະເລ່ຍວາງແຜນ. */
  | "single"
  | "none";

/** ແນວໂນ້ມ: ຊ່ວງຫຼ້າສຸດ ທຽບ ຊ່ວງກ່ອນໜ້າ. */
export type DemandTrend = "rising" | "flat" | "falling" | "stopped" | "none";

/** ການຈັດກຸ່ມ ABC ຕາມມູນຄ່າຂາຍ (ພາຍໃນຂອບເຂດທີ່ວິເຄາະ). */
export type { AbcClass, FsnClass } from "@/lib/classify";

/**
 * FSN — ຈັດຕາມ **ຄວາມຖີ່ການເຄື່ອນໄຫວ** ບໍ່ແມ່ນມູນຄ່າ (ນັ້ນຄື ABC).
 *
 *   F (Fast)        ເຄື່ອນໄຫວໄວ — ຢູ່ໃນກຸ່ມທີ່ລວມກັນເປັນ 70% ທຳອິດຂອງຈຳນວນບິນ
 *   S (Slow)        ເຄື່ອນໄຫວຊ້າ — ຂາຍຢູ່ ແຕ່ຖີ່ໜ້ອຍ
 *   N (Non-moving)  ບໍ່ເຄື່ອນໄຫວເລີຍໃນຊ່ວງ — ນີ້ຄືເງິນຈົມແທ້
 *
 * ໃຊ້ **ຈຳນວນບິນ** ເປັນຕົວວັດຄວາມຖີ່ (ບໍ່ແມ່ນຈຳນວນຫົວໜ່ວຍ) ເພາະ FSN ຖາມວ່າ
 * "ຖືກຢິບເລື້ອຍປານໃດ" ບໍ່ແມ່ນ "ອອກໄປຫຼາຍປານໃດ" — ຂາຍລ໋ອດໃຫຍ່ເທື່ອດຽວ ບໍ່ຄວນ
 * ນັບເປັນເຄື່ອນໄຫວໄວ. ຄູ່ກັບ ABC ແລ້ວໃຊ້ຕັດສິນໃຈໄດ້ໄວ:
 *
 *   A-F ສຳຄັນ+ໄວ → ຢ່າໃຫ້ຂາດ, ວາງໃກ້ບ່ອນຈ່າຍ    C-N ບໍ່ສຳຄັນ+ບໍ່ຍ້າຍ → ພິຈາລະນາລ້າງ
 */

export const FSN_LABEL_LO: Record<FsnClass, string> = {
  F: "ໄວ",
  S: "ຊ້າ",
  N: "ບໍ່ເຄື່ອນໄຫວ",
};

export const PATTERN_LABEL_LO: Record<DemandPattern, string> = {
  steady: "ສະໝ່ຳສະເໝີ",
  intermittent: "ຂາດໆ",
  single: "ຂາຍເທື່ອດຽວ",
  none: "ບໍ່ຂາຍ",
};

export const TREND_LABEL_LO: Record<DemandTrend, string> = {
  rising: "ຂາຍດີຂຶ້ນ",
  flat: "ຄົງທີ່",
  falling: "ຫຼຸດລົງ",
  stopped: "ເຊົາຂາຍ",
  none: "ບໍ່ຂາຍ",
};

/** ຂີດແບ່ງເປັນ "ວັນທີ່ພໍໃຊ້" — ປັບໄດ້ຈາກໜ້າຈໍ. */
export type Thresholds = { critical: number; low: number; over: number };
export const DEFAULT_THRESHOLDS: Thresholds = { critical: 7, low: 14, over: 60 };

/** ຂອງລາຍການໜຶ່ງ ນອນຢູ່ສາງໃດແດ່ — ມີສະເພາະຕອນວິເຄາະລວມກຸ່ມ. */
export type WarehouseSplit = {
  wh_code: string;
  on_hand: number;
  sold: number;
  avg_daily: number;
};

export type CoverageItem = {
  /** ຕອນລວມກຸ່ມ ຄ່ານີ້ຄືລະຫັດສາງທັງໝົດຕໍ່ກັນ ເຊັ່ນ `1301+1302+1303+1304`. */
  wh_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_name: string | null;
  /** ໝວດຍ່ອຍ (ic_group_sub). */
  group_sub_name: string | null;
  /** ໝວດຍ່ອຍຊັ້ນ 2 (group_sub2) — ຊື່ຈາກ ic_category ຫຼື ລະຫັດດິບ. */
  group_sub2_name: string | null;
  brand_name: string | null;
  /** ຄົງເຫຼືອ ERP (`stock_balance`) — ຕົວຕັ້ງຂອງການວິເຄາະ. */
  on_hand: number;
  /** ຄົງເຫຼືອຕາມບັນຊີ WMS — ໄວ້ທຽບຄວາມສອດຄ່ອງ. */
  wms_on_hand: number;
  /** ຄົງເຫຼືອ WMS ລົບ ERP (ບວກ = WMS ຫຼາຍກວ່າ). */
  sync_gap: number;
  /** ຂາຍສຸດທິໃນຊ່ວງ (ບິນຂາຍ ຫັກ ຮັບຄືນ). */
  sold: number;
  /** ຈຳນວນບິນທີ່ຂາຍສິນຄ້ານີ້. */
  bills: number;
  /** ຈຳນວນມື້ທີ່ມີການຂາຍ — ຂາຍທຸກມື້ ຫຼື ຂາຍລ໋ອດດຽວ ຕ່າງກັນຫຼາຍ. */
  sale_days: number;
  last_sale: string | null;
  avg_daily: number;
  /** ວັນທີ່ພໍໃຊ້ — `null` ໝາຍວ່າບໍ່ມີການຂາຍ ຈຶ່ງຄິດບໍ່ໄດ້. */
  days_cover: number | null;
  status: CoverageStatus;
  /** ຂາດອີກເທົ່າໃດຈຶ່ງພໍໃຊ້ເຖິງຂີດ `low` ວັນ (0 ເມື່ອບໍ່ຂາດ). */
  shortfall: number;
  /** ຈຳນວນທີ່ເກີນຂີດ `over` ວັນ (0 ເມື່ອບໍ່ເກີນ). */
  excess: number;
  /** ຕົ້ນທຶນສະເລ່ຍ/ໜ່ວຍ ຈາກ ERP — ໃຊ້ຕີມູນຄ່າ ຂາດ/ເກີນ. */
  avg_cost: number;
  /** ຕົ້ນທຶນນັ້ນມາຈາກແຫຼ່ງໃດ — ບອກໄວ້ ເພື່ອບໍ່ໃຫ້ເຂົ້າໃຈຜິດ. */
  cost_source: CostSource;
  /** ວັນທີ່ຊື້ຄັ້ງລ້າສຸດ — ມີເມື່ອຕົ້ນທຶນມາຈາກລາຄາຊື້. */
  last_buy_date: string | null;
  /** ມູນຄ່າຄົງເຫຼືອ (ERP). */
  stock_value: number;
  /** ຢູ່ສາງໃດແດ່ — ມີສະເພາະຕອນວິເຄາະລວມກຸ່ມ (`loadCoverageGroup`). */
  by_wh?: WarehouseSplit[];

  // ── ຮູບແບບ / ແນວໂນ້ມ / ABC ─────────────────────────────────────────
  /** ຂາຍໃນຊ່ວງຫຼ້າສຸດ (`recent_days` ມື້ສຸດທ້າຍ). */
  recent_qty: number;
  /** ຂາຍໃນຊ່ວງກ່ອນໜ້ານັ້ນ. */
  prior_qty: number;
  /** ຂາຍຕໍ່ມື້ ຄິດຈາກຊ່ວງຫຼ້າສຸດເທົ່ານັ້ນ — ສະທ້ອນປັດຈຸບັນດີກວ່າ. */
  recent_avg_daily: number;
  pattern: DemandPattern;
  trend: DemandTrend;
  /** ມູນຄ່າຂາຍໃນຊ່ວງ — ຖານຂອງ ABC. */
  sale_amount: number;
  abc: AbcClass;
  /** ຫົວໜ່ວຍໃຫຍ່ (ຫີບ/ມັດ/ຖົງ) — ໃຊ້ປັດຈຳນວນຕອນຂໍໂອນ. `null` = ບໍ່ໄດ້ຕັ້ງ. */
  pack: PackUnit | null;
  /** FSN — ຄວາມຖີ່ການເຄື່ອນໄຫວ (ຄິດຈາກຈຳນວນບິນ). */
  fsn: FsnClass;
  /** ບໍ່ໄດ້ຂາຍມາແລ້ວກີ່ມື້ — `null` ເມື່ອບໍ່ເຄີຍຂາຍເລີຍໃນຊ່ວງ. */
  days_since_sale: number | null;
};

export type WarehouseSummary = {
  wh_code: string;
  wh_name: string | null;
  /** ສິນຄ້າທັງໝົດທີ່ມີຄົງເຫຼືອ ຫຼື ມີການຂາຍ. */
  items: number;
  /** ສິນຄ້າທີ່ມີການຂາຍໃນຊ່ວງ — ຕົວຫານຂອງ `service_rate`. */
  selling_items: number;
  counts: Record<CoverageStatus, number>;
  sold_total: number;
  on_hand_total: number;
  wms_on_hand_total: number;
  /** ຜົນລວມ WMS ລົບ ERP — ໃຫຍ່ = ບັນຊີສອງຂາບໍ່ກົງກັນ ຢ່າເຊື່ອຕົວເລກໜ້ານີ້ຫຼາຍ. */
  sync_gap: number;
  /** |sync_gap| ÷ ຄົງເຫຼືອ ERP (0–1+). */
  sync_gap_ratio: number;
  /** ສິນຄ້າຂາຍຢູ່ ທີ່ພໍໃຊ້ຢ່າງໜ້ອຍ `critical` ວັນ ÷ ສິນຄ້າຂາຍຢູ່ທັງໝົດ (0–1). */
  service_rate: number;
  /** ມູນຄ່າທີ່ຕ້ອງເຕີມເພື່ອໃຫ້ທຸກລາຍການພໍໃຊ້ເຖິງຂີດ `low`. */
  shortfall_value: number;
  /** ມູນຄ່າຂອງທີ່ເກີນຂີດ `over` — ເງິນຈົມ. */
  excess_value: number;
};

export type CoverageResult = {
  days: number;
  thresholds: Thresholds;
  /** `null` ເມື່ອສາງນັ້ນບໍ່ມີທັງຄົງເຫຼືອ ແລະ ບໍ່ມີການຂາຍເລີຍ. */
  warehouse: WarehouseSummary | null;
  items: CoverageItem[];
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
};

const EMPTY_COUNTS = (): Record<CoverageStatus, number> => ({
  out: 0, critical: 0, low: 0, ok: 0, over: 0, idle: 0, negative: 0,
});

type ErpRow = {
  wh_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_name: string | null;
  group_sub_name: string | null;
  group_sub2_name: string | null;
  brand_name: string | null;
  on_hand: string | null;
  avg_cost: string | null;
};

type SaleRow = {
  wh_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  sold: string | null;
  bills: number | null;
  sale_days: number | null;
  last_sale: string | null;
  recent_qty: string | null;
  prior_qty: string | null;
  sale_amount: string | null;
  master_cost: string | null;
  group_name: string | null;
  group_sub_name: string | null;
  group_sub2_name: string | null;
  brand_name: string | null;
};

type WmsRow = { wh_code: string; item_code: string; on_hand: string | null };

/**
 * ຕົ້ນທຶນມາຈາກໃສ — ບອກໄວ້ ເພາະສາມແຫຼ່ງນີ້ບໍ່ແມ່ນອັນດຽວກັນ.
 *
 *   `warehouse` ຕົ້ນທຶນສະເລ່ຍຂອງສາງນັ້ນເອງ (ແມ່ນຍຳສຸດ)
 *   `master`    ຕົ້ນທຶນສະເລ່ຍລວມຂອງບໍລິສັດ ຈາກທະບຽນສິນຄ້າ
 *   `last_buy`  ລາຄາຊື້ຄັ້ງລ້າສຸດ — **ລາຄາຊື້ ບໍ່ແມ່ນຕົ້ນທຶນສະເລ່ຍ** ອາດຕ່າງກັນຫຼາຍ
 *   `none`      ບໍ່ມີເລີຍ
 */
export type CostSource = "warehouse" | "master" | "last_buy" | "none";

/** ຄົງເຫຼືອ ERP ຕໍ່ໜຶ່ງສາງ — ຟັງຊັນຄິດຄົງເຫຼືອຂອງ SmartBiz, ກອງຢູ່ໃນຟັງຊັນເລີຍ. */
const ERP_SQL = `
  SELECT $1::text                                       AS wh_code,
         b.ic_code                                      AS item_code,
         COALESCE(NULLIF(TRIM(b.ic_name), ''), inv.name_1) AS item_name,
         NULLIF(TRIM(b.ic_unit_code), '')               AS unit_code,
         g.name_1                                       AS group_name,
         gs.name_1                                      AS group_sub_name,
         COALESCE(cat.name_1, NULLIF(TRIM(inv.group_sub2), '')) AS group_sub2_name,
         br.name_1                                      AS brand_name,
         b.balance_qty::text                            AS on_hand,
         COALESCE(NULLIF(b.average_cost, 0), b.average_cost_end, 0)::text AS avg_cost
  FROM sml_ic_function_stock_balance_warehouse(date(timezone('WAST', now())), '', $1) b
  LEFT JOIN public.ic_inventory inv ON inv.code = b.ic_code
  LEFT JOIN public.ic_group g       ON g.code   = inv.group_main
  LEFT JOIN public.ic_group_sub gs  ON gs.code  = inv.group_sub
  -- group_sub2 ເປັນລະຫັດ (ເຊັ່ນ 130102) — ຫາຊື່ຈາກ ic_category, ບໍ່ພົບກໍ່ໃຊ້ລະຫັດ
  LEFT JOIN public.ic_category cat   ON cat.code = inv.group_sub2
  LEFT JOIN public.ic_brand br      ON br.code  = inv.item_brand
  WHERE b.balance_qty <> 0
    AND b.ic_code IS NOT NULL AND b.ic_code <> ''
    AND b.ic_code NOT LIKE '9%'
    AND COALESCE(inv.item_type, 0) NOT IN (1, 3)`;

/** ຍອດຂາຍສຸດທິ (ບິນຂາຍ ຫັກ ໃບຮັບຄືນ CN) ຕໍ່ (ສາງ × ສິນຄ້າ) ພາຍໃນຊ່ວງ. */
const SALES_SQL = `
  WITH sales AS (
    SELECT d.wh_code, d.item_code,
           SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS sold,
           count(DISTINCT d.doc_no)                            AS bills,
           count(DISTINCT d.doc_date)                          AS sale_days,
           MAX(d.doc_date)                                     AS last_sale,
           MAX(d.item_name)                                    AS item_name,
           MAX(d.unit_code)                                    AS unit_code,
           -- ແຍກຊ່ວງຫຼ້າສຸດ ກັບ ຊ່ວງກ່ອນໜ້າ ເພື່ອຄິດແນວໂນ້ມ
           COALESCE(SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0))
                    FILTER (WHERE d.doc_date >= CURRENT_DATE - $3::int), 0) AS recent_qty,
           COALESCE(SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0))
                    FILTER (WHERE d.doc_date <  CURRENT_DATE - $3::int), 0) AS prior_qty,
           -- ມູນຄ່າຂາຍ — ຖານຂອງການຈັດ ABC
           COALESCE(SUM(d.sum_amount), 0)                      AS sale_amount
    FROM public.ic_trans_detail d
    JOIN public.ic_trans h            ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
    LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
    WHERE d.trans_flag = ${SALE_FLAG}
      AND d.wh_code = ANY($1)
      AND d.doc_date >= CURRENT_DATE - $2::int
      AND (d.status = 0 OR d.status IS NULL)
      AND COALESCE(h.is_cancel, 0) = 0
      -- ບິນຮັບຄືນ / ຍົກເລີກ ບໍ່ແມ່ນຄວາມຕ້ອງການ (ເບິ່ງ DEAD_DOC_RE)
      AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
      AND d.item_code IS NOT NULL AND d.item_code <> ''
      AND d.item_code NOT LIKE '9%'
      AND COALESCE(inv.item_type, 0) NOT IN (1, 3)
    GROUP BY 1, 2
  ),
  ret AS (
    SELECT r.wh_code, r.item_code, SUM(r.qty) AS ret_qty
    FROM public.ic_trans_detail r
    JOIN public.ic_trans rh ON rh.doc_no = r.doc_no AND rh.trans_flag = r.trans_flag
    WHERE r.trans_flag = ${RETURN_DOC_FLAG}
      AND r.wh_code = ANY($1)
      AND r.doc_date >= CURRENT_DATE - $2::int
      AND (r.status = 0 OR r.status IS NULL)
      AND COALESCE(rh.is_cancel, 0) = 0
    GROUP BY 1, 2
  )
  SELECT s.wh_code, s.item_code, s.item_name, s.unit_code,
         GREATEST(s.sold - COALESCE(r.ret_qty, 0), 0)::text AS sold,
         s.bills::int                                       AS bills,
         s.sale_days::int                                   AS sale_days,
         to_char(s.last_sale, 'YYYY-MM-DD')                 AS last_sale,
         s.recent_qty::text                                 AS recent_qty,
         s.prior_qty::text                                  AS prior_qty,
         s.sale_amount::text                                AS sale_amount,
         -- ຕົ້ນທຶນສະເລ່ຍລວມຂອງບໍລິສັດ ຈາກທະບຽນສິນຄ້າ — ໃຊ້ເມື່ອສາງນີ້ບໍ່ມີຂອງ
         -- ຈຶ່ງບໍ່ມີຕົ້ນທຶນສະເພາະສາງ (ຄອບຄຸມ ~99% ຂອງສິນຄ້າທີ່ຂາຍຢູ່)
         COALESCE(inv2.average_cost, 0)::text               AS master_cost,
         -- ໝວດສິນຄ້າ — ຕ້ອງມີຢູ່ຂານີ້ນຳ ເພາະສິນຄ້າທີ່ໝົດ ບໍ່ມີແຖວຄົງເຫຼືອ ERP
         g2.name_1                                          AS group_name,
         gs2.name_1                                         AS group_sub_name,
         COALESCE(cat2.name_1, NULLIF(TRIM(inv2.group_sub2), '')) AS group_sub2_name,
         br2.name_1                                         AS brand_name
  FROM sales s
  LEFT JOIN ret r ON r.wh_code = s.wh_code AND r.item_code = s.item_code
  LEFT JOIN public.ic_inventory inv2 ON inv2.code = s.item_code
  LEFT JOIN public.ic_group g2       ON g2.code   = inv2.group_main
  LEFT JOIN public.ic_group_sub gs2  ON gs2.code  = inv2.group_sub
  LEFT JOIN public.ic_category cat2  ON cat2.code = inv2.group_sub2
  LEFT JOIN public.ic_brand br2      ON br2.code  = inv2.item_brand`;

/**
 * ລາຄາຊື້ຄັ້ງລ້າສຸດ — ຂັ້ນສຸດທ້າຍຂອງລູກໂສ້ຕົ້ນທຶນ.
 *
 * **ຖາມສະເພາະລະຫັດທີ່ຍັງບໍ່ມີຕົ້ນທຶນ** ບໍ່ແມ່ນທັງໝົດ: ຖາມທັງຕາຕະລາງໃຊ້ 40 ວິນາທີ
 * ແຕ່ຖາມ 60 ລະຫັດໃຊ້ພຽງ 0.2 ວິນາທີ.
 *
 * flag 6 = ໃບຮັບເຂົ້າ, 12 = ໃບຊື້ຕິດໜີ້ — ສອງອັນນີ້ຄືເອກະສານຊື້ທີ່ມີລາຄາຈິງ.
 */
const LAST_BUY_SQL = `
  SELECT DISTINCT ON (d.item_code)
         d.item_code, d.price::text AS price, to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date
  FROM public.ic_trans_detail d
  JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
  WHERE d.item_code = ANY($1)
    AND d.trans_flag IN (6, 12) AND d.price > 0
    AND COALESCE(h.is_cancel, 0) = 0
  ORDER BY d.item_code, d.doc_date DESC`;

/**
 * ຄົງເຫຼືອຕາມບັນຊີ WMS. ບໍ່ກອງ `status` — ດ້ວຍເຫດຜົນດຽວກັນກັບໜ້າຄົງເຫຼືອ:
 * status=1 ຄືຂາອອກຂອງການຍ້າຍບ່ອນພາຍໃນ (trans_flag 77) ບໍ່ແມ່ນແຖວທີ່ຖືກຍົກເລີກ.
 */
const WMS_SQL = `
  SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag)::text AS on_hand
  FROM public.odg_wms_trans_detail t
  WHERE t.wh_code = ANY($1) AND t.item_code IS NOT NULL AND t.item_code <> ''
  GROUP BY 1, 2`;

/**
 * ຫົວໜ່ວຍໃຫຍ່ຂອງສິນຄ້າ (ຫີບ / ມັດ / ຖົງ) ຈາກ `ic_unit_use`.
 *
 * ໃຊ້ຕອນຂໍໂອນ — ສາງບໍ່ແຕກມັດເພື່ອສົ່ງ 13 ເສັ້ນ, ຕ້ອງສົ່ງເປັນມັດເຕັມ.
 * ເອົາ `ratio` ໃຫຍ່ສຸດຂອງແຕ່ລະສິນຄ້າ (ບາງອັນມີຫຼາຍຊັ້ນ).
 *
 * ຕາຕະລາງນີ້ນ້ອຍ (~2,100 ສິນຄ້າມີຫົວໜ່ວຍໃຫຍ່) ແລະ ເປັນຂໍ້ມູນຫຼັກທີ່ບໍ່ຄ່ອຍປ່ຽນ
 * ຈຶ່ງໂຫຼດເທື່ອດຽວແລ້ວເກັບໄວ້ຍາວ — ບໍ່ຕ້ອງ join ໃນທຸກຄຳຮ້ອງ.
 */
export type PackUnit = { unit: string; size: number };

const PACK_TTL_MS = 60 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __packUnits: { at: number; map: Map<string, PackUnit> } | undefined;
}

async function packUnits(): Promise<Map<string, PackUnit>> {
  const hit = globalThis.__packUnits;
  if (hit && Date.now() - hit.at < PACK_TTL_MS) return hit.map;
  const map = new Map<string, PackUnit>();
  try {
    const rows = await query<{ ic_code: string; code: string | null; ratio: string | null }>(
      `SELECT DISTINCT ON (u.ic_code) u.ic_code, u.code, u.ratio::text AS ratio
       FROM public.ic_unit_use u
       WHERE u.ratio > 1 AND COALESCE(u.status, 1) = 1
         AND u.ic_code IS NOT NULL AND NULLIF(TRIM(u.code), '') IS NOT NULL
       ORDER BY u.ic_code, u.ratio DESC`,
    );
    for (const r of rows) {
      const size = num(r.ratio);
      if (size > 1 && r.code) map.set(r.ic_code, { unit: r.code.trim(), size });
    }
  } catch {
    // ຕາຕະລາງບໍ່ມີ / ອ່ານບໍ່ໄດ້ — ຖືວ່າບໍ່ມີຫົວໜ່ວຍໃຫຍ່ ໜ້າຈໍຍັງໃຊ້ໄດ້
  }
  globalThis.__packUnits = { at: Date.now(), map };
  return map;
}

/** ກະແຈລວມ — ສາງ + ສິນຄ້າ. */
const key = (wh: string, item: string) => `${wh}::${item}`;

/** ແຖວທີ່ລວມ 3 ຂາແລ້ວ ກ່ອນຄິດສະຖານະ. */
type Row = {
  wh_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_name: string | null;
  /** ໝວດຍ່ອຍ (ic_group_sub). */
  group_sub_name: string | null;
  /** ໝວດຍ່ອຍຊັ້ນ 2 (group_sub2) — ຊື່ຈາກ ic_category ຫຼື ລະຫັດດິບ. */
  group_sub2_name: string | null;
  brand_name: string | null;
  on_hand: number;
  wms_on_hand: number;
  sold: number;
  bills: number;
  sale_days: number;
  last_sale: string | null;
  avg_cost: number;
  cost_source: CostSource;
  /** ວັນທີ່ຊື້ຄັ້ງລ້າສຸດ — ມີເມື່ອ `cost_source = "last_buy"`. */
  last_buy_date: string | null;
  recent_qty: number;
  prior_qty: number;
  sale_amount: number;
  /** ຫົວໜ່ວຍໃຫຍ່ (ຫີບ/ມັດ/ຖົງ) — `null` ເມື່ອສິນຄ້ານີ້ບໍ່ໄດ້ຕັ້ງໄວ້. */
  pack: PackUnit | null;
  /** ໃສ່ສະເພາະຕອນລວມກຸ່ມ — ບອກວ່າຍອດລວມນັ້ນມາຈາກສາງໃດແດ່. */
  by_wh?: WarehouseSplit[];
};

/**
 * ຂໍ້ມູນດິບຂອງໜຶ່ງສາງ ທີ່ cache ໄວ້ — ຍັງບໍ່ທັນຄິດສະຖານະ ຈຶ່ງໃຊ້ຊ້ຳໄດ້ກັບທຸກຂີດແບ່ງ.
 */
type CachedRows = { at: number; wh_name: string | null; rows: Row[] };

/**
 * ອາຍຸ cache. ຄົງເຫຼືອ ERP ຕ້ອງໄລ່ປະຫວັດທັງໝົດທຸກເທື່ອ (4–6 ວິນາທີ ສຳລັບສາງໃຫຍ່
 * ຢ່າງ 1203) ຈຶ່ງເປັນຂາທີ່ຊ້າສຸດຂອງໜ້ານີ້. ການວິເຄາະຄວາມພຽງພໍເປັນການເບິ່ງແນວໂນ້ມ
 * ບໍ່ແມ່ນຍອດ real-time ຈຶ່ງເກັບໄວ້ 10 ນາທີໄດ້ຢ່າງປອດໄພ — ຜູ້ໃຊ້ກົດ "ໂຫຼດໃໝ່"
 * ເມື່ອຕ້ອງການຂໍ້ມູນສົດ.
 */
const CACHE_TTL_MS = 10 * 60_000;

/**
 * ຮຸ່ນຂອງໂຄງສ້າງ `Row` — ຕ້ອງບວກຂຶ້ນ **ທຸກຄັ້ງທີ່ເພີ່ມ/ປ່ຽນຊ່ອງໃນ `Row`**.
 *
 * cache ຜູກກັບ `globalThis` ຈຶ່ງລອດ HMR ຕອນ dev — ຖ້າບໍ່ມີຮຸ່ນ ແຖວເກົ່າທີ່ຍັງ
 * ບໍ່ມີຊ່ອງໃໝ່ຈະຖືກໃຊ້ຕໍ່ ແລ້ວຊ່ອງນັ້ນຈະເປັນ undefined ແບບງຽບໆ.
 */
const CACHE_VERSION = 3;

declare global {
  // eslint-disable-next-line no-var
  var __coverageCache: Map<string, CachedRows> | undefined;
}

// ຜູກກັບ globalThis ຄືກັນກັບ pool ໃນ db.ts ເພື່ອໃຫ້ລອດ HMR ຕອນ dev
const cache: Map<string, CachedRows> = globalThis.__coverageCache ?? new Map();
globalThis.__coverageCache = cache;

/** ລ້າງ cache ຂອງສາງໃດໜຶ່ງ (ຫຼື ທັງໝົດ) — ໃຊ້ຫຼັງມີການເຄື່ອນໄຫວ stock ໃຫຍ່. */
export function clearCoverageCache(whCode?: string): void {
  if (!whCode) return void cache.clear();
  for (const k of [...cache.keys()]) if (k.includes(`|${whCode}|`)) cache.delete(k);
}

/**
 * ດຶງ + ລວມ 3 ຂາຂອງໜຶ່ງສາງ (ຜ່ານ cache).
 *
 * ລວມດ້ວຍ union ຂອງກະແຈ (ສາງ × ສິນຄ້າ) ເພື່ອບໍ່ໃຫ້ຕົກ 2 ກໍລະນີສຳຄັນ:
 * "ຂາຍຢູ່ແຕ່ບໍ່ມີຂອງ" ແລະ "ມີຂອງແຕ່ບໍ່ຂາຍ" — ສອງອັນນີ້ຄືຄຳຕອບຂອງຄຳຖາມ ຈຶ່ງຕົກບໍ່ໄດ້.
 */
async function loadRows(whCode: string, days: number, refresh: boolean): Promise<CachedRows> {
  const ck = `v${CACHE_VERSION}|${whCode}|${days}`;
  const hit = cache.get(ck);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const [erpRows, saleRows, wmsRows, whRows] = await Promise.all([
    query<ErpRow>(ERP_SQL, [whCode]),
    query<SaleRow>(SALES_SQL, [[whCode], days, recentWindow(days)]),
    query<WmsRow>(WMS_SQL, [[whCode]]),
    query<{ code: string; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = $1`,
      [whCode],
    ),
  ]);

  const merged = new Map<string, Row>();
  const blank = (wh_code: string, item_code: string): Row => ({
    wh_code, item_code, item_name: null, unit_code: null,
    group_name: null, group_sub_name: null, group_sub2_name: null, brand_name: null,
    on_hand: 0, wms_on_hand: 0, sold: 0, bills: 0, sale_days: 0,
    last_sale: null, avg_cost: 0, cost_source: "none", last_buy_date: null,
    recent_qty: 0, prior_qty: 0, sale_amount: 0, pack: null,
  });
  const at = (wh: string, item: string): Row => {
    const k = key(wh, item);
    let row = merged.get(k);
    if (!row) { row = blank(wh, item); merged.set(k, row); }
    return row;
  };

  for (const e of erpRows) {
    const row = at(e.wh_code, e.item_code);
    row.on_hand = num(e.on_hand);
    row.item_name = e.item_name;
    row.unit_code = e.unit_code;
    row.group_name = e.group_name;
    row.group_sub_name = e.group_sub_name;
    row.group_sub2_name = e.group_sub2_name;
    row.brand_name = e.brand_name;
    row.avg_cost = num(e.avg_cost);
    if (row.avg_cost > 0) row.cost_source = "warehouse";
  }
  for (const s of saleRows) {
    const row = at(s.wh_code, s.item_code);
    row.sold = num(s.sold);
    row.bills = s.bills ?? 0;
    row.sale_days = s.sale_days ?? 0;
    row.last_sale = s.last_sale;
    row.recent_qty = num(s.recent_qty);
    row.prior_qty = num(s.prior_qty);
    row.sale_amount = num(s.sale_amount);
    row.item_name ??= s.item_name;
    row.unit_code ??= s.unit_code;
    row.group_name ??= s.group_name;
    row.group_sub_name ??= s.group_sub_name;
    row.group_sub2_name ??= s.group_sub2_name;
    row.brand_name ??= s.brand_name;
    // ຂັ້ນ 2 ຂອງລູກໂສ້ຕົ້ນທຶນ: ຕົ້ນທຶນລວມຈາກທະບຽນສິນຄ້າ
    if (row.avg_cost <= 0) {
      const master = num(s.master_cost);
      if (master > 0) {
        row.avg_cost = master;
        row.cost_source = "master";
      }
    }
  }
  for (const w of wmsRows) {
    const qty = num(w.on_hand);
    // ສິນຄ້າທີ່ WMS ຄົງເຫຼືອເປັນ 0 ແລະ ບໍ່ມີຢູ່ຂາອື່ນ ບໍ່ຕ້ອງສ້າງແຖວໃໝ່
    if (qty === 0 && !merged.has(key(w.wh_code, w.item_code))) continue;
    at(w.wh_code, w.item_code).wms_on_hand = qty;
  }

  // ── ຂັ້ນ 3 ຂອງລູກໂສ້ຕົ້ນທຶນ: ລາຄາຊື້ຄັ້ງລ້າສຸດ ──────────────────────
  //
  // ຖາມສະເພາະລະຫັດທີ່ຍັງບໍ່ມີຕົ້ນທຶນ ແລະ ຍັງມີການເຄື່ອນໄຫວ — ຖາມທັງໝົດຊ້າ 40
  // ວິນາທີ ແຕ່ຖາມສະເພາະສ່ວນທີ່ຂາດ (ປົກກະຕິບໍ່ຮອດ 100 ລະຫັດ) ໃຊ້ <1 ວິນາທີ.
  const needCost = [...merged.values()]
    .filter((r) => r.avg_cost <= 0 && (r.sold > 0 || r.on_hand !== 0))
    .map((r) => r.item_code);

  if (needCost.length > 0) {
    try {
      const buys = await query<{ item_code: string; price: string | null; doc_date: string | null }>(
        LAST_BUY_SQL,
        [needCost],
      );
      const byCode = new Map(buys.map((b) => [b.item_code, b]));
      for (const r of merged.values()) {
        if (r.avg_cost > 0) continue;
        const b = byCode.get(r.item_code);
        const price = num(b?.price);
        if (price > 0) {
          r.avg_cost = price;
          r.cost_source = "last_buy";
          r.last_buy_date = b?.doc_date ?? null;
        }
      }
    } catch {
      // ຫາລາຄາຊື້ບໍ່ໄດ້ ກໍ່ບໍ່ເປັນຫຍັງ — ຕົກເປັນ "ບໍ່ຮູ້ຕົ້ນທຶນ" ຕາມເດີມ
    }
  }

  // ── ຫົວໜ່ວຍໃຫຍ່ (ຫີບ/ມັດ/ຖົງ) — ໃຊ້ຕອນຂໍໂອນ ──────────────────────
  const packs = await packUnits();
  for (const r of merged.values()) r.pack = packs.get(r.item_code) ?? null;

  const entry: CachedRows = {
    at: Date.now(),
    wh_name: whRows[0]?.name ?? null,
    rows: [...merged.values()],
  };
  cache.set(ck, entry);
  return entry;
}

/**
 * ຄວາມຍາວຂອງ "ຊ່ວງຫຼ້າສຸດ" ທີ່ໃຊ້ຄິດແນວໂນ້ມ — ໜຶ່ງສ່ວນສາມຂອງຊ່ວງທັງໝົດ
 * (ຢ່າງໜ້ອຍ 7 ມື້) ຈຶ່ງທຽບກັບສອງສ່ວນທີ່ເຫຼືອໄດ້ຢ່າງມີຄວາມໝາຍ.
 */
export const recentWindow = (days: number) => Math.max(7, Math.round(days / 3));

/** ຄິດສະຖານະ/ວັນທີ່ພໍໃຊ້ ຈາກແຖວດິບ — JS ລ້ວນ ບໍ່ແຕະ DB. */
function computeItems(rows: Row[], span: number, thresholds: Thresholds): CoverageItem[] {
  const recentDays = recentWindow(span);
  const priorDays = Math.max(1, span - recentDays);

  const items: CoverageItem[] = rows.map((r): CoverageItem => {
    const on_hand = num(r.on_hand);
    const wms_on_hand = num(r.wms_on_hand);
    const sold = num(r.sold);
    const avg_daily = Math.round((sold / span) * 1e6) / 1e6;
    // ERP ມີຕົ້ນທຶນສະເລ່ຍຕິດລົບຢູ່ຈຳນວນໜຶ່ງ (ຄວາມຜິດພາດຂອງຂໍ້ມູນຝັ່ງ ERP) —
    // ຖ້າປ່ອຍໄວ້ ມູນຄ່າ "ຕ້ອງເຕີມ" ຂອງທັງສາງຈະກາຍເປັນຕິດລົບ. ຖືເປັນ 0 ໄປເລີຍ
    // ດີກວ່າ ເພາະບໍ່ເຮັດໃຫ້ຕົວເລກສູງເກີນຈິງ.
    const avg_cost = Math.max(0, num(r.avg_cost));

    const days_cover = avg_daily > 0 ? Math.round((on_hand / avg_daily) * 10) / 10 : null;

    let status: CoverageStatus;
    if (on_hand < 0) status = "negative";
    else if (avg_daily <= 0) status = on_hand > 0 ? "idle" : "ok";
    else if (on_hand <= 0) status = "out";
    else if ((days_cover as number) < thresholds.critical) status = "critical";
    else if ((days_cover as number) < thresholds.low) status = "low";
    else if ((days_cover as number) > thresholds.over) status = "over";
    else status = "ok";

    // ເປົ້າໝາຍການເຕີມ = ພໍໃຊ້ໃຫ້ເຖິງຂີດ `low` ວັນ; ເກີນ = ສ່ວນທີ່ເກີນຂີດ `over`
    const target = avg_daily * thresholds.low;
    const cap = avg_daily * thresholds.over;
    const shortfall = avg_daily > 0 && on_hand < target
      ? Math.round((target - Math.max(on_hand, 0)) * 100) / 100
      : 0;
    const excess = avg_daily > 0 && on_hand > cap
      ? Math.round((on_hand - cap) * 100) / 100
      : 0;

    // ── ຮູບແບບຄວາມຕ້ອງການ ──────────────────────────────────────────
    const sale_days = r.sale_days ?? 0;
    const pattern: DemandPattern =
      sold <= 0 || sale_days === 0
        ? "none"
        : sale_days === 1
          ? "single"
          : sale_days >= span / 4 // ຂາຍຢ່າງໜ້ອຍ 1 ໃນ 4 ມື້ = ນັບວ່າສະໝ່ຳສະເໝີ
            ? "steady"
            : "intermittent";

    // ── ແນວໂນ້ມ ────────────────────────────────────────────────────
    const recent_qty = num(r.recent_qty);
    const prior_qty = num(r.prior_qty);
    const recentRate = recent_qty / recentDays;
    const priorRate = prior_qty / priorDays;
    let trend: DemandTrend;
    if (sold <= 0) trend = "none";
    else if (recent_qty <= 0 && prior_qty > 0) trend = "stopped";
    else if (priorRate <= 0) trend = "rising"; // ຫາກໍ່ເລີ່ມຂາຍໃນຊ່ວງຫຼ້າສຸດ
    else if (recentRate > priorRate * 1.5) trend = "rising";
    else if (recentRate < priorRate * 0.5) trend = "falling";
    else trend = "flat";

    return {
      wh_code: r.wh_code,
      item_code: r.item_code,
      item_name: r.item_name,
      unit_code: r.unit_code,
      group_name: r.group_name,
      group_sub_name: r.group_sub_name,
      group_sub2_name: r.group_sub2_name,
      brand_name: r.brand_name,
      on_hand,
      wms_on_hand,
      sync_gap: Math.round((wms_on_hand - on_hand) * 1e6) / 1e6,
      sold,
      bills: r.bills ?? 0,
      sale_days,
      last_sale: r.last_sale,
      avg_daily,
      days_cover,
      status,
      shortfall,
      excess,
      avg_cost,
      cost_source: r.cost_source,
      last_buy_date: r.last_buy_date,
      stock_value: Math.round(on_hand * avg_cost * 100) / 100,
      by_wh: r.by_wh,
      recent_qty,
      prior_qty,
      recent_avg_daily: Math.round(recentRate * 1e6) / 1e6,
      pattern,
      trend,
      pack: r.pack,
      sale_amount: num(r.sale_amount),
      abc: "none",
      // N ຕັ້ງແຕ່ຕົ້ນ — ຕົວທີ່ຂາຍຢູ່ຈະຖືກຈັດເປັນ F/S ໃນຮອບລຸ່ມ
      fsn: "N",
      days_since_sale: r.last_sale
        ? Math.max(0, Math.round((Date.now() - Date.parse(`${r.last_sale}T00:00:00Z`)) / 864e5))
        : null,
    };
  });

  // ── ABC (ມູນຄ່າຂາຍ) ແລະ FSN (ຄວາມຖີ່) ──────────────────────────────
  // ສູດຢູ່ທີ່ lib/classify.ts — ບໍລິສຸດ ບໍ່ແຕະ DB ຈຶ່ງທົດສອບໄດ້ ແລະ ໜ້າອື່ນ
  // (ນັບວົນ, ກົດການວາງເຄື່ອງ) ໃຊ້ຊັ້ນຊຸດດຽວກັນນີ້ໄດ້.
  classifyAbc(items);
  classifyFsn(items);

  return items;
}

/** ສະຫຼຸບລວມຂອງໜຶ່ງສາງ (ຫຼື ໜຶ່ງກຸ່ມສາງ). */
function summarize(
  code: string,
  name: string | null,
  items: CoverageItem[],
): WarehouseSummary | null {
  if (items.length === 0) return null;

  const s: WarehouseSummary = {
    wh_code: code,
    wh_name: name,
    items: 0, selling_items: 0, counts: EMPTY_COUNTS(),
    sold_total: 0, on_hand_total: 0, wms_on_hand_total: 0,
    sync_gap: 0, sync_gap_ratio: 0, service_rate: 0,
    shortfall_value: 0, excess_value: 0,
  };
  for (const it of items) {
    s.items += 1;
    s.counts[it.status] += 1;
    s.sold_total += it.sold;
    s.on_hand_total += it.on_hand;
    s.wms_on_hand_total += it.wms_on_hand;
    if (it.avg_daily > 0) s.selling_items += 1;
    s.shortfall_value += it.shortfall * it.avg_cost;
    s.excess_value += it.excess * it.avg_cost;
  }

  // ໃຫ້ບໍລິການໄດ້ = ສິນຄ້າຂາຍຢູ່ ທີ່ບໍ່ໝົດ/ບໍ່ວິກິດ/ບໍ່ຕິດລົບ
  const served = s.selling_items - s.counts.out - s.counts.critical - s.counts.negative;
  return {
    ...s,
    sold_total: Math.round(s.sold_total * 100) / 100,
    on_hand_total: Math.round(s.on_hand_total * 100) / 100,
    wms_on_hand_total: Math.round(s.wms_on_hand_total * 100) / 100,
    sync_gap: Math.round((s.wms_on_hand_total - s.on_hand_total) * 100) / 100,
    sync_gap_ratio:
      s.on_hand_total !== 0
        ? Math.abs(s.wms_on_hand_total - s.on_hand_total) / Math.abs(s.on_hand_total)
        : 0,
    service_rate: s.selling_items > 0 ? Math.max(0, served) / s.selling_items : 1,
    shortfall_value: Math.round(s.shortfall_value),
    excess_value: Math.round(s.excess_value),
  };
}

/**
 * ວິເຄາະ **ໜຶ່ງສາງ** ຕໍ່ໜຶ່ງການເອີ້ນ.
 *
 * **ເປັນສາງລະຄຳຮ້ອງໂດຍເຈດຕະນາ.** ຟັງຊັນຄິດຄົງເຫຼືອ ERP ກິນ CPU ຂອງ DB ຫຼາຍ —
 * ຍິງພ້ອມກັນ 5 ສາງ ໃຊ້ເວລາ ~23 ວິນາທີ ແຕ່ຍິງເທື່ອລະສາງ ໃຊ້ພຽງ 0.4–6 ວິນາທີ/ສາງ.
 * ໜ້າຈໍຈຶ່ງເອີ້ນເທື່ອລະສາງ ແລ້ວສະແດງຜົນທັນທີທີ່ແຕ່ລະສາງແລ້ວ.
 *
 * ຂໍ້ມູນດິບຖືກ cache ໄວ້ (ເບິ່ງ `CACHE_TTL_MS`) ສ່ວນການຄິດສະຖານະເປັນ JS ລ້ວນ —
 * ການປ່ຽນຂີດແບ່ງ ຫຼື ເປີດເບິ່ງຊ້ຳ ຈຶ່ງໄວທັນທີ ບໍ່ຕ້ອງແຕະ DB ອີກ.
 */
export async function loadCoverage(
  whCode: string,
  days: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  refresh = false,
): Promise<CoverageResult> {
  const cached = await loadRows(whCode, days, refresh);
  const items = computeItems(cached.rows, Math.max(1, days), thresholds);
  return {
    days,
    thresholds,
    warehouse: summarize(whCode, cached.wh_name, items),
    items,
  };
}

/**
 * ວິເຄາະ **ຫຼາຍສາງລວມເປັນກຸ່ມດຽວ** — ເຊັ່ນ ໂພນສະອາດ 1301–1304 ຫຼື ດອນຕີ້ວ 12xx.
 *
 * ເປັນຄົນລະຄຳຖາມກັບການວິເຄາະແຍກສາງ ແລະ **ໃກ້ຄວາມຈິງກວ່າ** ເມື່ອສາງເຫຼົ່ານັ້ນຢູ່
 * ບ່ອນດຽວກັນ: ສິນຄ້າທີ່ "ໝົດ" ຢູ່ 1301 (ໜ້າຮ້ານ) ອາດນອນຢູ່ 1302 (ຫຼັງຮ້ານ) ຫ່າງ
 * ກັນບໍ່ເທົ່າໃດແມັດ — ຖ້າວິເຄາະແຍກ ຈະຂຶ້ນວ່າຂາດ ແລ້ວສັ່ງຊື້/ໂອນມາຊ້ຳໂດຍບໍ່ຈຳເປັນ.
 *
 * ລວມແບບບວກກັນຊື່ໆ (ຄົງເຫຼືອ + ຍອດຂາຍ) ແລ້ວຄິດສະຖານະໃໝ່ຈາກຍອດລວມ. ຕົ້ນທຶນ
 * ສະເລ່ຍຖ່ວງນ້ຳໜັກດ້ວຍຄົງເຫຼືອ. ແຕ່ລະລາຍການຍັງເກັບ `by_wh` ໄວ້ ເພື່ອໃຫ້ເຫັນວ່າ
 * ຂອງກ້ອນນັ້ນຄວາມຈິງນອນຢູ່ສາງໃດ.
 *
 * ໂຫຼດຕາມລຳດັບ (ບໍ່ພ້ອມກັນ) ດ້ວຍເຫດຜົນດຽວກັນກັບ `loadCoverage`.
 */
export async function loadCoverageGroup(
  whCodes: string[],
  days: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  refresh = false,
): Promise<CoverageResult> {
  if (whCodes.length === 0) {
    return { days, thresholds, warehouse: null, items: [] };
  }
  if (whCodes.length === 1) {
    return loadCoverage(whCodes[0], days, thresholds, refresh);
  }

  const span = Math.max(1, days);
  const groupCode = whCodes.join("+");
  const merged = new Map<string, Row>();
  const names: string[] = [];
  // ນ້ຳໜັກສຳລັບຖ່ວງຕົ້ນທຶນສະເລ່ຍ — ເກັບແຍກ ບໍ່ປົນກັບ Row
  const costWeight = new Map<string, { sum: number; qty: number; fallback: number }>();

  for (const code of whCodes) {
    const cached = await loadRows(code, days, refresh);
    if (cached.wh_name) names.push(cached.wh_name);

    for (const r of cached.rows) {
      let g = merged.get(r.item_code);
      if (!g) {
        g = {
          wh_code: groupCode,
          item_code: r.item_code,
          item_name: r.item_name,
          unit_code: r.unit_code,
          group_name: r.group_name,
          group_sub_name: r.group_sub_name,
          group_sub2_name: r.group_sub2_name,
          brand_name: r.brand_name,
          on_hand: 0, wms_on_hand: 0, sold: 0, bills: 0, sale_days: 0,
          last_sale: null, avg_cost: 0, cost_source: "none", last_buy_date: null,
          recent_qty: 0, prior_qty: 0, sale_amount: 0, pack: null, by_wh: [],
        };
        merged.set(r.item_code, g);
      }
      g.on_hand += r.on_hand;
      g.wms_on_hand += r.wms_on_hand;
      g.sold += r.sold;
      g.bills += r.bills;
      g.recent_qty += r.recent_qty;
      g.prior_qty += r.prior_qty;
      g.sale_amount += r.sale_amount;
      g.pack ??= r.pack;
      // ມື້ທີ່ຂາຍ: ເອົາສູງສຸດ ບໍ່ບວກກັນ — ສາງຫຼາຍບ່ອນຂາຍມື້ດຽວກັນໄດ້
      g.sale_days = Math.max(g.sale_days, r.sale_days);
      if (r.last_sale && (!g.last_sale || r.last_sale > g.last_sale)) g.last_sale = r.last_sale;
      g.item_name ??= r.item_name;
      g.unit_code ??= r.unit_code;
      g.group_name ??= r.group_name;
      g.group_sub_name ??= r.group_sub_name;
      g.group_sub2_name ??= r.group_sub2_name;
      g.brand_name ??= r.brand_name;

      const w = costWeight.get(r.item_code) ?? { sum: 0, qty: 0, fallback: 0 };
      if (r.avg_cost > 0 && r.on_hand > 0) { w.sum += r.avg_cost * r.on_hand; w.qty += r.on_hand; }
      if (r.avg_cost > w.fallback) w.fallback = r.avg_cost;
      costWeight.set(r.item_code, w);

      // ເກັບສະເພາະສາງທີ່ມີຂອງ ຫຼື ມີການຂາຍ — ບໍ່ໃຫ້ລາຍການຫວ່າງລົກຕາ
      if (r.on_hand !== 0 || r.sold > 0) {
        g.by_wh?.push({
          wh_code: code,
          on_hand: Math.round(r.on_hand * 100) / 100,
          sold: Math.round(r.sold * 100) / 100,
          avg_daily: Math.round((r.sold / span) * 1e6) / 1e6,
        });
      }
    }
  }

  for (const [code, w] of costWeight) {
    const row = merged.get(code);
    if (row) row.avg_cost = w.qty > 0 ? w.sum / w.qty : w.fallback;
  }

  const items = computeItems([...merged.values()], span, thresholds);
  const groupName = "ລວມ " + whCodes.length + " ສາງ · " + names.join(" + ");
  return { days, thresholds, warehouse: summarize(groupCode, groupName, items), items };
}
