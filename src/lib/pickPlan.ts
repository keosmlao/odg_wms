/**
 * ການວາງແຜນຈັດເຄື່ອງ (pick plan) — ໃຊ້ຮ່ວມກັນລະຫວ່າງໜ້າ desktop ແລະ ໜ້າມືຖື.
 *
 * ຍ້າຍອອກມາຈາກ PickClient ເພື່ອໃຫ້ສອງໜ້າຄິດຄືກັນແທ້ໆ — ຖ້າແຍກກັນ ລຳດັບການຍ່າງ
 * ເກັບຂອງເທິງມືຖືກັບເທິງເຈ້ຍພິມຈະບໍ່ຕົງກັນ ຊຶ່ງເປັນບັນຫາໃນສາງ.
 */
export type PickLoc = { rack: string; location: string; pallet: string; qty: string };

export type PickSrcLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  is_isn: number | null;
  src_qty: string;
  remaining: string;
  locations: PickLoc[];
};

export type PickDocLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  remaining: string;
};

export type PickPendingDoc = {
  doc_no: string;
  wh_code: string;
  doc_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  line_count: number;
  remaining_qty: string;
  lines: PickDocLine[];
};

export type PickTask = {
  key: string;
  sortKey: string;
  loc: string;
  barcode: string;
  rack: string;
  pallet: string;
  item_code: string;
  item_name: string | null;
  unit: string | null;
  qty: number;
  short: boolean;
};

/** ປະເພດເອກະສານຕົ້ນທາງ ພ້ອມ trans_flag ຂອງ ERP. */
export const PICK_TYPES = [
  { v: "req", label: "ໃບຂໍເບີກ", flag: 122 },
  { v: "transfer", label: "ໃບຂໍໂອນ", flag: 124 },
  { v: "sale", label: "ບິນຂາຍ", flag: 44 },
];

/**
 * Greedy pick allocation: fill each line's remaining qty from its locations
 * (smallest location code first), then order all tasks by location so the
 * picker walks the aisles once instead of doubling back.
 */
export function buildPlan(lines: PickSrcLine[]): PickTask[] {
  const tasks: PickTask[] = [];
  for (const l of lines) {
    let need = Number.parseFloat(l.remaining) || 0;
    const locs = [...l.locations].sort((a, b) =>
      (a.location || a.rack).localeCompare(b.location || b.rack),
    );
    for (const loc of locs) {
      if (need <= 0.0001) break;
      const avail = Number.parseFloat(loc.qty) || 0;
      const take = Math.min(need, avail);
      if (take <= 0.0001) continue;
      const label =
        [loc.rack, loc.location, loc.pallet].filter(Boolean).join(" / ") || "(ສາງ)";
      tasks.push({
        key: `${l.item_code}@${loc.location}@${loc.pallet}`,
        sortKey: loc.location || loc.rack || "~",
        loc: label,
        barcode: loc.location || loc.rack || loc.pallet || "",
        rack: loc.rack,
        pallet: loc.pallet,
        item_code: l.item_code,
        item_name: l.item_name,
        unit: l.unit_code,
        qty: take,
        short: false,
      });
      need -= take;
    }
    if (need > 0.0001) {
      tasks.push({
        key: `${l.item_code}@short`,
        sortKey: "~~~",
        loc: "⚠ ບໍ່ພໍ stock",
        barcode: "",
        rack: "",
        pallet: "",
        item_code: l.item_code,
        item_name: l.item_name,
        unit: l.unit_code,
        qty: need,
        short: true,
      });
    }
  }
  return tasks.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export function fmtQty(v: string | number) {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
