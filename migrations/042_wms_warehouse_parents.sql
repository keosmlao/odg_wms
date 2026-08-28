------------------------------------------------------------
-- 042: ສາງຍ່ອຍໜຶ່ງ ຂຶ້ນກັບໄດ້ **ຫຼາຍສາງຫຼັກ**
--
-- 041 ໃສ່ `parent_code` ໄວ້ຄໍລຳດຽວ ຄືສົມມຸດວ່າຍ່ອຍມີແມ່ໄດ້ອັນດຽວ. ຄວາມຈິງຂອງ
-- ງານແມ່ນຍ່ອຍໜຶ່ງ (ເຊັ່ນ ສາງອາໄຫຼ່) ໃຫ້ບໍລິການຫຼາຍສາງຫຼັກພ້ອມກັນ — ຄໍລຳດຽວ
-- ຈຶ່ງບັງຄັບໃຫ້ຄົນເລືອກແມ່ "ອັນທີ່ຖືກທີ່ສຸດ" ແລ້ວຖິ້ມຄວາມຈິງທີ່ເຫຼືອ.
--
-- ຍ້າຍໄປເປັນຕາຕະລາງເຊື່ອມ ຫຼາຍ-ຕໍ່-ຫຼາຍ. ຂໍ້ມູນເກົ່າຖືກ copy ມາກ່ອນ.
--
-- `parent_code` ຍັງຄ້າງໄວ້ (ບໍ່ drop) ເພື່ອບໍ່ໃຫ້ໂຄດຮຸ່ນທີ່ຍັງແລ່ນຢູ່ຕອນ
-- migrate ລົ້ມກາງທາງ — ແຕ່ບໍ່ມີໃຜອ່ານມັນອີກແລ້ວ. CHECK ຂອງ 041 ຕ້ອງຖອດ
-- ເພາະມັນຜູກ parent_code ກັບ wh_kind ຊຶ່ງດຽວນີ້ບໍ່ກ່ຽວກັນແລ້ວ.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_warehouse_parent (
  wh_code     varchar(20) NOT NULL,
  parent_code varchar(20) NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  varchar(50),
  PRIMARY KEY (wh_code, parent_code),
  CONSTRAINT odg_wms_warehouse_parent_self_chk CHECK (wh_code <> parent_code)
);

COMMENT ON TABLE public.odg_wms_warehouse_parent
  IS 'ສາງຍ່ອຍ ຂຶ້ນກັບສາງຫຼັກໃດແດ່ — 1 ແຖວ ຕໍ່ (ຍ່ອຍ, ຫຼັກ). ຍ່ອຍໜຶ່ງມີໄດ້ຫຼາຍແຖວ.';

-- ຍ້າຍຄ່າດຽວຂອງ 041 ເຂົ້າມາ ບໍ່ດັ່ງນັ້ນສາງທີ່ຕັ້ງໄວ້ແລ້ວຈະກາຍເປັນ "ບໍ່ມີແມ່".
INSERT INTO public.odg_wms_warehouse_parent (wh_code, parent_code, updated_by)
SELECT wh_code, parent_code, 'migration-042'
  FROM public.odg_wms_warehouse_config
 WHERE parent_code IS NOT NULL
   AND parent_code <> wh_code
ON CONFLICT DO NOTHING;

ALTER TABLE public.odg_wms_warehouse_config
  DROP CONSTRAINT IF EXISTS odg_wms_warehouse_config_parent_chk;

COMMENT ON COLUMN public.odg_wms_warehouse_config.parent_code
  IS 'ເລີກໃຊ້ແລ້ວ (042) — ສາງແມ່ຢູ່ odg_wms_warehouse_parent. ຄ້າງໄວ້ເພື່ອຄວາມເຂົ້າກັນໄດ້ຂອງໂຄດເກົ່າ.';

-- "ສາງຫຼັກນີ້ມີຍ່ອຍໃດແດ່" ເປັນຄຳຖາມປະຈຳ — index ຝັ່ງແມ່ໄວ້
CREATE INDEX IF NOT EXISTS idx_odg_wms_warehouse_parent_parent
  ON public.odg_wms_warehouse_parent (parent_code);
