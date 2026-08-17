------------------------------------------------------------
-- 036: ຜັງພື້ນທີ່ສາງຈິງ (2D / 3D) — ພິກັດ x/y ຂອງແຕ່ລະບລ໋ອກ
--
-- ບັນຫາ: odg_wms_location1 ມີ **ຂະໜາດ** ຂອງແຕ່ລະ location (width/length/height
-- ເປັນ ຊມ.) ແຕ່ **ບໍ່ມີພິກັດ** ວ່າບລ໋ອກນັ້ນຢູ່ຈຸດໃດຂອງພື້ນສາງ. ໜ້າ
-- /rack-visualization ຈຶ່ງຕ້ອງ "ແຕ່ງຜັງເອົາເອງ" (ວາງ rack ຮຽງເປັນແຖວ) ເຊິ່ງ
-- ບໍ່ແມ່ນຮູບຮ່າງຈິງຂອງສາງ.
--
-- 2 ຕາຕະລາງ:
--   1) odg_wms_layout_canvas — ຂະໜາດພື້ນອາຄານຕໍ່ສາງ (ຂອບເຂດຂອງຜັງ)
--   2) odg_wms_layout_shape  — ຮູບສີ່ຫຼ່ຽມແຕ່ລະອັນເທິງຜັງ
--        kind='location' → code ຄື odg_wms_location1.code (ບ່ອນເກັບຂອງຈິງ)
--        kind='zone'     → ບ່ອນທີ່ບໍ່ແມ່ນບ່ອນເກັບ (OFFICE, RECEIVE, ປະຕູ, ທາງເດີນ)
--
-- ຫົວໜ່ວຍເປັນ **ຊັງຕີແມັດ** ໝົດ ຄືກັນກັບ odg_wms_location1 ຈຶ່ງບໍ່ຕ້ອງແປງໜ່ວຍ.
-- ຈຸດ (0,0) = ມູມເທິງ-ຊ້າຍ ຂອງອາຄານ, x ໄປຂວາ, y ລົງລຸ່ມ (ຄືກັບຮູບຜັງທີ່ແຕ້ມໄວ້).
--
-- ຄ່າ seed ຂອງ 1404 ຂ້າງລຸ່ມນີ້ອີງຮູບຜັງທີ່ທີມສາງແຕ້ມ + ຂະໜາດຈິງໃນ
-- odg_wms_location1. ຮູບຜັງນັ້ນເປັນ schematic (ບໍ່ scale ແທ້) ຈຶ່ງຖືວ່າເປັນ
-- **ຈຸດຕັ້ງຕົ້ນ** — ຜູ້ຈັດການລາກ/ປັບຂະໜາດໃນໜ້າຈໍແລ້ວບັນທຶກທັບໄດ້.
------------------------------------------------------------

-- ── 1) ຂອບເຂດພື້ນອາຄານຕໍ່ສາງ ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.odg_wms_layout_canvas (
  wh_code    varchar(20) PRIMARY KEY,
  width_cm   numeric NOT NULL,
  depth_cm   numeric NOT NULL,
  note       varchar(200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar(50),
  CONSTRAINT odg_wms_layout_canvas_size CHECK (width_cm > 0 AND depth_cm > 0)
);

COMMENT ON TABLE public.odg_wms_layout_canvas
  IS 'ຂະໜາດພື້ນອາຄານຂອງແຕ່ລະສາງ (ຊມ.) — ຂອບເຂດຂອງຜັງ 2D/3D.';

-- ── 2) ຮູບແຕ່ລະອັນເທິງຜັງ ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.odg_wms_layout_shape (
  roworder   bigserial PRIMARY KEY,
  wh_code    varchar(20)  NOT NULL,
  kind       varchar(12)  NOT NULL,
  code       varchar(60)  NOT NULL,
  label      varchar(60),
  x_cm       numeric      NOT NULL,
  y_cm       numeric      NOT NULL,
  w_cm       numeric      NOT NULL,
  d_cm       numeric      NOT NULL,
  -- ຄວາມສູງໃຊ້ສະເພາະ 3D. NULL ສຳລັບ location = ເອົາ height ຈາກ
  -- odg_wms_location1 (ແຫຼ່ງຄວາມຈິງຂອງຂະໜາດບ່ອນເກັບ).
  h_cm       numeric,
  color      varchar(16),
  sort       integer      NOT NULL DEFAULT 0,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  updated_by varchar(50),
  CONSTRAINT odg_wms_layout_shape_kind CHECK (kind IN ('location', 'zone')),
  CONSTRAINT odg_wms_layout_shape_size CHECK (w_cm > 0 AND d_cm > 0),
  CONSTRAINT odg_wms_layout_shape_uniq UNIQUE (wh_code, code)
);

