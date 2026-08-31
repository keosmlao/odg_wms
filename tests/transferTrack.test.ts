import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STAGES, canCancel, track, type TransferRow } from "../src/lib/transferTrack.ts";

/**
 * ຂັ້ນຕອນຂອງໃບຂໍໂອນ ແລະ ເງື່ອນໄຂການຍົກເລີກ.
 *
 * `canCancel` ສຳຄັນທີ່ສຸດ: ຖ້າມັນຄືນ true ໃຫ້ໃບທີ່ຈ່າຍອອກໄປແລ້ວ ຂອງທີ່ຍັງຢູ່
 * ເທິງລົດຈະຫາຍໄປຈາກທຸກລາຍການ. API ບັງຄັບເງື່ອນໄຂດຽວກັນຢູ່ຝັ່ງ server —
 * ການທົດສອບນີ້ກັນຝັ່ງໜ້າຈໍບໍ່ໃຫ້ສະແດງປຸ່ມທີ່ server ຈະປະຕິເສດຢູ່ແລ້ວ.
 */

const row = (over: Partial<TransferRow> = {}): TransferRow => ({
  status: 0,
  req: "10",
  to_transit: "0",
  in_transit: "0",
  received: "0",
  ...over,
});

describe("track — ຂັ້ນຕອນ", () => {
  test("ຫາກໍ່ຂໍ ຍັງບໍ່ໄດ້ຈ່າຍ → ຢູ່ຂັ້ນ ຈ່າຍ→ກາງ", () => {
    const t = track(row());
    assert.equal(t.current, 1);
    assert.equal(STAGES.at(t.current)?.label, "ຈ່າຍ→ກາງ");
    assert.equal(t.states[1], "current");
  });

  test("ບໍ່ມີຂັ້ນ ອະນຸມັດ ອີກຕໍ່ໄປ — ມີ 4 ຂັ້ນ", () => {
    assert.equal(STAGES.length, 4);
    assert.deepEqual(STAGES.map((s) => s.label), ["ຂໍ", "ຈ່າຍ→ກາງ", "ຄ້າງທາງ", "ຮັບເຂົ້າ"]);
  });

  test("status 0 ກັບ 1 ໃຫ້ຜົນຄືກັນ (ການອະນຸມັດບໍ່ມີຜົນແລ້ວ)", () => {
    const a = track(row({ status: 0 }));
    const b = track(row({ status: 1 }));
    assert.deepEqual(a.states, b.states);
    assert.equal(a.current, b.current);
  });

  test("ຈ່າຍອອກບາງສ່ວນ → ຂັ້ນຈ່າຍເປັນ partial", () => {
    const t = track(row({ to_transit: "4", in_transit: "4" }));
    assert.equal(t.states[1], "partial");
  });

  test("ຈ່າຍຄົບ ຂອງຢູ່ໃນທາງ → ຢູ່ຂັ້ນ ຄ້າງທາງ", () => {
    const t = track(row({ to_transit: "10", in_transit: "10" }));
    assert.equal(t.current, 2);
    assert.equal(STAGES.at(t.current)?.label, "ຄ້າງທາງ");
    assert.equal(t.states[1], "done");
  });

  test("ຮັບຄົບ → ສຳເລັດ", () => {
    const t = track(row({ to_transit: "10", received: "10" }));
    assert.equal(t.done, true);
    assert.equal(t.current, 4, "4 = ນອກ STAGES → ໜ້າຈໍໃຊ້ປ້າຍ ສຳເລັດ ແທນ");
    assert.equal(STAGES.at(t.current), undefined);
  });

  test("ຍົກເລີກ (status 2) → current = -1 ແລະ ຂັ້ນຈ່າຍເປັນ rejected", () => {
    const t = track(row({ status: 2 }));
    assert.equal(t.rejected, true);
    assert.equal(t.current, -1);
    assert.equal(t.states[1], "rejected");
  });

  test("ຮັບເກີນເລັກນ້ອຍ (ຄວາມຜິດທົດນິຍົມ) ຍັງນັບເປັນສຳເລັດ", () => {
    const t = track(row({ req: "10", received: "9.9999999" }));
    assert.equal(t.done, true);
  });

  test("ຈຳນວນຂໍເປັນ 0 → ບໍ່ນັບເປັນສຳເລັດ", () => {
    const t = track(row({ req: "0", received: "0" }));
    assert.equal(t.done, false, "ໃບເປົ່າບໍ່ຄວນສະແດງວ່າສຳເລັດ");
  });

  test("ຮັບຄ່າເປັນ string ຫຼື number ກໍ່ໄດ້", () => {
    assert.deepEqual(track(row({ req: 10 })).req, track(row({ req: "10" })).req);
  });

  test("ຄ່າທີ່ອ່ານບໍ່ອອກ → 0 ບໍ່ແມ່ນ NaN", () => {
    const t = track(row({ req: "—", received: "" }));
    assert.equal(t.req, 0);
    assert.equal(t.rcv, 0);
  });
});

describe("canCancel", () => {
  test("ຍັງບໍ່ໄດ້ຈ່າຍ → ຍົກເລີກໄດ້", () => {
    assert.equal(canCancel(track(row())), true);
  });

  test("ຈ່າຍອອກໄປແລ້ວແມ່ນແຕ່ໜ່ວຍດຽວ → ຍົກເລີກບໍ່ໄດ້", () => {
    assert.equal(
      canCancel(track(row({ to_transit: "1", in_transit: "1" }))),
      false,
      "ຂອງຢູ່ສາງລະຫວ່າງທາງແລ້ວ — ຕ້ອງໃຊ້ ຮັບຄືນ",
    );
  });

  test("ສຳເລັດແລ້ວ → ຍົກເລີກບໍ່ໄດ້", () => {
    assert.equal(canCancel(track(row({ to_transit: "10", received: "10" }))), false);
  });

  test("ຍົກເລີກໄປແລ້ວ → ບໍ່ສະແດງປຸ່ມອີກ", () => {
    assert.equal(canCancel(track(row({ status: 2 }))), false);
  });
});
