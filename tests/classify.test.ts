import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAbc,
  classifyFsn,
  type AbcClass,
  type FsnClass,
} from "../src/lib/classify.ts";

/**
 * ABC / FSN — ຊັ້ນເຫຼົ່ານີ້ຈະຖືກໃຊ້ຕັດສິນ **ຄວາມຖີ່ການນັບ** ແລະ **ບ່ອນວາງເຄື່ອງ**
 * ຕໍ່ໄປ. ຖ້າຂອບເຂດເລື່ອນ ສິນຄ້າຊັ້ນ A ຈະຖືກນັບໜ້ອຍລົງໂດຍບໍ່ມີໃຜສັງເກດ.
 */

const it = (sale_amount: number, bills = 0) => ({
  sale_amount,
  bills,
  abc: "none" as AbcClass,
  fsn: "N" as FsnClass,
});

describe("classifyAbc", () => {
  test("ຕົວທີ່ຂາຍຫຼາຍທີ່ສຸດຈົນຮອດ 80% ຂອງມູນຄ່າ = A", () => {
    // 80 + 15 + 5 = 100. ສະສົມ: 0.80 → A, 0.95 → B, 1.00 → C
    const items = [it(15), it(80), it(5)];
    classifyAbc(items);
    assert.equal(items[1].abc, "A", "80/100 = 0.80 ຢູ່ໃນຂອບເຂດ A ພໍດີ");
    assert.equal(items[0].abc, "B", "0.95 ຢູ່ໃນຂອບເຂດ B ພໍດີ");
    assert.equal(items[2].abc, "C");
  });

  test("ຂອບເຂດເປັນແບບ ≤ ບໍ່ແມ່ນ < — ຕົວທີ່ຢູ່ 0.80 ພໍດີຍັງເປັນ A", () => {
    const items = [it(8), it(2)];
    classifyAbc(items);
    assert.equal(items[0].abc, "A");
  });

  test("ສິນຄ້າທີ່ບໍ່ມີການຂາຍ ບໍ່ຖືກຈັດຊັ້ນ", () => {
    const items = [it(100), it(0), it(-5)];
    classifyAbc(items);
    assert.equal(items[1].abc, "none");
    assert.equal(items[2].abc, "none", "ມູນຄ່າຕິດລົບ (ຮັບຄືນ) ກໍ່ບໍ່ຈັດຊັ້ນ");
  });

  test("ບໍ່ມີການຂາຍເລີຍ → ບໍ່ພັງ ແລະ ບໍ່ຈັດຊັ້ນໃຜ", () => {
    const items = [it(0), it(0)];
    classifyAbc(items);
    assert.deepEqual(items.map((i) => i.abc), ["none", "none"]);
  });

  test("ລາຍການວ່າງ → ບໍ່ພັງ", () => {
    assert.deepEqual(classifyAbc([]), []);
  });

  test("ສິນຄ້າດຽວທີ່ຂາຍ → ເປັນ A", () => {
    const items = [it(500)];
    classifyAbc(items);
    assert.equal(items[0].abc, "A");
  });

  test("ຄືນ array ອັນດຽວກັນ (ແກ້ໃນບ່ອນ) ຄືພຶດຕິກຳເດີມ", () => {
    const items = [it(10)];
    assert.equal(classifyAbc(items), items);
  });
});

describe("classifyFsn", () => {
  test("ກຸ່ມທີ່ລວມກັນເປັນ 70% ທຳອິດຂອງຈຳນວນບິນ = F", () => {
    // 70 + 30 = 100 → ຕົວທຳອິດຮອດ 0.70 ພໍດີ = F, ຕົວທີສອງ = S
    const items = [it(0, 30), it(0, 70)];
    classifyFsn(items);
    assert.equal(items[1].fsn, "F");
    assert.equal(items[0].fsn, "S");
  });

  test("ສິນຄ້າທີ່ບໍ່ມີບິນເລີຍ ຄົງເປັນ N", () => {
    const items = [it(0, 10), it(0, 0)];
    classifyFsn(items);
    assert.equal(items[1].fsn, "N", "N ຖືກຕັ້ງໄວ້ກ່ອນແລ້ວ — function ນີ້ບໍ່ຄວນແຕະ");
  });

  test("ບໍ່ມີການເຄື່ອນໄຫວເລີຍ → ບໍ່ພັງ", () => {
    const items = [it(0, 0)];
    classifyFsn(items);
    assert.equal(items[0].fsn, "N");
  });
});

describe("ABC ກັບ FSN ເປັນອິດສະລະຕໍ່ກັນ", () => {
  test("ຂາຍມູນຄ່າສູງແຕ່ບິນໜ້ອຍ = A + S (ຂອງແພງທີ່ຂາຍນານໆເທື່ອ)", () => {
    const items = [it(1000, 1), it(10, 99)];
    classifyAbc(items);
    classifyFsn(items);
    assert.equal(items[0].abc, "A");
    assert.equal(items[0].fsn, "S", "ມູນຄ່າສູງ ບໍ່ໄດ້ແປວ່າເຄື່ອນໄຫວໄວ");
    assert.equal(items[1].fsn, "F");
  });
});
