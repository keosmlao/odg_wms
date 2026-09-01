/**
 * ຂັ້ນຕອນຂອງໃບຂໍໂອນ — logic ບໍລິສຸດ ບໍ່ແຕະຖານຂໍ້ມູນ ແລະ ບໍ່ແມ່ນ React.
 *
 * ດຶງອອກມາຈາກໜ້າ transfer-dashboard ເພື່ອໃຫ້ທົດສອບໄດ້. ນີ້ຄື logic ທີ່ຕັດສິນ
 * ວ່າໃບໜຶ່ງ "ຢູ່ຂັ້ນໃດ" ແລະ "ຍົກເລີກໄດ້ບໍ່" — ຜິດເມື່ອໃດ ຄົນຈະເຫັນສະຖານະຜິດ
 * ຫຼື ຍົກເລີກໃບທີ່ຈ່າຍອອກໄປແລ້ວ.
 */

export type NodeState = "done" | "partial" | "current" | "pending" | "rejected";

/** ຂໍ້ມູນຂັ້ນຕ່ຳທີ່ຕ້ອງການ — ຮັບເປັນ string ຄືທີ່ API ສົ່ງມາ. */
export type TransferRow = {
  status: number | null;
  req: string | number;
  to_transit: string | number;
  in_transit: string | number;
  received: string | number;
};

/** ຂັ້ນຕອນ — ບໍ່ມີ "ອະນຸມັດ" ອີກຕໍ່ໄປ (ໃບຂໍໂອນຈ່າຍໄດ້ເລີຍ). */
export const STAGES = [
  { key: "req", label: "ຂໍ", icon: "📝" },
  { key: "issue", label: "ຈ່າຍ→ກາງ", icon: "📤" },
  { key: "transit", label: "ຄ້າງທາງ", icon: "🚚" },
  { key: "recv", label: "ຮັບເຂົ້າ", icon: "📥" },
] as const;

/** ຄ່າຄວາມຄາດເຄື່ອນທີ່ຍອມຮັບໄດ້ ສຳລັບການທຽບຈຳນວນ (ຫຼີກຄວາມຜິດຂອງທົດນິຍົມ). */
const EPS = 1e-6;

const num = (v: string | number | null | undefined): number => {
  const x = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

export type TransferTrack = {
  req: number;
  toT: number;
  inT: number;
  rcv: number;
  st: number;
  rejected: boolean;
  done: boolean;
  states: NodeState[];
  /** index ໃນ STAGES; 4 = ສຳເລັດ, -1 = ຍົກເລີກ */
  current: number;
};

export function track(d: TransferRow): TransferTrack {
  const req = num(d.req);
  const toT = num(d.to_transit);
  const inT = num(d.in_transit);
  const rcv = num(d.received);
  const st = d.status ?? 0;
  const rejected = st === 2;
  const done = req > 0 && rcv + EPS >= req;
  const full = (v: number) => req > 0 && v + EPS >= req;

  // ① ຂໍ ② ຈ່າຍ→ກາງ ③ ຄ້າງທາງ ④ ຮັບເຂົ້າ
  //
  // status ໃຊ້ຢູ່ຈຸດດຽວ — 2 = ຍົກເລີກແລ້ວ ຊຶ່ງກັນການຈ່າຍ (ຄືກັບທີ່
  // /api/movements/issue/pending ກັນໄວ້). ສ່ວນ 0 ກັບ 1 ຄືກັນໝົດ.
  const states: NodeState[] = [
    "done",
    rejected ? "rejected" : full(toT) ? "done" : toT > EPS ? "partial" : "current",
    done ? "done" : inT > EPS ? "current" : "pending",
    done ? "done" : rcv > EPS ? "partial" : "pending",
  ];

  let current = 1;
  if (done) current = 4;
  else if (rejected) current = -1;
  else if (inT > EPS) current = 2;

  return { req, toT, inT, rcv, st, rejected, done, states, current };
}

/**
 * ຍົກເລີກໄດ້ບໍ່.
 *
 * ເງື່ອນໄຂດຽວກັບທີ່ API ບັງຄັບ (/api/movements/transfer-cancel): ພໍຈ່າຍອອກ
 * ໄປແລ້ວແມ່ນຂອງຍ້າຍໄປສາງລະຫວ່າງທາງຈິງ — ການໝາຍວ່າຍົກເລີກຈະເຮັດໃຫ້ຂອງນັ້ນ
 * ຫາຍໄປຈາກທຸກລາຍການທັງທີ່ຍັງຢູ່ເທິງລົດ. ກໍລະນີນັ້ນຕ້ອງໃຊ້ "ຮັບຄືນ".
 */
export function canCancel(t: TransferTrack): boolean {
  return !t.done && !t.rejected && t.toT <= EPS;
}
