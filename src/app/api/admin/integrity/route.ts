import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";

/**
 * ກວດຄວາມສົມບູນຂອງບັນຊີ stock (odg_wms_trans / odg_wms_trans_detail).
 *
 * ເປັນຫຍັງຕ້ອງມີ: ຕາຕະລາງເຫຼົ່ານີ້ **ບໍ່ມີ foreign key ຈັກອັນ** ແລະ ຖືກຂຽນໂດຍ
 * ຫຼາຍກວ່າໜຶ່ງແອັບ (trans_flag 2 ມີ 230,000+ ແຖວ ທີ່ບໍ່ມີໂຄ້ດໃນ repo ນີ້ສ້າງ).
 * ດັ່ງນັ້ນຄວາມຜິດປົກກະຕິຈຶ່ງບໍ່ຖືກກັນຢູ່ຊັ້ນຂຽນ — ຕ້ອງໄປພົບມັນຢູ່ຊັ້ນອ່ານແທນ.
 *
 * ໜ້ານີ້ບໍ່ໄດ້ແກ້ຫຍັງ ມັນພຽງແຕ່ **ນັບ** ແລ້ວບອກວ່າແຕ່ລະຢ່າງໝາຍຄວາມວ່າຫຍັງ.
 * ການແກ້ຂໍ້ມູນເກົ່າຕ້ອງເປັນການຕັດສິນໃຈຂອງຄົນ ບໍ່ແມ່ນຂອງລາຍງານ.
 *
 * ໜັກພໍສົມຄວນ (ສະແກນ 300k+ ແຖວ) ຈຶ່ງ cache ໄວ້ 10 ນາທີ.
 */
export type IntegrityCheck = {
  key: string;
  label: string;
  /** ອະທິບາຍວ່າຕົວເລກນີ້ໝາຍຄວາມວ່າຫຍັງ ແລະ ເປັນຫຍັງຈຶ່ງສຳຄັນ. */
  meaning: string;
  count: number;
  /** ຄ່າທີ່ຄວນເປັນ — ເກືອບທັງໝົດຄວນເປັນ 0. */
  expect: number;
  severity: "error" | "warn" | "info";
};

type Payload = { checks: IntegrityCheck[]; computed_at: number };

const TTL_MS = 10 * 60 * 1000;
const cache = ((globalThis as unknown as { __wmsIntegrityCache?: Payload })
  .__wmsIntegrityCache ??= undefined as unknown as Payload);

