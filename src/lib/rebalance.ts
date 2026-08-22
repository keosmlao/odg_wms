/**
 * ຂໍ້ສະເໜີການໂອນສິນຄ້າລະຫວ່າງສາງ (stock rebalancing).
 *
 * ຕໍ່ຍອດຈາກ `coverage.ts`: ເມື່ອຮູ້ແລ້ວວ່າແຕ່ລະສາງ "ພໍໃຊ້ໄດ້ອີກຈັກມື້" ຄຳຖາມຕໍ່ໄປ
 * ຄື **ຄວນຍ້າຍຫຍັງ ຈາກສາງໃດ ໄປສາງໃດ ຈຳນວນເທົ່າໃດ** ເພື່ອໃຫ້ທຸກສາງຂາຍໄດ້ໂດຍບໍ່
 * ຕ້ອງສັ່ງຊື້ເພີ່ມ — ຍ້າຍຂອງທີ່ນອນຢູ່ ໄປບ່ອນທີ່ມີຄົນຊື້.
 *
 * ── ກົດການຈັດສັນ ─────────────────────────────────────────────────────────
 *
 *   ປາຍທາງຕ້ອງການ = (ຂາຍສະເລ່ຍ/ມື້ ຂອງປາຍທາງ × `target_days`) − ຄົງເຫຼືອປາຍທາງ
 *   ຕົ້ນທາງແບ່ງໄດ້ = ຄົງເຫຼືອຕົ້ນທາງ − (ຂາຍສະເລ່ຍ/ມື້ ຂອງຕົ້ນທາງ × `keep_days`)
 *   ຈຳນວນທີ່ຍ້າຍ  = min(ຕ້ອງການ, ແບ່ງໄດ້)
 *
 * ສອງເງື່ອນໄຂທີ່ຈົງໃຈໃສ່ໄວ້ ເພື່ອບໍ່ໃຫ້ຄຳແນະນຳເປັນອັນຕະລາຍ:
 *
 *   1. **ປາຍທາງຕ້ອງມີການຂາຍຈິງ** (`avg_daily > 0`). ຖ້າສາງໃດບໍ່ເຄີຍຂາຍສິນຄ້ານັ້ນ
 *      ການຍູ້ຂອງໄປ ບໍ່ແມ່ນການ rebalance ແຕ່ເປັນການເປີດລາຍການໃໝ່ ຊຶ່ງເປັນການ
 *      ຕັດສິນໃຈທາງການຄ້າ ບໍ່ແມ່ນການຄິດເລກ — ຈຶ່ງບໍ່ສະເໜີໃຫ້ອັດຕະໂນມັດ.
 *   2. **ຕົ້ນທາງຕ້ອງເຫຼືອພໍໃຊ້ຢ່າງໜ້ອຍ `keep_days` ວັນ**. ບໍ່ດຶງຈົນຕົ້ນທາງຂາດເອງ.
 *
 * ── ໂໝດລວມກຸ່ມ (`group`) ແລະ ເຫດຜົນທີ່ຕ້ອງມີ ────────────────────────────
 *
 * ສາງປາຍທາງທີ່ຢູ່ບ່ອນດຽວກັນ (ໂພນສະອາດ 1301–1304) ຄວນຄິດຄວາມຕ້ອງການ **ລວມກັນ**.
 * ຖ້າຄິດແຍກ: ສິນຄ້າທີ່ໝົດຢູ່ 1301 ຈະຂໍໂອນມາຈາກດອນຕີ້ວ ທັງທີ່ຂອງນອນຢູ່ 1302
 * ຫຼັງຮ້ານ — ວັດແທ້ໃນຖານຂໍ້ມູນນີ້ພົບ 133 ລາຍການແບບນີ້ຢູ່ໂພນສະອາດ. ໂໝດລວມກຸ່ມ
 * ຈຶ່ງແຍກຜົນອອກເປັນ 2 ຊະນິດ:
 *
 *   `between`  ກຸ່ມປາຍທາງຂາດແທ້ → ຕ້ອງໂອນມາຈາກຕົ້ນທາງ (ໃບຂໍໂອນ 124)
 *   `internal` ກຸ່ມມີພໍ ແຕ່ນອນຜິດສາງ → ຍ້າຍພາຍໃນກຸ່ມກໍ່ພຽງພໍ ບໍ່ຕ້ອງຂົນທາງໄກ
 */
