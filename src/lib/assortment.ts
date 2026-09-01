/**
 * ຊ່ອງຫວ່າງລາຍການສິນຄ້າ (assortment gap) — **ຂາຍດີຢູ່ບ່ອນໜຶ່ງ ແຕ່ອີກບ່ອນບໍ່ຂາຍ**.
 *
 * ນີ້ຄືກໍລະນີທີ່ `rebalance.ts` **ຕັດອອກໂດຍເຈດຕະນາ** (ກົດຂໍ້ 1: ປາຍທາງຕ້ອງເຄີຍ
 * ຂາຍຈິງ) ເພາະການສົ່ງຂອງໄປໃຫ້ສາງທີ່ບໍ່ເຄີຍຂາຍ **ບໍ່ແມ່ນການ rebalance ແຕ່ເປັນ
 * ການເປີດລາຍການໃໝ່** — ເປັນການຕັດສິນໃຈທາງການຄ້າ ບໍ່ແມ່ນການຄິດເລກ.
 *
 * ໜ້ານີ້ຈຶ່ງບໍ່ "ສັ່ງ" ໃຫ້ຍ້າຍ ແຕ່ **ຕັ້ງລາຍການໃຫ້ຄົນຄ້າພິຈາລະນາ** ຮຽງຕາມຫຼັກຖານ
 * ທີ່ໜັກແໜ້ນທີ່ສຸດກ່ອນ (ຂາຍໄດ້ຫຼາຍ · ສະໝ່ຳສະເໝີ · ບໍ່ໄດ້ເຊົາຂາຍ).
 *
 * ── ແຍກ 2 ກໍລະນີ ເພາະຄວາມໝາຍຕ່າງກັນຫຼາຍ ──────────────────────────────
 *
 *   `never_carried`       ປາຍທາງບໍ່ມີທັງຍອດຂາຍ ແລະ ບໍ່ມີຂອງ → ຍັງບໍ່ເຄີຍລອງ
 *                         ຄວນພິຈາລະນາເປີດລາຍການ
 *   `stocked_not_selling` ປາຍທາງ **ມີຂອງແລ້ວ** ແຕ່ຂາຍບໍ່ອອກ → ຢ່າສົ່ງເພີ່ມ!
 *                         ຕ້ອງໄປຫາສາເຫດກ່ອນ (ວາງຜິດບ່ອນ? ລາຄາ? ບໍ່ມີຄົນຮູ້?)
 *
 * ການແຍກນີ້ສຳຄັນ: ຖ້າລວມສອງອັນນີ້ເຂົ້າກັນ ຈະໄດ້ຄຳແນະນຳໃຫ້ຂົນຂອງໄປຕື່ມໃສ່ບ່ອນ
 * ທີ່ຂອງເກົ່າຍັງຂາຍບໍ່ອອກ ຊຶ່ງເຮັດໃຫ້ບັນຫາຮ້າຍກວ່າເກົ່າ.
 */
import { loadCoverage, type AbcClass, type CostSource, type CoverageItem, type DemandPattern, type DemandTrend } from "@/lib/coverage";

export type GapKind = "never_carried" | "stocked_not_selling";

export type AssortmentFilter = {
  /** ສາງທີ່ຂາຍໄດ້ (ຫຼັກຖານ). */
  from: string[];
  /** ສາງທີ່ຢາກເປີດລາຍການ. */
  to: string[];
  days: number;
  /** ຢາກລອງໃຫ້ພໍຂາຍກີ່ວັນ. */
  trial_days: number;
  /** ຕົ້ນທາງຕ້ອງເຫຼືອໄວ້ໃຫ້ຕົນເອງຢ່າງໜ້ອຍກີ່ວັນ. */
  keep_days: number;
  /** ເອົາສະເພາະທີ່ຂາຍສະໝ່ຳສະເໝີຢູ່ຕົ້ນທາງ. */
  steady_only: boolean;
};

export type GapItem = {
  kind: GapKind;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_name: string | null;
  brand_name: string | null;
  /** ຫຼັກຖານຈາກຕົ້ນທາງ. */
  src_sold: number;
  src_sale_amount: number;
  src_avg_daily: number;
  src_sale_days: number;
  src_on_hand: number;
  /** ຕົ້ນທາງແບ່ງໄດ້ເທົ່າໃດ ໂດຍຍັງເຫຼືອ `keep_days` ວັນ. */
  src_spare: number;
  abc: AbcClass;
  pattern: DemandPattern;
  trend: DemandTrend;
  /** ປາຍທາງມີຂອງນອນຢູ່ບໍ (ຖ້າມີ = ເຄີຍລອງແລ້ວ ແຕ່ຂາຍບໍ່ອອກ). */
  dst_on_hand: number;
  /** ຈຳນວນແນະນຳໃຫ້ລອງ — ເບິ່ງ `scale` ສຳລັບວິທີຄິດ. */
  suggest_qty: number;
  suggest_value: number;
  avg_cost: number;
  cost_source: CostSource;
};

