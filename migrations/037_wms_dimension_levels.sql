------------------------------------------------------------
-- 037: ຂະໜາດ (dimension) ໃສ່ໄດ້ຄົບທຸກຂັ້ນ — ສາງ → rack → location
--
-- ສະພາບກ່ອນໜ້ານີ້: ມີແຕ່ **location** ທີ່ມີຂະໜາດ (odg_wms_location1.
-- width/length/height) ແລະ ຍັງແກ້ຜ່ານໜ້າຈັດການສາງບໍ່ໄດ້ ຕ້ອງໄປແກ້ໃນ DB.
-- ຂັ້ນ **rack** (odg_wms_location) ບໍ່ມີຂະໜາດເລີຍ ຈຶ່ງຄິດຄວາມຈຸລວມຂອງ rack
-- ບໍ່ໄດ້, ແລະ ຂັ້ນ **ສາງ** ມີແຕ່ພື້ນ (odg_wms_layout_canvas.width_cm/depth_cm
-- ຈາກ 036) ບໍ່ມີຄວາມສູງອາຄານ.
--
-- ຫົວໜ່ວຍເປັນ **ຊັງຕີແມັດ** ໝົດ ຄືກັນກັບ 036 ຈຶ່ງບໍ່ຕ້ອງແປງໜ່ວຍລະຫວ່າງຂັ້ນ.
--
-- ບໍ່ແຕະ ic_warehouse (ຂໍ້ມູນຫຼັກ ERP) — ຂະໜາດສາງເກັບຢູ່ odg_wms_layout_canvas
-- ບ່ອນດຽວກັບຜັງ ເພື່ອບໍ່ໃຫ້ມີ 2 ແຫຼ່ງຄວາມຈິງ: ແກ້ໃນໜ້າຈັດການສາງ ຫຼື ໃນ
-- /rack-visualization ກໍ່ເຫັນຄ່າດຽວກັນ.
------------------------------------------------------------

-- ── 1) ຂັ້ນ rack ────────────────────────────────────────────
-- ຂະໜາດພື້ນທີ່ຂອງທັງແຖວ rack (ບໍ່ແມ່ນຂອງແຕ່ລະຊ່ອງ). NULL = ຍັງບໍ່ໄດ້ວັດ.
ALTER TABLE public.odg_wms_location
  ADD COLUMN IF NOT EXISTS width  numeric,
  ADD COLUMN IF NOT EXISTS length numeric,
  ADD COLUMN IF NOT EXISTS height numeric;

COMMENT ON COLUMN public.odg_wms_location.width  IS 'ຄວາມກ້ວງຂອງ rack (ຊມ.) — NULL = ບໍ່ໄດ້ວັດ';
COMMENT ON COLUMN public.odg_wms_location.length IS 'ຄວາມເລິກຂອງ rack (ຊມ.)';
COMMENT ON COLUMN public.odg_wms_location.height IS 'ຄວາມສູງຂອງ rack (ຊມ.)';

ALTER TABLE public.odg_wms_location
  DROP CONSTRAINT IF EXISTS odg_wms_location_dim_nonneg;
ALTER TABLE public.odg_wms_location
  ADD CONSTRAINT odg_wms_location_dim_nonneg CHECK (
    COALESCE(width, 0) >= 0 AND COALESCE(length, 0) >= 0 AND COALESCE(height, 0) >= 0
  );

-- ── 2) ຂັ້ນ location ────────────────────────────────────────
-- ຖັນມີຢູ່ແລ້ວ (width/length/height) — ເພີ່ມແຕ່ຄຳອະທິບາຍໜ່ວຍ ແລະ ກັນຄ່າຕິດລົບ.
COMMENT ON COLUMN public.odg_wms_location1.width  IS 'ຄວາມກ້ວງຂອງບ່ອນເກັບ (ຊມ.)';
COMMENT ON COLUMN public.odg_wms_location1.length IS 'ຄວາມເລິກຂອງບ່ອນເກັບ (ຊມ.)';
COMMENT ON COLUMN public.odg_wms_location1.height IS 'ຄວາມສູງຂອງບ່ອນເກັບ (ຊມ.)';

ALTER TABLE public.odg_wms_location1
  DROP CONSTRAINT IF EXISTS odg_wms_location1_dim_nonneg;
ALTER TABLE public.odg_wms_location1
  ADD CONSTRAINT odg_wms_location1_dim_nonneg CHECK (
    COALESCE(width, 0) >= 0 AND COALESCE(length, 0) >= 0 AND COALESCE(height, 0) >= 0
  );

-- ── 3) ຂັ້ນສາງ ──────────────────────────────────────────────
-- ພື້ນ (width_cm x depth_cm) ມີແລ້ວຈາກ 036 — ເພີ່ມຄວາມສູງອາຄານ.
ALTER TABLE public.odg_wms_layout_canvas
  ADD COLUMN IF NOT EXISTS height_cm numeric;

COMMENT ON COLUMN public.odg_wms_layout_canvas.height_cm
  IS 'ຄວາມສູງພາຍໃນອາຄານ (ຊມ.) — NULL = ບໍ່ໄດ້ວັດ. ໃຊ້ເປັນເພດານຂອງ 3D ແລະ ຄິດປະລິມາດສາງ.';

ALTER TABLE public.odg_wms_layout_canvas
  DROP CONSTRAINT IF EXISTS odg_wms_layout_canvas_height;
ALTER TABLE public.odg_wms_layout_canvas
  ADD CONSTRAINT odg_wms_layout_canvas_height CHECK (height_cm IS NULL OR height_cm > 0);
