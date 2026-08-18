------------------------------------------------------------
-- 038: ຕາຕະລາງເຫດຜົນການເຄື່ອນຍ້າຍບໍ່ຄົບ (odg_wms_move_note)
--
-- ບັນຫາ: ໜ້າຮັບ/ຈ່າຍ/ຮັບຄືນ ໃຫ້ຜູ້ໃຊ້ເລືອກເຫດຜົນເມື່ອຍ້າຍໄດ້ບໍ່ຄົບຈຳນວນ
-- (ເສຍຫາຍ / ຂາດ / ສົ່ງຜິດ / ປະຕິເສດ / ທະຍອຍຮັບ) ແຕ່ຕາຕະລາງປາຍທາງ
-- **ບໍ່ເຄີຍຖືກສ້າງໃນ DB ນີ້** — DDL ຢູ່ໃນ migrations/apply.mjs ເຊິ່ງເປັນສະຄຣິບ
-- ຄັ້ງດຽວຂອງງານເກົ່າ ບໍ່ໄດ້ run. ໂຄດຝັ່ງບັນທຶກຫຸ້ມ INSERT ໄວ້ດ້ວຍ try/catch ເປົ່າ
-- ຈຶ່ງ **ຖິ້ມເຫດຜົນງຽບໆ ທຸກເທື່ອ** ໂດຍບໍ່ມີ error ໃຫ້ໃຜເຫັນ.
--
-- ຫຼັງ migration ນີ້ ໂຄດຈະບໍ່ກືນ error ອີກ (ເບິ່ງ src/lib/moveReasons.ts) —
-- ບັນທຶກບໍ່ໄດ້ = ການເຄື່ອນຍ້າຍ rollback ທັງໜ່ວຍ ດີກວ່າໄດ້ຕົວເລກທີ່ບໍ່ມີເຫດຜົນ.
--
-- ໂຄງສ້າງຢືນຕາມ DDL ເດີມໃນ apply.mjs ທຸກປະການ ເພື່ອໃຫ້ DB ທີ່ເຄີຍ run
-- ສະຄຣິບນັ້ນແລ້ວ ຜ່ານ migration ນີ້ໄດ້ໂດຍບໍ່ຕ້ອງແກ້ຫຍັງ (CREATE IF NOT EXISTS).
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_move_note (
  roworder     bigserial PRIMARY KEY,
  doc_no       varchar(40),
  ref_doc      varchar(40),
  item_code    varchar(40),
  reason_code  varchar(20),
  reason_text  varchar(200),
  short_qty    numeric,
  stage        varchar(20),
  user_created varchar(40),
  created_at   timestamp DEFAULT now()
);

COMMENT ON TABLE public.odg_wms_move_note
  IS 'ເຫດຜົນເມື່ອເຄື່ອນຍ້າຍໄດ້ບໍ່ຄົບຈຳນວນ — 1 ແຖວ ຕໍ່ (ເອກະສານ, ສິນຄ້າ).';
COMMENT ON COLUMN public.odg_wms_move_note.doc_no  IS 'ເອກະສານ WMS (DP) ທີ່ອອກ';
COMMENT ON COLUMN public.odg_wms_move_note.ref_doc IS 'ເອກະສານຕົ້ນທາງ (124 / ໃບສັ່ງ)';
COMMENT ON COLUMN public.odg_wms_move_note.stage   IS 'receive | return | issue';
COMMENT ON COLUMN public.odg_wms_move_note.short_qty IS 'ຈຳນວນທີ່ຂາດໄປ (ຕາມໜ່ວຍຂອງເອກະສານ)';

-- ອ່ານຕາມເອກະສານ 2 ທາງ: ໜ້າລາຍລະອຽດຈ່າຍ (doc_no) ແລະ ໜ້າໃບຂໍໂອນ (ref_doc).
CREATE INDEX IF NOT EXISTS idx_odg_wms_move_note_doc
  ON public.odg_wms_move_note (doc_no);
CREATE INDEX IF NOT EXISTS idx_odg_wms_move_note_ref
  ON public.odg_wms_move_note (ref_doc, item_code, created_at DESC);