import { loadCoverage, type CoverageItem, type PackUnit } from "@/lib/coverage";

export type RebalanceFilter = {
  /** ສາງຕົ້ນທາງ (ບ່ອນທີ່ມີຂອງເຫຼືອ). */
  from: string[];
  /** ສາງປາຍທາງ (ບ່ອນທີ່ຂາດ). */
  to: string[];
  /** ຊ່ວງຍ້ອນຫຼັງທີ່ໃຊ້ຄິດຍອດຂາຍສະເລ່ຍ. */
  days: number;
  /** ຢາກໃຫ້ປາຍທາງມີຂອງພໍໃຊ້ກີ່ວັນ. */
  target_days: number;
  /** ຕົ້ນທາງຕ້ອງເຫຼືອໄວ້ໃຫ້ຕົນເອງຢ່າງໜ້ອຍກີ່ວັນ. */
  keep_days: number;
  /** ຄິດຄວາມຕ້ອງການຂອງປາຍທາງແບບລວມກຸ່ມ (ແນະນຳເມື່ອສາງຢູ່ບ່ອນດຽວກັນ). */
  group: boolean;
  /**
   * ຂ້າມສິນຄ້າທີ່ **ເຊົາຂາຍແລ້ວ** ໃນຊ່ວງຫຼ້າສຸດ (ເປີດໄວ້ເປັນຄ່າເລີ່ມຕົ້ນ).
   *
   * ວັດແທ້: 37% ຂອງຂໍ້ສະເໜີກ່ອນມີຕົວກອງນີ້ ເປັນສິນຄ້າທີ່ປາຍທາງບໍ່ໄດ້ຂາຍເລີຍ
   * ໃນ 30 ມື້ຫຼ້າສຸດ — ຂົນໄປກໍ່ໄປນອນຢູ່ບ່ອນໃໝ່ເທົ່ານັ້ນ.
   */
  skip_stopped: boolean;
  /**
   * ຂ້າມສິນຄ້າທີ່ຂາຍພຽງມື້ດຽວໃນຊ່ວງ — ຄ່າສະເລ່ຍຕໍ່ມື້ຂອງພວກນີ້ບໍ່ມີຄວາມໝາຍ.
   */
  skip_single: boolean;
};

/** ໂອນຂ້າມກຸ່ມ ຫຼື ຍ້າຍພາຍໃນກຸ່ມປາຍທາງ. */
export type SuggestionScope = "between" | "internal";

export type Suggestion = {
  scope: SuggestionScope;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_name: string | null;
  from_wh: string;
  to_wh: string;
  /** ຄົງເຫຼືອຕົ້ນທາງ ກ່ອນຍ້າຍ. */
  from_on_hand: number;
  from_days_cover: number | null;
  /** ຄົງເຫຼືອປາຍທາງ ກ່ອນຍ້າຍ. */
  to_on_hand: number;
  to_days_cover: number | null;
  to_avg_daily: number;
  /** ສະຖານະປາຍທາງ — ບອກຄວາມຮີບດ່ວນ. */
  urgency: "out" | "critical" | "low";
  /** ຈຳນວນທີ່ແນະນຳໃຫ້ຍ້າຍ. */
  move_qty: number;
  /** ຫົວໜ່ວຍໃຫຍ່ (ຫີບ/ມັດ/ຖົງ) — ໃຊ້ປັດຈຳນວນຕອນສ້າງໃບຂໍໂອນ. */
  pack: PackUnit | null;
  /** ມູນຄ່າໂດຍປະມານ (ຕົ້ນທຶນສະເລ່ຍ). */
  move_value: number;
  /** ວັນທີ່ພໍໃຊ້ຂອງປາຍທາງ ຫຼັງຍ້າຍ. */
  to_cover_after: number | null;
  /** ວັນທີ່ພໍໃຊ້ຂອງຕົ້ນທາງ ຫຼັງຍ້າຍ. */
  from_cover_after: number | null;
};

export type PairSummary = {
  scope: SuggestionScope;
  from_wh: string;
  from_name: string | null;
  to_wh: string;
  to_name: string | null;
  lines: number;
  qty: number;
  value: number;
};

