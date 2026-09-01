import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, fmtQty, type PickSrcLine } from "../src/lib/pickPlan.ts";

/**
 * ການຈັດສັນ pick — ນີ້ຄື logic ທີ່ຕັດສິນວ່າ **ຫຍັງຈະອອກຈາກສາງຈິງ**
 * ແລະ ຄົນຈະຍ່າງໄປບ່ອນໃດກ່ອນ. ຜິດເມື່ອໃດ = ຈ່າຍຜິດບ່ອນ ຜິດຈຳນວນ.
 */

const line = (over: Partial<PickSrcLine> = {}): PickSrcLine => ({
  item_code: "IT-1",
  item_name: "ສິນຄ້າ 1",
  unit_code: "ຕົວ",
  is_isn: null,
  src_qty: "10",
  remaining: "10",
  locations: [],
  ...over,
});

const loc = (location: string, qty: string, rack = "A", pallet = "") => ({
  rack,
  location,
  pallet,
  qty,
});

describe("buildPlan — ການຈັດສັນຕາມບ່ອນເກັບ", () => {
  test("ບ່ອນດຽວພຽງພໍ → ຈັດແຖວດຽວ ຄົບຈຳນວນ", () => {
    const tasks = buildPlan([line({ remaining: "6", locations: [loc("A01", "10")] })]);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].qty, 6);
    assert.equal(tasks[0].short, false);
    assert.equal(tasks[0].barcode, "A01");
  });

  test("ບ່ອນດຽວບໍ່ພໍ → ແບ່ງໄປບ່ອນຕໍ່ໄປ ຈົນຄົບ", () => {
    const tasks = buildPlan([
      line({ remaining: "10", locations: [loc("A01", "4"), loc("A02", "9")] }),
    ]);
    const real = tasks.filter((t) => !t.short);
    assert.equal(real.length, 2);
    assert.equal(
      real.reduce((s, t) => s + t.qty, 0),
      10,
      "ຈຳນວນລວມທີ່ຈັດໄດ້ຕ້ອງເທົ່າກັບຈຳນວນທີ່ຕ້ອງການ",
    );
    assert.equal(real[0].qty, 4);
    assert.equal(real[1].qty, 6, "ບ່ອນທີສອງເອົາສະເພາະສ່ວນທີ່ຍັງຂາດ ບໍ່ແມ່ນເອົາໝົດ");
  });

  test("stock ທັງໝົດບໍ່ພໍ → ມີແຖວ short ບອກສ່ວນທີ່ຂາດ", () => {
    const tasks = buildPlan([
      line({ remaining: "10", locations: [loc("A01", "3")] }),
    ]);
    const short = tasks.filter((t) => t.short);
    assert.equal(short.length, 1);
    assert.equal(short[0].qty, 7, "ສ່ວນທີ່ຂາດຕ້ອງເປັນ 10 − 3");
  });

  test("ບໍ່ມີ stock ເລີຍ → ເປັນ short ທັງໝົດ ບໍ່ແມ່ນລາຍການວ່າງ", () => {
    const tasks = buildPlan([line({ remaining: "5", locations: [] })]);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].short, true);
    assert.equal(tasks[0].qty, 5);
  });

  test("ບ່ອນທີ່ມີ 0 ຖືກຂ້າມ ບໍ່ສ້າງແຖວວ່າງ", () => {
    const tasks = buildPlan([
      line({ remaining: "5", locations: [loc("A01", "0"), loc("A02", "5")] }),
    ]);
    const real = tasks.filter((t) => !t.short);
    assert.equal(real.length, 1);
    assert.equal(real[0].barcode, "A02");
  });

  test("ຈຳນວນທີ່ຕ້ອງການເປັນ 0 → ບໍ່ມີວຽກ", () => {
    const tasks = buildPlan([line({ remaining: "0", locations: [loc("A01", "9")] })]);
    assert.equal(tasks.length, 0);
  });
});

describe("buildPlan — ລຳດັບການຍ່າງ", () => {
  test("ຮຽງຕາມລະຫັດບ່ອນເກັບ ບໍ່ແມ່ນຕາມລຳດັບສິນຄ້າ", () => {
    const tasks = buildPlan([
      line({ item_code: "IT-1", remaining: "1", locations: [loc("C03", "5")] }),
      line({ item_code: "IT-2", remaining: "1", locations: [loc("A01", "5")] }),
      line({ item_code: "IT-3", remaining: "1", locations: [loc("B02", "5")] }),
    ]);
    assert.deepEqual(
      tasks.map((t) => t.barcode),
      ["A01", "B02", "C03"],
      "ຄົນເກັບຕ້ອງຍ່າງຜ່ານແຖວດຽວ ບໍ່ແມ່ນຍ່າງກັບໄປກັບມາ",
    );
  });

  test("ແຖວ short ຖືກດັນໄປທ້າຍສຸດ", () => {
    const tasks = buildPlan([
      line({ item_code: "IT-1", remaining: "9", locations: [loc("A01", "1")] }),
      line({ item_code: "IT-2", remaining: "1", locations: [loc("Z99", "5")] }),
    ]);
    assert.equal(tasks.at(-1)?.short, true, "ສິ່ງທີ່ເກັບບໍ່ໄດ້ບໍ່ຄວນຂັດຈັງຫວະການຍ່າງ");
  });

  test("ບ່ອນເກັບພາຍໃນສິນຄ້າດຽວກັນ ຮຽງຈາກນ້ອຍໄປໃຫຍ່ (FIFO ຕາມລະຫັດ)", () => {
    const tasks = buildPlan([
      line({ remaining: "8", locations: [loc("B05", "4"), loc("A02", "4")] }),
    ]);
    assert.deepEqual(tasks.map((t) => t.barcode), ["A02", "B05"]);
  });
});

describe("buildPlan — ປ້າຍບ່ອນເກັບ", () => {
  test("ລວມ rack / location / pallet ດ້ວຍ /", () => {
    const tasks = buildPlan([
      line({ remaining: "1", locations: [{ rack: "A", location: "A01", pallet: "P1", qty: "5" }] }),
    ]);
    assert.equal(tasks[0].loc, "A / A01 / P1");
  });

  test("ບໍ່ມີຂໍ້ມູນບ່ອນເກັບເລີຍ → ສະແດງວ່າ (ສາງ)", () => {
    const tasks = buildPlan([
      line({ remaining: "1", locations: [{ rack: "", location: "", pallet: "", qty: "5" }] }),
    ]);
    assert.equal(tasks[0].loc, "(ສາງ)");
  });
});

describe("fmtQty", () => {
  test("ໃສ່ຈຸດຂັ້ນຫຼັກພັນ", () => {
    assert.equal(fmtQty(1234567), "1,234,567");
  });
  test("ຮັບ string ໄດ້", () => {
    assert.equal(fmtQty("42"), "42");
  });
  test("ຄ່າທີ່ບໍ່ແມ່ນຕົວເລກ → 0 ບໍ່ແມ່ນ NaN", () => {
    assert.equal(fmtQty("—"), "0");
  });
});
