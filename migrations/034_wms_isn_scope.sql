------------------------------------------------------------
-- 034: ຂອບເຂດສິນຄ້າທີ່ຕ້ອງເກັບ ISN (ໝວດ + ຍົກເວັ້ນລາຍການ)
--
-- ບັນຫາ: ການຮັບເຂົ້າສາງອີງ `ic_inventory.is_isn` ເພື່ອຕັດສິນວ່າຕ້ອງອອກ ISN ບໍ.
-- ແຕ່ SML ຕັ້ງ is_isn = 1 ໄວ້ 24,172 ຈາກ 24,211 ລາຍການ (99.8%) ໃນຂະນະທີ່ມີພຽງ
-- ~2,005 ລາຍການທີ່ມີ serial ຈິງ — ຜົນຄື **ຮັບສິນຄ້າຫຍັງເຂົ້າກໍບັງຄັບສ້າງ ISN ທຸກຕົວ**.
-- (ໂຄດຝັ່ງຈ່າຍອອກຮູ້ບັນຫານີ້ຢູ່ແລ້ວ ຈຶ່ງເພີ່ມເງື່ອນໄຂ "ມີ serial ຄົງເຫຼືອຈິງ" ທັບ —
--  ເບິ່ງ src/lib/tripPick.ts ແລະ /api/movements/issue/source.)
--
-- ວິທີແກ້: ຍ້າຍການຕັດສິນມາເປັນ config ຝ່າຍ WMS 2 ຊັ້ນ ໂດຍ**ບໍ່ແຕະ ic_inventory**:
--
--   1) odg_wms_isn_category — ຄຸມລະດັບໝວດ (ic_inventory.item_category).
--      ມີ 265 ໝວດ ຈຶ່ງຕັ້ງເທື່ອດຽວຄຸມໄດ້ທົ່ວ.
--   2) odg_wms_isn_item     — ຍົກເວັ້ນລາຍສິນຄ້າ, ທັບຄ່າຂອງໝວດ (ເປີດ ຫຼື ປິດ ກໍໄດ້).
--      ຈຳເປັນເພາະ 44 ໝວດມີທັງສິນຄ້າທີ່ຄຸມ serial ແລະ ບໍ່ຄຸມ ປົນກັນຢູ່.
--
--   ລຳດັບ: ຍົກເວັ້ນລາຍການ → ໝວດ → ບໍ່ຕັ້ງ = ບໍ່ຕ້ອງເກັບ ISN
--
-- View `odg_wms_isn_scope` ຄືຄຳຕອບສຸດທ້າຍ ໃຫ້ທຸກ query ໃຊ້ບ່ອນດຽວກັນ.
--
-- Seed: ເປີດໃຫ້ທຸກໝວດທີ່ມີສິນຄ້າຖື serial ຢູ່ໃນ sn_inventory ຈິງ (~47 ໝວດ) —
-- ຮັກສາພຶດຕິກຳຂອງສິນຄ້າທີ່ຄຸມ serial ຢູ່ແລ້ວໄວ້ຄົບ, ແລະ ປິດ ~219 ໝວດທີ່ບໍ່ເຄີຍ
-- ມີ serial ເລີຍ. ISN ທີ່ອອກໄປແລ້ວກ່ອນໜ້ານີ້ບໍ່ຖືກແຕະຕ້ອງ.
------------------------------------------------------------

-- ── 1) ໝວດ ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.odg_wms_isn_category (
  category_code varchar(20)  PRIMARY KEY,
  require_isn   boolean      NOT NULL DEFAULT true,
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  updated_by    varchar(50)
);

COMMENT ON TABLE public.odg_wms_isn_category
  IS 'ໝວດສິນຄ້າ (ic_inventory.item_category) ທີ່ຕ້ອງເກັບ ISN. ບໍ່ມີແຖວ = ບໍ່ຕ້ອງເກັບ.';

-- ── 2) ຍົກເວັ້ນລາຍສິນຄ້າ (ທັບຄ່າໝວດ) ──────────────────────
CREATE TABLE IF NOT EXISTS public.odg_wms_isn_item (
  item_code   varchar(100) PRIMARY KEY,
  require_isn boolean      NOT NULL,
  note        varchar(200),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  varchar(50)
);

COMMENT ON TABLE public.odg_wms_isn_item
  IS 'ຍົກເວັ້ນລາຍສິນຄ້າ — ທັບຄ່າຂອງໝວດ. require_isn=true ບັງຄັບເກັບ ISN ເຖິງໝວດຈະປິດ, false ຄືກົງກັນຂ້າມ.';

-- ── 3) ຄຳຕອບສຸດທ້າຍ ────────────────────────────────────
-- ISN ອອກໄດ້ຕໍ່ເມື່ອ needs_isn ແລະ ມີ category (category ຄື prefix ຂອງເລກ ISN).
CREATE OR REPLACE VIEW public.odg_wms_isn_scope AS
  SELECT i.code,
         COALESCE(NULLIF(TRIM(i.item_category), ''), '')            AS category,
         COALESCE(ov.require_isn, c.require_isn, false)             AS needs_isn,
         (ov.item_code IS NOT NULL)                                 AS is_override
    FROM public.ic_inventory i
    LEFT JOIN public.odg_wms_isn_item     ov ON ov.item_code     = i.code
    LEFT JOIN public.odg_wms_isn_category c  ON c.category_code  = NULLIF(TRIM(i.item_category), '');

COMMENT ON VIEW public.odg_wms_isn_scope
  IS 'ສິນຄ້າໃດຕ້ອງເກັບ ISN — ຍົກເວັ້ນລາຍການ → ໝວດ → false. ທຸກ query ຄວນອ່ານຜ່ານ view ນີ້ ບໍ່ແມ່ນ ic_inventory.is_isn.';

CREATE INDEX IF NOT EXISTS idx_ic_inventory_item_category
  ON public.ic_inventory ((NULLIF(TRIM(item_category), '')));

-- ── 4) Seed: ເປີດໝວດທີ່ມີ serial ຈິງ ─────────────────────
-- ໝວດໃດມີສິນຄ້າຢ່າງໜ້ອຍ 1 ລາຍການທີ່ຖື serial ຢູ່ໃນ sn_inventory → ເປີດ.
INSERT INTO public.odg_wms_isn_category (category_code, require_isn, updated_by)
SELECT DISTINCT NULLIF(TRIM(i.item_category), ''), true, 'migration-034'
  FROM public.ic_inventory i
  JOIN public.sn_inventory s ON s.item_code = i.code
 WHERE NULLIF(TRIM(i.item_category), '') IS NOT NULL
ON CONFLICT (category_code) DO NOTHING;