export type RebalanceResult = {
  filter: RebalanceFilter;
  pairs: PairSummary[];
  suggestions: Suggestion[];
  /** ຈຳນວນລາຍການທີ່ຖືກຂ້າມຍ້ອນ ເຊົາຂາຍ / ຂາຍເທື່ອດຽວ — ບອກໄວ້ ບໍ່ໃຫ້ຫາຍງຽບ. */
  skipped_lines: number;
  /** ສາງທີ່ດຶງບໍ່ສຳເລັດ — ບອກໄວ້ ດີກວ່າສະແດງຜົນທີ່ຂາດໄປແບບງຽບໆ. */
  failed: string[];
  /**
   * ລາຍການທີ່ປາຍທາງຂາດ ແຕ່ຫາຕົ້ນທາງທີ່ມີເຫຼືອບໍ່ໄດ້ — ຕ້ອງສັ່ງຊື້ ບໍ່ແມ່ນໂອນ.
   * ນັບໄວ້ເພື່ອບໍ່ໃຫ້ເຂົ້າໃຈຜິດວ່າ "ໂອນແລ້ວຈົບ".
   */
  unmet_lines: number;
  unmet_value: number;
  /** ຈຳນວນລາຍການທີ່ກຸ່ມປາຍທາງມີພໍ ແຕ່ນອນຜິດສາງ (ມີສະເພາະໂໝດລວມກຸ່ມ). */
  internal_lines: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const cover = (onHand: number, avgDaily: number): number | null =>
  avgDaily > 0 ? Math.round((onHand / avgDaily) * 10) / 10 : null;

const RANK = { out: 0, critical: 1, low: 2 } as const;

function urgencyOf(onHand: number, daysCover: number | null): Suggestion["urgency"] {
  if (onHand <= 0) return "out";
  return (daysCover ?? 0) < 7 ? "critical" : "low";
}

/** ໂຫຼດ coverage ຂອງຫຼາຍສາງ — **ຕາມລຳດັບ** ເພື່ອບໍ່ໃຫ້ DB ແຍ່ງກັນ (ເບິ່ງ coverage.ts). */
async function coverageByWarehouse(
  codes: string[],
  days: number,
): Promise<{
  map: Map<string, Map<string, CoverageItem>>;
  names: Map<string, string | null>;
  failed: string[];
}> {
  const map = new Map<string, Map<string, CoverageItem>>();
  const names = new Map<string, string | null>();
  const failed: string[] = [];
  for (const code of codes) {
    try {
      const res = await loadCoverage(code, days);
      map.set(code, new Map(res.items.map((i) => [i.item_code, i])));
      names.set(code, res.warehouse?.wh_name ?? null);
    } catch {
      failed.push(code);
    }
  }
  return { map, names, failed };
}

/**
 * ຄິດຂໍ້ສະເໜີການໂອນ.
 *
 * ຈັດສັນແບບ greedy ຕາມຄວາມຮີບດ່ວນຂອງປາຍທາງ (ໝົດ → ວິກິດ → ສ່ຽງ) ແລ້ວດຶງຈາກ
 * ຕົ້ນທາງທີ່ມີເຫຼືອຫຼາຍສຸດກ່ອນ. ຕົ້ນທາງແຕ່ລະບ່ອນມີ "ໂຄຕາ" ຕໍ່ສິນຄ້າ ຊຶ່ງຖືກຫັກ
 * ລົງເມື່ອຖືກຈັດສັນ — ສາງດຽວກັນຈຶ່ງບໍ່ຖືກສັນຍາຂອງຊິ້ນດຽວກັນໃຫ້ 2 ປາຍທາງ.
 */
export async function loadRebalance(f: RebalanceFilter): Promise<RebalanceResult> {
  const src = await coverageByWarehouse(f.from, f.days);
  const dst = await coverageByWarehouse(f.to, f.days);

  // ── ໂຄຕາທີ່ຕົ້ນທາງແບ່ງໄດ້ ຕໍ່ (ສາງ × ສິນຄ້າ) — ຫັກລົງທຸກຄັ້ງທີ່ຈັດສັນ ──
  const spare = new Map<string, number>();
  const sk = (wh: string, item: string) => `${wh}::${item}`;
  for (const [wh, items] of src.map) {
    for (const [code, it] of items) {
      const free = it.on_hand - it.avg_daily * f.keep_days;
      if (free > 0) spare.set(sk(wh, code), free);
    }
  }

  /**
   * ຕົ້ນທຶນສຳຮອງ ຕໍ່ສິນຄ້າ.
   *
   * ສິນຄ້າທີ່ **ໝົດ** ຢູ່ປາຍທາງ ບໍ່ມີແຖວໃນຄົງເຫຼືອ ERP (ກອງ `balance_qty <> 0`)
   * ຈຶ່ງບໍ່ມີ `avg_cost` — ຖ້າບໍ່ຫາຈາກສາງອື່ນ ມູນຄ່າທີ່ສະແດງຈະເປັນ 0 ໝົດ ຊຶ່ງ
   * ເປັນຕົວເລກທີ່ຫຼອກຕາທີ່ສຸດ ເພາະລາຍການດ່ວນທີ່ສຸດ (ໝົດແລ້ວ) ຈະເບິ່ງຄືບໍ່ມີຄ່າ.
   */
  const costOf = new Map<string, number>();
  for (const m of [...src.map.values(), ...dst.map.values()]) {
    for (const [code, it] of m) {
      if (it.avg_cost > 0 && !costOf.has(code)) costOf.set(code, it.avg_cost);
    }
  }
  const unitCostOf = (it: CoverageItem): number =>
    it.avg_cost > 0 ? it.avg_cost : (costOf.get(it.item_code) ?? 0);

  const suggestions: Suggestion[] = [];
  let unmet_lines = 0;
  let unmet_value = 0;
  let internal_lines = 0;
  let skipped_lines = 0;

  /**
   * ສິນຄ້ານີ້ຄວນເອົາມາຄິດບໍ.
   *
   * ຄ່າສະເລ່ຍຕໍ່ມື້ຂອງສິນຄ້າທີ່ເຊົາຂາຍ ຫຼື ຂາຍເທື່ອດຽວ ບໍ່ໄດ້ສະທ້ອນຄວາມຕ້ອງການ
   * ຈິງ — ຖ້າປ່ອຍໃຫ້ຜ່ານ ຈະໄດ້ຄຳແນະນຳໃຫ້ຂົນຂອງໄປໃຫ້ບ່ອນທີ່ບໍ່ມີຄົນຊື້ແລ້ວ.
   */
  const usable = (it: CoverageItem): boolean => {
    if (f.skip_stopped && it.trend === "stopped") return false;
    if (f.skip_single && it.pattern === "single") return false;
    return true;
  };

  // ── ຂັ້ນ 1 (ສະເພາະໂໝດລວມກຸ່ມ): ຍ້າຍພາຍໃນກຸ່ມປາຍທາງກ່ອນ ──────────────
  //
  // ຂອງທີ່ນອນຜິດສາງ ຄວນຖືກຍ້າຍພາຍໃນບ່ອນດຽວກັນ ກ່ອນຈະໄປລົບກວນຕົ້ນທາງທາງໄກ.
  // ໂຄຕາພາຍໃນກຸ່ມແຍກຕ່າງຫາກ ເພາະນີ້ຄືຂອງຂອງກຸ່ມເອງ ບໍ່ແມ່ນຂອງຕົ້ນທາງ.
  const internalSpare = new Map<string, number>();
  if (f.group) {
    for (const [wh, items] of dst.map) {
      for (const [code, it] of items) {
        const free = it.on_hand - it.avg_daily * f.target_days;
        if (free > 0) internalSpare.set(sk(wh, code), free);
      }
    }

    type Need = { wh: string; it: CoverageItem; need: number };
    const internalNeeds: Need[] = [];
    for (const [wh, items] of dst.map) {
      for (const it of items.values()) {
        if (it.avg_daily <= 0) continue;
        if (!usable(it)) continue;
        const need = it.avg_daily * f.target_days - it.on_hand;
        if (need > 0) internalNeeds.push({ wh, it, need });
      }
    }
    internalNeeds.sort((a, b) => b.need * b.it.avg_cost - a.need * a.it.avg_cost);

    for (const n of internalNeeds) {
      let remaining = n.need;
      const donors = f.to
        .filter((wh) => wh !== n.wh)
        .map((wh) => ({ wh, free: internalSpare.get(sk(wh, n.it.item_code)) ?? 0 }))
        .filter((d) => d.free > 0)
        .sort((a, b) => b.free - a.free);

      for (const d of donors) {
        if (remaining <= 0) break;
        const si = dst.map.get(d.wh)?.get(n.it.item_code);
        if (!si) continue;
        const qty = Math.min(remaining, d.free);
        if (qty < 1) continue;

        internalSpare.set(sk(d.wh, n.it.item_code), d.free - qty);
        remaining -= qty;
        internal_lines += 1;

        const unitCost = unitCostOf(si) || unitCostOf(n.it);
        suggestions.push({
          scope: "internal",
          item_code: n.it.item_code,
          item_name: n.it.item_name ?? si.item_name,
          unit_code: n.it.unit_code ?? si.unit_code,
          group_name: n.it.group_name ?? si.group_name,
          from_wh: d.wh,
          to_wh: n.wh,
          from_on_hand: si.on_hand,
          from_days_cover: si.days_cover,
          to_on_hand: n.it.on_hand,
          to_days_cover: n.it.days_cover,
          to_avg_daily: n.it.avg_daily,
          urgency: urgencyOf(n.it.on_hand, n.it.days_cover),
          move_qty: r2(qty),
        pack: n.it.pack,
          move_value: Math.round(qty * unitCost),
          to_cover_after: cover(n.it.on_hand + qty, n.it.avg_daily),
          from_cover_after: cover(si.on_hand - qty, si.avg_daily),
        });
      }
    }
  }

  // ── ຂັ້ນ 2: ຄວາມຕ້ອງການທີ່ຍັງເຫຼືອ → ໂອນມາຈາກຕົ້ນທາງ ──────────────────
  //
  // ໂໝດລວມກຸ່ມ: ຄິດຄວາມຕ້ອງການ **ຕໍ່ກຸ່ມ** (ບວກຄົງເຫຼືອ ແລະ ຍອດຂາຍທຸກສາງ)
  // ແລ້ວຈຶ່ງເລືອກວ່າຄວນສົ່ງລົງສາງໃດ — ສາງທີ່ຂາດຫຼາຍສຸດ.
  // ໂໝດແຍກສາງ: ຄິດຕໍ່ສາງຄືເກົ່າ.
  type ExtNeed = {
    /** ສາງທີ່ຈະຮັບຂອງຈິງ. */
    wh: string;
    it: CoverageItem;
    need: number;
    urgency: Suggestion["urgency"];
  };
  const needs: ExtNeed[] = [];

  if (f.group) {
    // ລວມທຸກສາງປາຍທາງເປັນລາຍການດຽວຕໍ່ສິນຄ້າ
    const codes = new Set<string>();
    for (const items of dst.map.values()) for (const c of items.keys()) codes.add(c);

    for (const code of codes) {
      let onHand = 0;
      let avgDaily = 0;
      let best: { wh: string; it: CoverageItem; deficit: number } | null = null;

      let anyUsable = false;
      for (const wh of f.to) {
        const it = dst.map.get(wh)?.get(code);
        if (!it) continue;
        onHand += it.on_hand;
        avgDaily += it.avg_daily;
        if (it.avg_daily > 0 && usable(it)) anyUsable = true;
        // ສາງທີ່ຂາດຫຼາຍສຸດ (ທຽບກັບຄວາມໄວການຂາຍຂອງຕົນເອງ) ຄືບ່ອນທີ່ຄວນລົງຂອງ
        const deficit = it.avg_daily * f.target_days - it.on_hand;
        if (it.avg_daily > 0 && (!best || deficit > best.deficit)) best = { wh, it, deficit };
      }

      if (avgDaily <= 0 || !best) continue;
      // ທຸກສາງໃນກຸ່ມເຊົາຂາຍ/ຂາຍເທື່ອດຽວ → ບໍ່ຄວນຂົນມາເພີ່ມ
      if (!anyUsable) { skipped_lines += 1; continue; }
      const need = avgDaily * f.target_days - onHand;
      if (need <= 0) continue; // ກຸ່ມມີພໍແລ້ວ — ຖ້າຍັງນອນຜິດສາງ ຂັ້ນ 1 ຈັດການໄປແລ້ວ

      needs.push({
        wh: best.wh,
        it: best.it,
        need,
        urgency: urgencyOf(onHand, cover(onHand, avgDaily)),
      });
    }
  } else {
    for (const [wh, items] of dst.map) {
      for (const it of items.values()) {
        if (it.avg_daily <= 0) continue; // ບໍ່ມີການຂາຍ = ບໍ່ໃຊ່ການ rebalance
        const need = it.avg_daily * f.target_days - it.on_hand;
        if (need <= 0) continue;
        if (!usable(it)) { skipped_lines += 1; continue; }
        needs.push({ wh, it, need, urgency: urgencyOf(it.on_hand, it.days_cover) });
      }
    }
  }

  needs.sort(
    (a, b) =>
      RANK[a.urgency] - RANK[b.urgency] || b.need * b.it.avg_cost - a.need * a.it.avg_cost,
  );

  for (const n of needs) {
    let remaining = n.need;

    // ຕົ້ນທາງທີ່ມີເຫຼືອ ຮຽງຈາກມີຫຼາຍສຸດ — ດຶງຈາກບ່ອນທີ່ນອນຫຼາຍທີ່ສຸດກ່ອນ
    const donors = f.from
      .filter((wh) => wh !== n.wh)
      .map((wh) => ({ wh, free: spare.get(sk(wh, n.it.item_code)) ?? 0 }))
      .filter((d) => d.free > 0)
      .sort((a, b) => b.free - a.free);

    for (const d of donors) {
      if (remaining <= 0) break;
      const si = src.map.get(d.wh)?.get(n.it.item_code);
      if (!si) continue;

      const qty = Math.min(remaining, d.free);
      if (qty < 1) continue; // ຍ້າຍເສດໜ້ອຍກວ່າ 1 ໜ່ວຍ ບໍ່ຄຸ້ມຄ່າຂົນສົ່ງ

      spare.set(sk(d.wh, n.it.item_code), d.free - qty);
      remaining -= qty;

      const unitCost = unitCostOf(si) || unitCostOf(n.it);
      suggestions.push({
        scope: "between",
        item_code: n.it.item_code,
        item_name: n.it.item_name ?? si.item_name,
        unit_code: n.it.unit_code ?? si.unit_code,
        group_name: n.it.group_name ?? si.group_name,
        from_wh: d.wh,
        to_wh: n.wh,
        from_on_hand: si.on_hand,
        from_days_cover: si.days_cover,
        to_on_hand: n.it.on_hand,
        to_days_cover: n.it.days_cover,
        to_avg_daily: n.it.avg_daily,
        urgency: n.urgency,
        move_qty: r2(qty),
        pack: n.it.pack,
        move_value: Math.round(qty * unitCost),
        to_cover_after: cover(n.it.on_hand + qty, n.it.avg_daily),
        from_cover_after: cover(si.on_hand - qty, si.avg_daily),
      });
    }

    if (remaining > 0.999) {
      unmet_lines += 1;
      unmet_value += remaining * unitCostOf(n.it);
    }
  }

  // ── ສະຫຼຸບເປັນຄູ່ ຕົ້ນທາງ → ປາຍທາງ (ໜຶ່ງຄູ່ = ໜຶ່ງໃບຂໍໂອນ) ──────────────
  const pairMap = new Map<string, PairSummary>();
  for (const s of suggestions) {
    const k = `${s.scope}|${s.from_wh}>${s.to_wh}`;
    let p = pairMap.get(k);
    if (!p) {
      p = {
        scope: s.scope,
        from_wh: s.from_wh,
        from_name: (s.scope === "internal" ? dst.names : src.names).get(s.from_wh) ?? null,
        to_wh: s.to_wh,
        to_name: dst.names.get(s.to_wh) ?? null,
        lines: 0, qty: 0, value: 0,
      };
      pairMap.set(k, p);
    }
    p.lines += 1;
    p.qty += s.move_qty;
    p.value += s.move_value;
  }

  const pairs = [...pairMap.values()]
    .map((p) => ({ ...p, qty: r2(p.qty) }))
    // ຍ້າຍພາຍໃນກຸ່ມຂຶ້ນກ່ອນ — ເຮັດງ່າຍກວ່າ ແລະ ຄວນເຮັດກ່ອນຂໍໂອນທາງໄກ
    .sort((a, b) =>
      a.scope === b.scope ? b.value - a.value : a.scope === "internal" ? -1 : 1,
    );

  suggestions.sort(
    (a, b) => RANK[a.urgency] - RANK[b.urgency] || b.move_value - a.move_value,
  );

  return {
    filter: f,
    pairs,
    suggestions,
    skipped_lines,
    failed: [...src.failed, ...dst.failed],
    unmet_lines,
    unmet_value: Math.round(unmet_value),
    internal_lines,
  };
}