CREATE INDEX IF NOT EXISTS odg_wms_layout_shape_wh_idx
  ON public.odg_wms_layout_shape (wh_code, kind);

COMMENT ON COLUMN public.odg_wms_layout_shape.code
  IS 'kind=location → odg_wms_location1.code ; kind=zone → ລະຫັດເຂດທີ່ຕັ້ງເອງ.';

-- ── 3) seed ສາງ 1404 ──────────────────────────────────────
-- ອາຄານ ~80 x 28 ມ. ແຖວ A ເທິງສຸດ, B/C ກາງ, D ລຸ່ມສຸດ, Z01 ບລ໋ອກໃຫຍ່ຊ້າຍ,
-- Z02 ແຖບຍາວຕາມແປຫຼັງຄາເທິງສຸດ, GR01 = ບ່ອນ GR/GD.
INSERT INTO public.odg_wms_layout_canvas (wh_code, width_cm, depth_cm, note)
VALUES ('1404', 8000, 2800, 'seed ຈາກຮູບຜັງທີ່ທີມສາງແຕ້ມ (036) — ປັບໄດ້ໃນໜ້າ /rack-visualization')
ON CONFLICT (wh_code) DO NOTHING;

INSERT INTO public.odg_wms_layout_shape
  (wh_code, kind, code, label, x_cm, y_cm, w_cm, d_cm, h_cm, color, sort)