let store: Payload | undefined = cache;

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  if (store && Date.now() - store.computed_at < TTL_MS) {
    return NextResponse.json({ ...store, cached: true });
  }

  const [orphan, emptyHead, badQty, dupes, negBins, unknownItem, stalePick, noLoc] = await Promise.all([
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.odg_wms_trans_detail d
        WHERE NOT EXISTS (SELECT 1 FROM public.odg_wms_trans h WHERE h.doc_no = d.doc_no)`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.odg_wms_trans h
        WHERE NOT EXISTS (SELECT 1 FROM public.odg_wms_trans_detail d WHERE d.doc_no = h.doc_no)`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.odg_wms_trans_detail
        WHERE qty IS NULL OR qty < 0 OR calc_flag NOT IN (1, -1)`,
    ),
    query<{ n: string }>(
      `SELECT COALESCE(SUM(n - 1), 0)::text AS n FROM (
         SELECT count(*) AS n FROM public.odg_wms_trans_detail
          GROUP BY doc_no, item_code, qty, calc_flag, trans_flag, wh_code,
                   COALESCE(shelf_code, ''), COALESCE(shelf_code1, ''), COALESCE(pallet, '')
         HAVING count(*) > 1
       ) x`,
    ),
    query<{ n: string }>(
      `WITH bal AS (
         SELECT SUM(qty * calc_flag) AS q FROM public.odg_wms_trans_detail
          WHERE item_code IS NOT NULL AND item_code <> ''
          GROUP BY wh_code, COALESCE(NULLIF(TRIM(shelf_code), ''), ''),
                   COALESCE(NULLIF(TRIM(shelf_code1), ''), ''),
                   COALESCE(NULLIF(TRIM(pallet), ''), ''), item_code
       )
       SELECT count(*)::text AS n FROM bal WHERE q < -0.0001`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.odg_wms_trans_detail d
        WHERE d.item_code IS NOT NULL AND TRIM(d.item_code) <> ''
          AND NOT EXISTS (SELECT 1 FROM public.ic_inventory i WHERE i.code = d.item_code)`,
    ),
    // ໃບ pick ທີ່ສ້າງໄວ້ແລ້ວລືມ — ຂອງທີ່ມັນຈອງໄວ້ຖືກຫັກອອກຈາກ "ຄ້າງຈ່າຍ" ຕະຫຼອດ
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wms_product_out
        WHERE COALESCE(status, 0) = 0 AND doc_date < CURRENT_DATE - 7`,
    ),
    // ຂອງທີ່ມີຢູ່ແຕ່ບໍ່ຮູ້ວ່າຢູ່ບ່ອນໃດ — ສັ່ງຄົນໄປຢິບບໍ່ໄດ້
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT wh_code, item_code, SUM(qty * calc_flag) AS q
           FROM public.odg_wms_trans_detail
          WHERE COALESCE(NULLIF(TRIM(shelf_code1), ''), '') = ''
          GROUP BY 1, 2
       ) x WHERE q > 0.0001`,
    ),
  ]);

  const n = (r: { n: string }[]) => Number.parseInt(r[0]?.n ?? "0", 10) || 0;

  const checks: IntegrityCheck[] = [
    {
      key: "negative_bins",
      label: "ບ່ອນເກັບທີ່ຍອດຕິດລົບ",
      meaning:
        "ຈ່າຍອອກຫຼາຍກວ່າທີ່ເຄີຍຮັບເຂົ້າ — ເປັນໄປບໍ່ໄດ້ໃນຄວາມຈິງ. ແປວ່າມີການເຄື່ອນໄຫວທີ່ບໍ່ໄດ້ບັນທຶກ, ບັນທຶກຜິດບ່ອນ ຫຼື ຂອງທີ່ມີຢູ່ກ່ອນເປີດລະບົບຍັງບໍ່ໄດ້ຕັ້ງຍອດຍົກມາ.",
      count: n(negBins),
      expect: 0,
      severity: "error",
    },
    {
      key: "bad_qty",
      label: "ແຖວທີ່ຈຳນວນ ຫຼື ທິດທາງຜິດຮູບແບບ",
      meaning:
        "ຕາມຂໍ້ຕົກລົງ qty ຕ້ອງເປັນບວກສະເໝີ ແລະ ທິດທາງມາຈາກ calc_flag (+1 ເຂົ້າ, −1 ອອກ). ແຖວທີ່ເກັບ qty ຕິດລົບເຮັດໃຫ້ລາຍງານທີ່ບວກ qty ໂດຍບໍ່ຄູນ calc_flag ໄດ້ຕົວເລກຜິດ.",
      count: n(badQty),
      expect: 0,
      severity: "error",
    },
    {
      key: "orphan_detail",
      label: "ແຖວລາຍລະອຽດທີ່ບໍ່ມີຫົວເອກະສານ",
      meaning:
        "stock ຍ້າຍແລ້ວແຕ່ບໍ່ມີເອກະສານກຳກັບ — ຕາມຮອຍບໍ່ໄດ້ວ່າໃຜເຮັດ ດ້ວຍເອກະສານໃດ.",
      count: n(orphan),
      expect: 0,
      severity: "warn",
    },
    {
      key: "empty_header",
      label: "ຫົວເອກະສານທີ່ບໍ່ມີລາຍລະອຽດ",
      meaning:
        "ມີເອກະສານແຕ່ບໍ່ມີການເຄື່ອນໄຫວຈັກແຖວ — ມັກເກີດຈາກລາຍການທີ່ຖືກຍົກເລີກແຕ່ລຶບບໍ່ໝົດ. ບໍ່ກະທົບຍອດ ແຕ່ເຮັດໃຫ້ການນັບເອກະສານຜິດ.",
      count: n(emptyHead),
      expect: 0,
      severity: "warn",
    },
    {
      key: "duplicate_rows",
      label: "ແຖວທີ່ຊ້ຳກັນທຸກປະການ",
      meaning:
        "ແຖວດຽວກັນເປັ໊ະຖືກບັນທຶກຫຼາຍກວ່າໜຶ່ງເທື່ອ. ຖ້າມັນເປັນຄູ່ຍ້າຍບ່ອນ (ເຂົ້າ+ອອກ) ຍອດຈະຍັງຖືກ ແຕ່ປະຫວັດຈະສັບສົນ; ຖ້າເປັນຂາດຽວ ຍອດຈະຜິດ.",
      count: n(dupes),
      expect: 0,
      severity: "warn",
    },
    {
      key: "stale_pick",
      label: "ໃບ pick ຄ້າງຢືນຢັນເກີນ 7 ມື້",
      meaning:
        "ໃບຈັດເຄື່ອງທີ່ສ້າງໄວ້ແລ້ວລືມ. ຂອງທີ່ມັນຈອງໄວ້ຖືກຫັກອອກຈາກ “ຄ້າງຈ່າຍ” ຕະຫຼອດ — ວຽກຈິງຈຶ່ງຫາຍໄປຈາກລາຍການໂດຍທີ່ບໍ່ມີໃຜເຮັດ. ໃຫ້ໄປຢືນຢັນຈ່າຍ ຫຼື ລຶບໃບນັ້ນຖິ້ມ.",
      count: n(stalePick),
      expect: 0,
      severity: "warn",
    },
    {
      key: "stock_without_location",
      label: "ຂອງທີ່ມີ stock ແຕ່ບໍ່ຮູ້ບ່ອນເກັບ",
      meaning:
        "ຍອດບອກວ່າມີຂອງ ແຕ່ບໍ່ມີລະຫັດບ່ອນເກັບ — ສັ່ງຄົນໄປຢິບບໍ່ໄດ້ ແລະ ໃບ pick ຈະສະແດງວ່າ “ບໍ່ພໍ stock” ທັງທີ່ຂອງມີຢູ່. ແກ້ດ້ວຍການນັບແລ້ວປັບປຸງເຂົ້າບ່ອນເກັບຈິງ.",
      count: n(noLoc),
      expect: 0,
      severity: "warn",
    },
    {
      key: "unknown_item",
      label: "ແຖວທີ່ລະຫັດສິນຄ້າບໍ່ມີໃນທະບຽນສິນຄ້າ",
      meaning:
        "ບັນທຶກການເຄື່ອນໄຫວຂອງສິນຄ້າທີ່ ERP ບໍ່ຮູ້ຈັກ — ມັກມາຈາກລະຫັດພິມຜິດ ຫຼື ສິນຄ້າທີ່ຖືກລຶບພາຍຫຼັງ.",
      count: n(unknownItem),
      expect: 0,
      severity: "info",
    },
  ];

  store = { checks, computed_at: Date.now() };
  (globalThis as unknown as { __wmsIntegrityCache?: Payload }).__wmsIntegrityCache = store;
  return NextResponse.json({ ...store, cached: false });
}
