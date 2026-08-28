------------------------------------------------------------
-- 041: ສາງຫຼັກ / ສາງຍ່ອຍ (wh_kind + parent_code)
--
-- ບັນຫາ: ລະບົບຮູ້ຈັກແຕ່ "ລະຫັດສາງ" ເປັນແຖວຮຽບໆ 34 ສາງ ບໍ່ມີບ່ອນບອກວ່າ
-- ສາງໃດເປັນ **ສາງຫຼັກ** ແລະ ສາງໃດເປັນ **ສາງຍ່ອຍ ຂອງສາງຫຼັກໃດ** — ຄົນຈຶ່ງຕ້ອງ
-- ຈື່ເອົາເອງຈາກລະຫັດ (11xx = ຂົວຫຼວງ ...) ຊຶ່ງບໍ່ຖືກສະເໝີໄປ.
--
-- ເກັບຢູ່ odg_wms_warehouse_config ຄືກັບ flag ອື່ນ (019/020) ເພື່ອບໍ່ໃຫ້ແຕະ
-- ຕາຕະລາງແມ່ຂອງ ERP (public.ic_warehouse) ທີ່ແອັບອື່ນໃຊ້ຮ່ວມກັນ.
--
-- ຄ່າເລີ່ມຕົ້ນ 'main': ສາງທີ່ມີຢູ່ແລ້ວທຸກສາງເປັນ "ສາງຫຼັກ" ຈົນກວ່າຜູ້ຈັດການຈະ
-- ຕັ້ງເປັນຍ່ອຍເອງ — ບໍ່ມີສາງໃດປ່ຽນພຶດຕິກຳຍ້ອນ migration ນີ້.
-- ສາງທີ່ຍັງບໍ່ມີແຖວ config ກໍ່ອ່ານເປັນ 'main' ດ້ວຍ COALESCE ຝັ່ງໂຄດ.
------------------------------------------------------------

ALTER TABLE public.odg_wms_warehouse_config
  ADD COLUMN IF NOT EXISTS wh_kind     varchar(10) NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS parent_code varchar(20);

COMMENT ON COLUMN public.odg_wms_warehouse_config.wh_kind
  IS 'main = ສາງຫຼັກ, sub = ສາງຍ່ອຍ (ຄ່າເລີ່ມຕົ້ນ main)';
COMMENT ON COLUMN public.odg_wms_warehouse_config.parent_code
  IS 'ສາງແມ່ (ic_warehouse.code) — ມີໄດ້ສະເພາະເມື່ອ wh_kind = sub';

-- ບັງຄັບຄວາມຖືກຕ້ອງຢູ່ຊັ້ນ DB ນຳ ບໍ່ແມ່ນແຕ່ຢູ່ໜ້າຈໍ: ຂໍ້ມູນສາງຖືກແກ້ຈາກ
-- ຫຼາຍທາງ (SQL ມື, script ນຳເຂົ້າ) ແລະ ຕົ້ນໄມ້ທີ່ຂາດຂາຈະພັງລາຍງານທຸກໜ້າ.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'odg_wms_warehouse_config_kind_chk'
  ) THEN
    ALTER TABLE public.odg_wms_warehouse_config
      ADD CONSTRAINT odg_wms_warehouse_config_kind_chk
      CHECK (wh_kind IN ('main', 'sub'));
  END IF;

  -- ສາງຫຼັກມີແມ່ບໍ່ໄດ້ ແລະ ສາງໃດກໍ່ເປັນແມ່ຂອງຕົນເອງບໍ່ໄດ້.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'odg_wms_warehouse_config_parent_chk'
  ) THEN
    ALTER TABLE public.odg_wms_warehouse_config
      ADD CONSTRAINT odg_wms_warehouse_config_parent_chk
      CHECK (
        (wh_kind = 'main' AND parent_code IS NULL)
        OR (wh_kind = 'sub' AND parent_code IS DISTINCT FROM wh_code)
      );
  END IF;
END $$;

-- ຖາມ "ສາງຫຼັກນີ້ມີຍ່ອຍຈັກສາງ" ເປັນຄຳຖາມປະຈຳຂອງໜ້າຕັ້ງຄ່າ ແລະ ລາຍງານ.
CREATE INDEX IF NOT EXISTS idx_odg_wms_warehouse_config_parent
  ON public.odg_wms_warehouse_config (parent_code)
  WHERE parent_code IS NOT NULL;
