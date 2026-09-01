------------------------------------------------------------
-- 045: index ສຳລັບການລວມຍອດຕໍ່ສິນຄ້າ
--
-- ໜ້າ "ຈຳນວນຄາດການ" (ແລະ ໜ້າອື່ນທີ່ຖາມວ່າ "ສິນຄ້ານີ້ມີເທົ່າໃດ ໃນສາງໃດແດ່")
-- ຕ້ອງລວມ SUM(qty*calc_flag) ຕໍ່ (ສິນຄ້າ × ສາງ). odg_wms_trans_detail ມີ index
-- ຕາມ doc_ref ແລະ trans_flag ແລ້ວ (migration 044) ແຕ່ບໍ່ມີອັນທີ່ເລີ່ມດ້ວຍ
-- item_code — ການຖາມຕໍ່ສິນຄ້າຈຶ່ງຕ້ອງສະແກນທັງຕາຕະລາງ 309k ແຖວ.
--
-- ຢູ່ production ສ້າງດ້ວຍ CREATE INDEX CONCURRENTLY (ຕາຕະລາງນີ້ຖືກຂຽນຢູ່ຕະຫຼອດ
-- ໂດຍຫຼາຍກວ່າໜຶ່ງແອັບ ຈຶ່ງລັອກບໍ່ໄດ້). ໄຟລ໌ນີ້ໃຊ້ແບບທຳມະດາ ເພາະ migration
-- runner ຫຸ້ມ BEGIN/COMMIT — ຢູ່ເຄື່ອງ production ຈຶ່ງເປັນ no-op (IF NOT EXISTS).
------------------------------------------------------------

CREATE INDEX IF NOT EXISTS odg_wms_trans_detail_item_wh_idx
  ON public.odg_wms_trans_detail (item_code, wh_code);

COMMENT ON INDEX public.odg_wms_trans_detail_item_wh_idx
  IS 'ລວມຍອດຕໍ່ (ສິນຄ້າ × ສາງ) — ໃຊ້ໂດຍ ຈຳນວນຄາດການ ແລະ ການຄົ້ນຫາລະດັບສິນຄ້າ.';