VALUES
  -- ── ແຖວ A (RACK A) — 11 ບລ໋ອກ 450 x 560, ໄລຍະຫ່າງ 545 ────
  ('1404','location','140401-A01','A01',1900, 280,450,560,600,'#ef4444',10),
  ('1404','location','140401-A02','A02',2445, 280,450,560,600,'#ef4444',11),
  ('1404','location','140401-A03','A03',2990, 280,450,560,600,'#ef4444',12),
  ('1404','location','140401-A04','A04',3535, 280,450,560,600,'#ef4444',13),
  ('1404','location','140401-A05','A05',4080, 280,450,560,600,'#ef4444',14),
  ('1404','location','140401-A06','A06',4625, 280,450,560,600,'#ef4444',15),
  ('1404','location','140401-A07','A07',5170, 280,450,560,600,'#ef4444',16),
  ('1404','location','140401-A08','A08',5715, 280,450,560,600,'#ef4444',17),
  ('1404','location','140401-A09','A09',6260, 280,450,560,600,'#ef4444',18),
  ('1404','location','140401-A10','A10',6805, 280,450,560,600,'#ef4444',19),
  ('1404','location','140401-A11','A11',7350, 280,450,560,600,'#ef4444',20),

  -- ── ແຖວ B (RACK B) — 420 x 360, ມີທາງເດີນຂັ້ນລະຫວ່າງ B07 ກັບ B08 ──
  ('1404','location','140402-B04','B04',3295,1050,420,360,600,'#e8b48f',30),
  ('1404','location','140402-B05','B05',3840,1050,420,360,600,'#e8b48f',31),
  ('1404','location','140402-B06','B06',4385,1050,420,360,600,'#e8b48f',32),
  ('1404','location','140402-B07','B07',4930,1050,420,360,600,'#e8b48f',33),
  ('1404','location','140402-B08','B08',5745,1050,420,360,600,'#e8b48f',34),
  ('1404','location','140402-B09','B09',6290,1050,420,360,600,'#e8b48f',35),
  ('1404','location','140402-B10','B10',6835,1050,420,360,600,'#e8b48f',36),
  ('1404','location','140402-B11','B11',7380,1050,420,360,600,'#e8b48f',37),

  -- ── ແຖວ C (RACK C) — 420 x 480, ຢູ່ລຸ່ມແຖວ B ພິກັດ x ດຽວກັນ ──
  ('1404','location','140403-C04','C04',3295,1560,420,480,600,'#aebfe8',40),
  ('1404','location','140403-C05','C05',3840,1560,420,480,600,'#aebfe8',41),
  ('1404','location','140403-C06','C06',4385,1560,420,480,600,'#aebfe8',42),
  ('1404','location','140403-C07','C07',4930,1560,420,480,600,'#aebfe8',43),
  ('1404','location','140403-C08','C08',5745,1560,420,480,600,'#aebfe8',44),
  ('1404','location','140403-C09','C09',6290,1560,420,480,600,'#aebfe8',45),
  ('1404','location','140403-C10','C10',6835,1560,420,480,600,'#aebfe8',46),
  ('1404','location','140403-C11','C11',7380,1560,420,480,600,'#aebfe8',47),

  -- ── ແຖວ D (RACK D) — ເລິກບໍ່ເທົ່າກັນ: D01-D04 ຕື້ນ, D05 ກາງ, D06-D11 ເລິກ ──
  ('1404','location','140405-D01','D01',1900,2150,450,275,500,'#f5b731',50),
  ('1404','location','140405-D02','D02',2445,2150,450,275,500,'#f5b731',51),
  ('1404','location','140405-D03','D03',2990,2150,450,275,500,'#f5b731',52),
  ('1404','location','140405-D04','D04',3535,2150,450,275,500,'#f5b731',53),
  ('1404','location','140405-D05','D05',4080,2150,450,500,500,'#f5b731',54),
  ('1404','location','140405-D06','D06',4625,2150,450,650,500,'#f5b731',55),
  ('1404','location','140405-D07','D07',5170,2150,450,650,500,'#f5b731',56),
  ('1404','location','140405-D08','D08',5715,2150,450,650,500,'#f5b731',57),
  ('1404','location','140405-D09','D09',6260,2150,450,650,500,'#f5b731',58),
  ('1404','location','140405-D10','D10',6805,2150,450,650,500,'#f5b731',59),
  ('1404','location','140405-D11','D11',7350,2150,450,650,500,'#f5b731',60),

  -- ── RACK Z — Z01 ບລ໋ອກໃຫຍ່ວາງພື້ນ, Z02 ແຖບຍາວຕາມແປເທິງສຸດ ──
  ('1404','location','140404-Z01','Z01', 350, 280,1500,2000,600,'#fbe94b',70),
  ('1404','location','140404-Z02','Z02',1900,  80,5500, 150,500,'#fbe94b',71),

  -- ── RACK GR — ບ່ອນພັກຮັບ/ຈ່າຍ (GR/GD) ─────────────────────
  ('1404','location','140406-GR01','GR/GD',2300,900,880,1200,600,'#4caf7d',80),

  -- ── ເຂດທີ່ບໍ່ແມ່ນບ່ອນເກັບ ─────────────────────────────────
  ('1404','zone','OFFICE','OFFICE',              60,  80, 280, 220,300,'#ffffff',90),
  ('1404','zone','GATE-IN','ປະຕູທາງເຂົ້າ',        80, 420, 100, 520,  0,'#22c55e',91),
  ('1404','zone','DOOR-1','ປະຕູ',              1870, 980,  70, 180,  0,'#dc2626',92),
  ('1404','zone','PACKING','RECEIVE & PACKING',1950,1150, 280, 750,  0,'#93a8d8',93)
ON CONFLICT (wh_code, code) DO NOTHING;
