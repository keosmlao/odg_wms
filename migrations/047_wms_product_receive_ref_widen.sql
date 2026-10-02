------------------------------------------------------------
-- 047: ຂະຫຍາຍ wms_product_receive_ref.ref_doc_no (50 → 80)
--
-- ບັນຫາ: ສ້າງໃບກວດນັບຈາກໃບ packing ລົ້ມເຫຼວດ້ວຍ
-- "value too long for type character varying(50)" — ຕົ້ນທາງຂອງຄ່ານີ້ຄື
-- wms_packing_list.ref_no (varchar(80), ຂໍ້ຄວາມອ້າງອີງອິດສະຫຼະ ບໍ່ແມ່ນລະຫັດສັ້ນ
-- ແບບ PO) ຖືກຄັດລອກໄປໃສ່ wms_product_receive_ref.ref_doc_no ຕອນ
-- /api/receive/count ແລະ /api/receive (ເບິ່ງ src/app/api/receive/count/route.ts,
-- src/app/api/receive/route.ts, src/app/api/receive/count/[doc]/post/route.ts)
-- ຊຶ່ງແຄບກວ່າ (varchar(50)) ຈຶ່ງລົ້ມເຫຼວທັນທີທີ່ຄ່າ ref_no ຍາວເກີນ 50 ໂຕ —
-- ບໍ່ແມ່ນຂໍ້ມູນຜິດ, ແມ່ນ column ປາຍທາງແຄບກວ່າ column ຕົ້ນທາງ.
--
-- ແກ້ໂດຍຂະຫຍາຍໃຫ້ເທົ່າກັບ wms_packing_list.ref_no ເພື່ອບໍ່ໃຫ້ຄ່າທີ່ຖືກຕ້ອງ
-- (≤80 ໂຕ) ຕົກໄປອີກ.
------------------------------------------------------------

ALTER TABLE public.wms_product_receive_ref
  ALTER COLUMN ref_doc_no TYPE varchar(80);
