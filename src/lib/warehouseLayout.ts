/**
 * ຜັງພື້ນທີ່ສາງ (2D / 3D) — ຮູບຮ່າງຈິງຂອງພື້ນສາງ.
 *
 * odg_wms_location1 ບອກ **ຂະໜາດ** ຂອງແຕ່ລະບ່ອນເກັບ ແຕ່ບໍ່ບອກ **ຕຳແໜ່ງ** ວ່າຢູ່
 * ຈຸດໃດຂອງພື້ນ. ພິກັດຈຶ່ງເກັບແຍກໃນ odg_wms_layout_* (migration 036).
 *
 * ຫົວໜ່ວຍເປັນ ຊມ. ໝົດ, (0,0) = ມູມເທິງ-ຊ້າຍ, x ໄປຂວາ, y ລົງລຸ່ມ.
 * ໄຟລ໌ນີ້ບໍ່ import pg ຈຶ່ງໃຊ້ໄດ້ທັງຝັ່ງ server ແລະ client.
 */

export type LayoutShapeKind = "location" | "zone";

export type LayoutShape = {
  kind: LayoutShapeKind;
  /** kind=location → odg_wms_location1.code ; kind=zone → ລະຫັດເຂດ */
  code: string;
  label: string | null;
  x: number;
  y: number;
  w: number;
  d: number;
  /** ຄວາມສູງສຳລັບ 3D (ຊມ.). 0 ຫຼື null = ແປພື້ນ ບໍ່ຍົກເປັນກ້ອນ. */
  h: number | null;
  color: string | null;
  sort: number;
};

export type WarehouseLayout = {
  whCode: string;
  width: number;
  depth: number;
  shapes: LayoutShape[];
  /** db = ມີຜັງບັນທຶກໄວ້ ; auto = ສ້າງໃຫ້ຊົ່ວຄາວຈາກລາຍການ rack/location */
  source: "db" | "auto";
};

/** ສະຖານະສະຕັອກຂອງ 1 ບ່ອນເກັບ ທີ່ເອົາໄປໃສ່ສີເທິງຜັງ (2D ແລະ 3D ໃຊ້ຮ່ວມກັນ). */
export type PlanCell = {
  rackCode: string;
  locationCode: string;
  name: string | null;
  qty: number;
  itemCount: number;
  /** % ເຕັມ (ປະລິມາດ ຫຼື ພາເລດ). null = ຄິດບໍ່ໄດ້ເພາະຂາດຂະໜາດສິນຄ້າ. */
  pct: number | null;
  negative: boolean;
};

/** ຂໍ້ມູນນ້ອຍທີ່ສຸດທີ່ຕ້ອງມີເພື່ອສ້າງຜັງອັດຕະໂນມັດ. */
export type AutoLayoutRack = {
  code: string;
  name: string | null;
  locations: { code: string; name: string | null; widthCm: number | null; lengthCm: number | null; heightCm: number | null }[];
};

const DEFAULT_W = 400;
const DEFAULT_D = 400;
const DEFAULT_H = 500;
const GAP_X = 60;
const AISLE_Y = 300;
const MARGIN = 200;

/** ສີປະຈຳ rack ເມື່ອບໍ່ໄດ້ກຳນົດໄວ້ — ວົນຊ້ຳຕາມລຳດັບ rack. */
const RACK_COLORS = ["#ef4444", "#e8b48f", "#aebfe8", "#f5b731", "#fbe94b", "#4caf7d", "#a78bfa", "#38bdf8"];

/**
 * ຜັງສຳຮອງສຳລັບສາງທີ່ຍັງບໍ່ໄດ້ວາງພິກັດ: rack ລະ 1 ແຖວ, ວາງ location ຈາກຊ້າຍ
 * ໄປຂວາຕາມຄວາມກວ້າງຈິງຂອງມັນ. ບໍ່ແມ່ນຮູບຮ່າງຈິງຂອງອາຄານ ແຕ່ຢ່າງໜ້ອຍທຸກຂະໜາດ
 * ຖືກຕ້ອງ ແລະ ຜູ້ຈັດການລາກຈັດຕໍ່ໄດ້ເລີຍ.
 */
export function autoLayout(whCode: string, racks: AutoLayoutRack[]): WarehouseLayout {
  const shapes: LayoutShape[] = [];
  let y = MARGIN;
  let maxRight = 0;
  let sort = 0;

  racks.forEach((rack, rackIndex) => {
    if (rack.locations.length === 0) return;
    const color = RACK_COLORS[rackIndex % RACK_COLORS.length];
    let x = MARGIN;
    let rowDepth = 0;
    for (const loc of rack.locations) {
      const w = loc.widthCm && loc.widthCm > 0 ? loc.widthCm : DEFAULT_W;
      const d = loc.lengthCm && loc.lengthCm > 0 ? loc.lengthCm : DEFAULT_D;
      shapes.push({
        kind: "location",
        code: loc.code,
        label: loc.name ?? loc.code,
        x,
        y,
        w,
        d,
        h: loc.heightCm && loc.heightCm > 0 ? loc.heightCm : DEFAULT_H,
        color,
        sort: sort++,
      });
      x += w + GAP_X;
      if (d > rowDepth) rowDepth = d;
    }
    maxRight = Math.max(maxRight, x - GAP_X);
    y += rowDepth + AISLE_Y;
  });

  return {
    whCode,
    width: Math.max(maxRight + MARGIN, 1000),
    depth: Math.max(y - AISLE_Y + MARGIN, 1000),
    shapes,
    source: "auto",
  };
}

/**
 * ສີຕາມຄວາມແໜ້ນ — **ຊຸດສີດຽວກັນກັບ 3D ຂອງສາງ 1201** (heatColor ໃນ
 * Warehouse3D.tsx) ເພື່ອໃຫ້ທັງໜ້າອ່ານສີແບບດຽວກັນ: ຫວ່າງ = ເທົາຟ້າ, ແລ້ວ
 * ຂຽວ → ເຫຼືອງ → ສົ້ມ → ແດງ ຕາມທີ່ເຕັມຂຶ້ນ. ຖ້າແກ້ ໃຫ້ແກ້ພ້ອມກັນທັງສອງບ່ອນ.
 */
export function heatColor(opts: { pct: number | null; empty: boolean; negative: boolean }): string {
  if (opts.negative) return "#dc2626";
  if (opts.empty) return "#94a3b8";
  const p = opts.pct ?? 0;
  if (p >= 100) return "#e11d48";
  if (p >= 75) return "#f97316";
  if (p >= 50) return "#f59e0b";
  if (p >= 25) return "#eab308";
  return "#22c55e";
}

/** ຄຳອະທິບາຍສີ — ຄືກັນກັບ LEGEND ຂອງ 3D ສາງ 1201. */
export const HEAT_LEGEND: { label: string; color: string }[] = [
  { label: "ຫວ່າງ", color: "#94a3b8" },
  { label: "ໜ້ອຍ", color: "#22c55e" },
  { label: "ປານກາງ", color: "#eab308" },
  { label: "ໃກ້ເຕັມ", color: "#f97316" },
  { label: "ເຕັມ 100%", color: "#e11d48" },
  { label: "ຕິດລົບ", color: "#dc2626" },
];

/** ຊມ. → ແມັດ ສຳລັບປ້າຍ ແລະ ສາກ 3D. */
export function cmToM(cm: number): number {
  return cm / 100;
}

export function formatMeters(cm: number): string {
  return `${(cm / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ມ`;
}
