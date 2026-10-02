------------------------------------------------------------
-- 046: ປິດບິນຄ້າງຈ່າຍອອກ (wms_issue_close)
--
-- ບາງບິນ (ຂາຍ/ຂໍເບີກ/ຂໍໂອນ) ຄ້າງຢູ່ "ລາຍການຄ້າງຈ່າຍ" ທັງທີ່ຕົວຈິງຈັດການ
-- ໄປແລ້ວນອກ WMS (ຕົວຢ່າງ: ເປີດບິນໄປແລ້ວຮັບຄືນບໍ່ໄດ້ ຕ້ອງຈ່າຍອອກ, ຫຼື ຈ່າຍອອກ
-- ຄົບແລ້ວແຕ່ຂໍ້ມູນຍັງຄ້າງ) — ບໍ່ມີທາງເອົາອອກຈາກລາຍການນອກຈາກແກ້ຂໍ້ມູນຕົ້ນທາງ
-- (ic_trans) ໂດຍກົງ. ຕາຕະລາງນີ້ໃຫ້ "ປິດງານ" ແທນ: ເຊື່ອງອອກຈາກລາຍການຄ້າງຈ່າຍ
-- ພ້ອມເຫດຜົນ, ໂດຍບໍ່ແຕະຕ້ອງເອກະສານຕົ້ນທາງ.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_issue_close (
  roworder     bigserial PRIMARY KEY,
  doc_no       varchar(40) NOT NULL,
  wh_code      varchar(20) NOT NULL,
  trans_flag   int NOT NULL,
  reason_code  varchar(20) NOT NULL,
  reason_text  varchar(200),
  user_created varchar(40),
  created_at   timestamp DEFAULT now()
);

COMMENT ON TABLE public.wms_issue_close
  IS 'ປິດບິນຄ້າງຈ່າຍອອກ (ເຊື່ອງອອກຈາກລາຍການຄ້າງ) ພ້ອມເຫດຜົນ — ບໍ່ແຕະຕ້ອງ ic_trans ຕົ້ນທາງ. 1 ແຖວ ຕໍ່ (ເອກະສານ, ສາງ).';
COMMENT ON COLUMN public.wms_issue_close.doc_no     IS 'ເອກະສານຕົ້ນທາງ (ic_trans.doc_no) ທີ່ຖືກປິດ';
COMMENT ON COLUMN public.wms_issue_close.wh_code    IS 'ສາງທີ່ປິດ (ບິນໜຶ່ງໃບອາດອອກຫຼາຍສາງ, ປິດແຍກຕໍ່ສາງ)';
COMMENT ON COLUMN public.wms_issue_close.trans_flag IS '44=ບິນຂາຍ, 122=ຂໍເບີກ, 124=ຂໍໂອນ';
COMMENT ON COLUMN public.wms_issue_close.reason_code IS 'ລະຫັດເຫດຜົນ — ເບິ່ງ src/lib/issueClose.ts';

-- ປິດຊ້ຳໃບ/ສາງດຽວກັນ = ອັບເດດເຫດຜົນ (ON CONFLICT DO UPDATE), ບໍ່ແມ່ນແຖວຊ້ຳ.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_issue_close_doc_wh
  ON public.wms_issue_close (doc_no, wh_code);
