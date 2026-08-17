------------------------------------------------------------
-- 024: WMS packing list (ໃບ packing) — the start of goods receipt
--
-- ຂັ້ນຕອນ: ໃບ packing (import Excel, ແນບ PDF) → ກວດສອບ (ສິນຄ້າ/PO/ອະນຸມັດ)
--          → ໃບກວດນັບ (wms_product_receive doc_type=2) → ຮັບເຂົ້າ WMS
--
-- WMS-owned tables — ບໍ່ແຕະ odg_packing_list ຂອງ ERP (ອ່ານໄດ້ຢ່າງດຽວ).
-- ໄຟລ໌ຕົ້ນສະບັບ (Excel/PDF) ເກັບເປັນ bytea ເພື່ອເປັນຫຼັກຖານອ້າງອີງ.
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_packing_list (
  roworder             bigserial PRIMARY KEY,
  doc_no               varchar(40) NOT NULL,   -- PK<YYMMDD>-<seq5>
  doc_date             date NOT NULL,          -- ວັນທີ່ສາງກຳນົດຮັບ
  wh_code              varchar(20) NOT NULL,   -- ສາງທີ່ຮັບເຂົ້າ
  ref_no               varchar(80),            -- ເລກໃບ packing ຕົ້ນສະບັບ (ຈາກ PDF/Excel)
  supplier_code        varchar(40),
  supplier_name        varchar(200),
  -- status: 0 = ນຳເຂົ້າແລ້ວ (draft) · 1 = ກວດສອບຜ່ານ (ພ້ອມກວດນັບ)
  --         5 = ສ້າງໃບກວດນັບແລ້ວ · 9 = ຍົກເລີກ
  status               smallint NOT NULL DEFAULT 0,
  line_count           int NOT NULL DEFAULT 0,
  total_qty            numeric NOT NULL DEFAULT 0,
  error_count          int NOT NULL DEFAULT 0,  -- ແຖວທີ່ບລັອກ (PO ບໍ່ອະນຸມັດ ຯລຯ)
  warn_count           int NOT NULL DEFAULT 0,  -- ແຖວທີ່ເຕືອນ
  remark               varchar(255),
  count_doc_no         varchar(40),             -- ໃບກວດນັບທີ່ສ້າງຈາກໃບນີ້
  creator_code         varchar(40),
  verify_code          varchar(40),
  verify_datetime      timestamp,
  create_date_time_now timestamp DEFAULT now()
);

-- ລຳດັບເລກເອກະສານແຍກຕ່າງຫາກ ເພື່ອບໍ່ໃຫ້ເລກໃບຂ້າມ (roworder ຖືກໃຊ້ຕອນ insert ແລ້ວ)
CREATE SEQUENCE IF NOT EXISTS public.wms_packing_list_doc_seq;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_packing_list_doc ON public.wms_packing_list (doc_no);
CREATE INDEX IF NOT EXISTS idx_wms_packing_list_wh_date ON public.wms_packing_list (wh_code, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_wms_packing_list_status ON public.wms_packing_list (status);

-- ໄຟລ໌ຕົ້ນສະບັບທີ່ອ້າງອີງ (Excel ທີ່ parse + PDF ທີ່ແນບ). 1 ໃບ → ຫຼາຍໄຟລ໌.
CREATE TABLE IF NOT EXISTS public.wms_packing_list_file (
  roworder             bigserial PRIMARY KEY,
  doc_no               varchar(40) NOT NULL,
  kind                 smallint NOT NULL DEFAULT 1, -- 1 = excel (parsed) · 2 = pdf/ອື່ນໆ (ແນບ)
  file_name            varchar(255),
  mime_type            varchar(120),
  file_size            int,
  content              bytea,
  uploader_code        varchar(40),
  create_date_time_now timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_packing_list_file_doc ON public.wms_packing_list_file (doc_no);

CREATE TABLE IF NOT EXISTS public.wms_packing_list_detail (
  roworder             bigserial PRIMARY KEY,
  doc_no               varchar(40) NOT NULL,
  line_order           int,
  src_row              int,                     -- ແຖວໃນໄຟລ໌ຕົ້ນສະບັບ
  po_no                varchar(40),             -- ໃບສັ່ງຊື້ທີ່ອ້າງອີງ
  item_code            varchar(40),             -- ລະຫັດທີ່ match ໄດ້ (NULL = ບໍ່ພົບ)
  raw_item_code        varchar(120),            -- ຕາມທີ່ຂຽນໃນໄຟລ໌
  item_name            varchar(255),
  unit_code            varchar(20),
  qty                  numeric NOT NULL DEFAULT 0,
  -- check_status: 0 = ຜ່ານ · 1 = ເຕືອນ · 2 = ບລັອກ
  check_status         smallint NOT NULL DEFAULT 0,
  check_note           varchar(400),
  create_date_time_now timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_packing_list_detail_doc ON public.wms_packing_list_detail (doc_no);
CREATE INDEX IF NOT EXISTS idx_wms_packing_list_detail_po ON public.wms_packing_list_detail (po_no);

-- ໃບກວດນັບ/ໃບຮັບ ອ້າງກັບຄືນຫາໃບ packing ຂອງ WMS.
ALTER TABLE public.wms_product_receive
  ADD COLUMN IF NOT EXISTS packing_doc_no varchar(40);

CREATE INDEX IF NOT EXISTS idx_wms_product_receive_packing
  ON public.wms_product_receive (packing_doc_no);
