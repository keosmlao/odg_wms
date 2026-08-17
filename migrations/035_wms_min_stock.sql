------------------------------------------------------------
-- 035: stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ ຕໍ່ສິນຄ້າ ຕໍ່ສາງ
--
-- ຄວາມຕ້ອງການ: ສາງຂົວຫຼວງ (ແລະ ສາງອື່ນທີ່ເລືອກ) ຕ້ອງກຳນົດ stock ຂັ້ນຕ່ຳ
-- ເພື່ອເຕືອນກ່ອນສິນຄ້າຂາດ, ພ້ອມຂັ້ນສູງເພື່ອກັນສັ່ງເກີນ.
--
-- 3 ຢ່າງ:
--   1) odg_wms_warehouse_config.min_stock — ເປີດ/ປິດ ຕໍ່ສາງ. ຄ່າເລີ່ມຕົ້ນ FALSE
--      ເພາະສາງສ່ວນຫຼາຍຍັງບໍ່ໄດ້ວາງແຜນ min/max — ເປີດສະເພາະສາງທີ່ຕັ້ງຄ່າແລ້ວ
--      ບໍ່ດັ່ງນັ້ນ ທຸກສາງຈະຂຶ້ນ "ຕ່ຳກວ່າຂັ້ນຕ່ຳ 0" ໝົດ ແລະ ການເຕືອນຈະໄຮ້ຄວາມໝາຍ.
--      (ຕ່າງຈາກ flag SN ໃນ 019/020 ທີ່ default TRUE ເພື່ອຮັກສາພຶດຕິກຳເກົ່າ.)
--   2) odg_wms_min_stock — ຄ່າ min/max ຕໍ່ (ສາງ, ສິນຄ້າ). ບໍ່ມີແຖວ = ບໍ່ຄຸມ.
--   3) odg_wms_email_report.incl_min_stock — section ໃໝ່ໃນລາຍງານທາງເມວ.
--
-- ຄົງເຫຼືອທີ່ເອົາມາທຽບ = SUM(qty * calc_flag) ຈາກ odg_wms_trans_detail ຕໍ່
-- (wh_code, item_code) — **ບໍ່ກັ່ນຕອງ status** ຄືກັນກັບໜ້າຄົງເຫຼືອ ເພາະ status=1
-- ຄືຂາອອກຂອງການຍ້າຍບ່ອນພາຍໃນ (trans_flag 77) ບໍ່ແມ່ນແຖວທີ່ຖືກຍົກເລີກ.
------------------------------------------------------------

-- ── 1) ເປີດ/ປິດ ຕໍ່ສາງ ─────────────────────────────────────
ALTER TABLE public.odg_wms_warehouse_config
  ADD COLUMN IF NOT EXISTS min_stock boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.odg_wms_warehouse_config.min_stock
  IS 'ສາງນີ້ຄຸມ stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ບໍ (ຄ່າເລີ່ມຕົ້ນ false — ເປີດສະເພາະສາງທີ່ຕັ້ງຄ່າ min/max ແລ້ວ).';

-- ── 2) ຄ່າ min/max ຕໍ່ (ສາງ, ສິນຄ້າ) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.odg_wms_min_stock (
  wh_code    varchar(20)  NOT NULL,
  item_code  varchar(100) NOT NULL,
  min_qty    numeric      NOT NULL DEFAULT 0,
  max_qty    numeric,
  note       varchar(200),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  updated_by varchar(50),
  PRIMARY KEY (wh_code, item_code),
  CONSTRAINT odg_wms_min_stock_min_nonneg CHECK (min_qty >= 0),
  CONSTRAINT odg_wms_min_stock_max_ge_min CHECK (max_qty IS NULL OR max_qty >= min_qty)
);

COMMENT ON TABLE public.odg_wms_min_stock
  IS 'stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ຕໍ່ (ສາງ, ສິນຄ້າ). ບໍ່ມີແຖວ = ສິນຄ້ານັ້ນບໍ່ຖືກຄຸມໃນສາງນັ້ນ.';
COMMENT ON COLUMN public.odg_wms_min_stock.min_qty IS 'ຄົງເຫຼືອຕ່ຳກວ່າຄ່ານີ້ = ຕ້ອງເຕີມສິນຄ້າ';
COMMENT ON COLUMN public.odg_wms_min_stock.max_qty IS 'ຄົງເຫຼືອສູງກວ່າຄ່ານີ້ = ເກີນແຜນ (NULL = ບໍ່ຄຸມຂັ້ນສູງ)';

-- ຄົ້ນຕາມສິນຄ້າຂ້າມສາງ (ໜ້າຕັ້ງຄ່າ / ໜ້າຈ່າຍອອກ ຖາມເປັນລາຍສິນຄ້າ).
CREATE INDEX IF NOT EXISTS idx_odg_wms_min_stock_item
  ON public.odg_wms_min_stock (item_code);

-- ── 3) section ໃໝ່ໃນລາຍງານທາງເມວ ──────────────────────────
ALTER TABLE public.odg_wms_email_report
  ADD COLUMN IF NOT EXISTS incl_min_stock boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.odg_wms_email_report.incl_min_stock
  IS 'ສິນຄ້າຕ່ຳກວ່າຂັ້ນຕ່ຳ / ເກີນຂັ້ນສູງ (ສະເພາະສາງທີ່ເປີດ min_stock)';
