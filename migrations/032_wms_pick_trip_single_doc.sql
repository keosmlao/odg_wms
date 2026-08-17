------------------------------------------------------------
-- 032: ໃບຈັດຖ້ຽວ → ໃບສັ່ງຈ່າຍ "ໃບດຽວ" ຕໍ່ 1 ຖ້ຽວ
--
-- ເດີມ (031) ດຶງຖ້ຽວແລ້ວຕັດເປັນໃບ pick ຕໍ່ບິນ (ຫຼາຍໃບ). ຄົນເກັບຕ້ອງການ
-- "ໃບດຽວ" ຕໍ່ຖ້ຽວ — ເກັບເທື່ອດຽວ, ພິມໃບດຽວ, ຢືນຢັນເທື່ອດຽວ.
--
-- ແຕ່ຝັ່ງ ERP ຍັງຕ້ອງແຍກຕໍ່ບິນ (ໜຶ່ງບິນ = ໜຶ່ງໃບຈ່າຍ ERP) ຈຶ່ງຫັກຄ້າງຈ່າຍ
-- ແລະ post ຖືກ. ດັ່ງນັ້ນ ຈຶ່ງເກັບ "ບິນຕົ້ນທາງ" ໄວ້ລະດັບ *ແຖວ* ຂອງໃບ pick:
--
--   wms_product_out_detail.ref_doc_no = ເລກບິນຂາຍຂອງແຖວນັ້ນ
--     · NULL = ໃບແບບເກົ່າ (1 ໃບ 1 ບິນ) → ໃຊ້ header.ref_doc_no ຄືເກົ່າ
--     · ບໍ່ NULL = ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) → ຕອນຢືນຢັນ ຈະ post ແຍກຕໍ່ບິນ
--
-- ແບບດຽວກັນກັບ migration 023 ທີ່ເຮັດໃຫ້ໃບກວດນັບ 1 ໃບ ຮັບໄດ້ຫຼາຍ PO.
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

ALTER TABLE public.wms_product_out_detail
  ADD COLUMN IF NOT EXISTS ref_doc_no varchar(50);

CREATE INDEX IF NOT EXISTS idx_wms_prod_out_detail_ref
  ON public.wms_product_out_detail (ref_doc_no)
  WHERE ref_doc_no IS NOT NULL;

-- ໃບຖ້ຽວດຽວ = 1 ແຖວ / 1 ໃບ pick, bill_no ເປັນ NULL (ບິນຢູ່ລະດັບແຖວແທນ).
ALTER TABLE public.wms_pick_trip ALTER COLUMN bill_no DROP NOT NULL;