export type AssortmentResult = {
  filter: AssortmentFilter;
  /**
   * ອັດຕາສ່ວນຂະໜາດການຂາຍ **ປາຍທາງ ÷ ຕົ້ນທາງ** (ຈາກມູນຄ່າຂາຍລວມໃນຊ່ວງ).
   *
   * ໃຊ້ຫຍໍ້ຈຳນວນທີ່ແນະນຳໃຫ້ລອງ — ຮ້ານນ້ອຍກວ່າ ບໍ່ຄວນເອົາໄປເທົ່າຮ້ານໃຫຍ່.
   * ເປັນການປະມານແບບຫຍາບ ບໍ່ແມ່ນການພະຍາກອນ.
   */
  scale: number;
  src_total_amount: number;
  dst_total_amount: number;
  items: GapItem[];
  never_carried: number;
  stocked_not_selling: number;
  /** ມູນຄ່າຂາຍລວມທີ່ຕົ້ນທາງເຮັດໄດ້ ຈາກລາຍການທີ່ປາຍທາງບໍ່ຂາຍ. */
  total_src_value: number;
  failed: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ໂຫຼດ coverage ຂອງຫຼາຍສາງ — ຕາມລຳດັບ ດ້ວຍເຫດຜົນດຽວກັນກັບ coverage.ts. */
async function load(codes: string[], days: number) {
  const map = new Map<string, Map<string, CoverageItem>>();
  const failed: string[] = [];
  for (const code of codes) {
    try {
      const res = await loadCoverage(code, days);
      map.set(code, new Map(res.items.map((i) => [i.item_code, i])));
    } catch {
      failed.push(code);
    }
  }
  return { map, failed };
}

/** ລວມຫຼາຍສາງເປັນຍອດດຽວຕໍ່ສິນຄ້າ. */
function pool(map: Map<string, Map<string, CoverageItem>>, keepDays: number) {
  type Pooled = {
    sold: number; amount: number; avg_daily: number; sale_days: number;
    on_hand: number; spare: number; avg_cost: number; cost_source: CostSource;
    abc: AbcClass; pattern: DemandPattern; trend: DemandTrend;
    item_name: string | null; unit_code: string | null;
    group_name: string | null; brand_name: string | null;
  };
  const out = new Map<string, Pooled>();
  for (const items of map.values()) {
    for (const [code, it] of items) {
      let p = out.get(code);
      if (!p) {
        p = {
          sold: 0, amount: 0, avg_daily: 0, sale_days: 0, on_hand: 0, spare: 0,
          avg_cost: 0, cost_source: "none",
          abc: "none", pattern: "none", trend: "none",
          item_name: null, unit_code: null, group_name: null, brand_name: null,
        };
        out.set(code, p);
      }
      p.sold += it.sold;
      p.amount += it.sale_amount;
      p.avg_daily += it.avg_daily;
      p.on_hand += it.on_hand;
      p.sale_days = Math.max(p.sale_days, it.sale_days);
      const free = it.on_hand - it.avg_daily * keepDays;
      if (free > 0) p.spare += free;
      if (p.avg_cost <= 0 && it.avg_cost > 0) {
        p.avg_cost = it.avg_cost;
        p.cost_source = it.cost_source;
      }
      // ເອົາການຈັດກຸ່ມທີ່ "ແຮງ" ທີ່ສຸດຂອງບັນດາສາງ — A ຊະນະ B, ສະໝ່ຳສະເໝີຊະນະຂາດໆ
      if (rankAbc(it.abc) < rankAbc(p.abc)) p.abc = it.abc;
      if (rankPattern(it.pattern) < rankPattern(p.pattern)) p.pattern = it.pattern;
      if (rankTrend(it.trend) < rankTrend(p.trend)) p.trend = it.trend;
      p.item_name ??= it.item_name;
      p.unit_code ??= it.unit_code;
      p.group_name ??= it.group_name;
      p.brand_name ??= it.brand_name;
    }
  }
  return out;
}

const rankAbc = (v: AbcClass) => ({ A: 0, B: 1, C: 2, none: 3 })[v];
const rankPattern = (v: DemandPattern) =>
  ({ steady: 0, intermittent: 1, single: 2, none: 3 })[v];
const rankTrend = (v: DemandTrend) =>
  ({ rising: 0, flat: 1, falling: 2, stopped: 3, none: 4 })[v];

/**
 * ຫາລາຍການທີ່ຕົ້ນທາງຂາຍໄດ້ ແຕ່ປາຍທາງບໍ່ຂາຍເລີຍ.
 *
 * ຮຽງຕາມມູນຄ່າຂາຍທີ່ຕົ້ນທາງ — ຫຼັກຖານທີ່ໜັກທີ່ສຸດຢູ່ເທິງສຸດ.
 */
export async function loadAssortmentGap(f: AssortmentFilter): Promise<AssortmentResult> {
  const src = await load(f.from, f.days);
  const dst = await load(f.to, f.days);

  const srcPool = pool(src.map, f.keep_days);
  const dstPool = pool(dst.map, f.keep_days);

  const srcTotal = [...srcPool.values()].reduce((s, p) => s + p.amount, 0);
  const dstTotal = [...dstPool.values()].reduce((s, p) => s + p.amount, 0);
  // ຮ້ານນ້ອຍກວ່າ ບໍ່ຄວນເອົາໄປເທົ່າຮ້ານໃຫຍ່ — ຈຳກັດໄວ້ 1 ເທົ່າ ບໍ່ໃຫ້ເກີນຕົ້ນທາງ
  const scale = srcTotal > 0 ? Math.min(1, dstTotal / srcTotal) : 0;

  const items: GapItem[] = [];
  let never_carried = 0;
  let stocked_not_selling = 0;
  let total_src_value = 0;

  for (const [code, s] of srcPool) {
    if (s.avg_daily <= 0) continue;                 // ຕົ້ນທາງຕ້ອງມີຫຼັກຖານການຂາຍ
    if (f.steady_only && s.pattern !== "steady") continue;

    const d = dstPool.get(code);
    if (d && d.avg_daily > 0) continue;             // ປາຍທາງຂາຍຢູ່ແລ້ວ = ບໍ່ແມ່ນຊ່ອງຫວ່າງ

    const dst_on_hand = d?.on_hand ?? 0;
    const kind: GapKind = dst_on_hand > 0 ? "stocked_not_selling" : "never_carried";
    if (kind === "never_carried") never_carried += 1;
    else stocked_not_selling += 1;
    total_src_value += s.amount;

    // ຈຳນວນລອງ = ອັດຕາຂາຍຂອງຕົ້ນທາງ × ວັນທີ່ຢາກລອງ × ຂະໜາດຮ້ານ, ບໍ່ເກີນທີ່ຕົ້ນທາງແບ່ງໄດ້.
    // ກໍລະນີ "ມີຂອງແຕ່ຂາຍບໍ່ອອກ" ບໍ່ແນະນຳໃຫ້ສົ່ງເພີ່ມເລີຍ.
    const raw = s.avg_daily * f.trial_days * scale;
    const suggest_qty = kind === "never_carried" ? r2(Math.min(raw, s.spare)) : 0;

    items.push({
      kind,
      item_code: code,
      item_name: s.item_name,
      unit_code: s.unit_code,
      group_name: s.group_name,
      brand_name: s.brand_name,
      src_sold: r2(s.sold),
      src_sale_amount: Math.round(s.amount),
      src_avg_daily: r2(s.avg_daily),
      src_sale_days: s.sale_days,
      src_on_hand: r2(s.on_hand),
      src_spare: r2(s.spare),
      abc: s.abc,
      pattern: s.pattern,
      trend: s.trend,
      dst_on_hand: r2(dst_on_hand),
      suggest_qty,
      suggest_value: Math.round(suggest_qty * s.avg_cost),
      avg_cost: s.avg_cost,
      cost_source: s.cost_source,
    });
  }

  items.sort((a, b) => b.src_sale_amount - a.src_sale_amount);

  return {
    filter: f,
    scale,
    src_total_amount: Math.round(srcTotal),
    dst_total_amount: Math.round(dstTotal),
    items,
    never_carried,
    stocked_not_selling,
    total_src_value: Math.round(total_src_value),
    failed: [...src.failed, ...dst.failed],
  };
}
