------------------------------------------------------------
-- 044: index ສຳລັບລາຍການ "ຄ້າງຈ່າຍ"
--
-- ອາການ: ສະຫຼັບ tab ປະເພດເອກະສານຢູ່ໜ້າຈ່າຍສິນຄ້າຊ້າ. ວັດແລ້ວ (8 ສາງ, 90 ມື້):
--   ບິນຂາຍ 1,867ms · ໃບຂໍເບີກ 280ms · ໃບຂໍໂອນ 235ms
--
-- ສາເຫດຈາກ EXPLAIN ANALYZE:
--   1) odg_wms_trans_detail (309k ແຖວ) **ມີແຕ່ primary key** — ບໍ່ມີ index ອື່ນເລີຍ.
--      CTE `issued` ຈຶ່ງ Parallel Seq Scan ທັງຕາຕະລາງ ຖິ້ມ 103k ແຖວຕໍ່ worker
--      ເພື່ອຫາແຖວທີ່ຕົງພຽງ 6 ແຖວ.
--   2) ic_trans_detail (1.4M ແຖວ) ມີ index ຫຼາຍອັນ ແຕ່ບໍ່ມີອັນໃດຄຸມ
--      (trans_flag, wh_code, doc_date) ພ້ອມກັນ — planner ຈຶ່ງໃຊ້ index doc_date
--      ຢ່າງດຽວ ແລ້ວ filter ສ່ວນທີ່ເຫຼືອ.
--
-- ຫຼັງໃສ່ index: ບິນຂາຍ 446ms · ໃບຂໍເບີກ 19ms · ໃບຂໍໂອນ 20ms
--
-- ໝາຍເຫດການນຳໃຊ້ຈິງ: ຢູ່ production ສ້າງດ້ວຍ CREATE INDEX **CONCURRENTLY**
-- (ic_trans_detail ໃຫຍ່ 3.4GB ແລະ ເປັນຕາຕະລາງແມ່ຂອງ ERP ທີ່ແອັບອື່ນ ~10 ໂຕ
-- ຂຽນຢູ່ — ລັອກມັນກາງເວລາເຮັດວຽກບໍ່ໄດ້). ໄຟລ໌ນີ້ໃຊ້ແບບທຳມະດາ ເພາະ migration
-- runner ຫຸ້ມ BEGIN/COMMIT ແລະ CONCURRENTLY ຢູ່ໃນ transaction ບໍ່ໄດ້ —
-- ຢູ່ເຄື່ອງ production ມັນຈຶ່ງເປັນ no-op (IF NOT EXISTS) ແລະ ຢູ່ DB ໃໝ່/ວ່າງ
-- ການລັອກບໍ່ມີຜົນ.
------------------------------------------------------------

CREATE INDEX IF NOT EXISTS odg_wms_trans_detail_issue_lookup_idx
  ON public.odg_wms_trans_detail (trans_flag, calc_flag, doc_ref);

COMMENT ON INDEX public.odg_wms_trans_detail_issue_lookup_idx
  IS 'ຫາຈຳນວນທີ່ WMS ຈ່າຍໄປແລ້ວຕໍ່ເອກະສານຕົ້ນທາງ (CTE issued ຂອງ /api/movements/issue/pending).';

CREATE INDEX IF NOT EXISTS ic_trans_detail_flag_wh_date_idx
  ON public.ic_trans_detail (trans_flag, wh_code, doc_date);

COMMENT ON INDEX public.ic_trans_detail_flag_wh_date_idx
  IS 'ຄັດເອກະສານຄ້າງຕາມ ປະເພດ + ສາງ + ວັນທີ (CTE src ຂອງ /api/movements/issue/pending).';
