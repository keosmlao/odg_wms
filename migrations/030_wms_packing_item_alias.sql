------------------------------------------------------------
-- 025: ຈັບຄູ່ລາຍການໃນໃບ packing ຂອງຜູ້ສະໜອງ → ລະຫັດສິນຄ້າ SML
--
-- ໃບ packing ຈິງຂອງຜູ້ສະໜອງ (ເຊັ່ນຂອງໄທ) ມີແຕ່ **ຄຳອະທິບາຍ** (รายการ/ขนาด/ตราสินค้า)
-- ບໍ່ມີລະຫັດ SML. ລະຫັດ ແລະ ຊື່ ຕ້ອງຖື SML (ic_inventory) ເປັນຫຼັກ ສະນັ້ນ:
--
--   * detail.src_text   — ຂໍ້ຄວາມຕົ້ນສະບັບຈາກໄຟລ໌ (ລາຍການ + ຂະໜາດ + ຍີ່ຫໍ້)
--   * wms_packing_item_alias — ຈື່ການຈັບຄູ່ໄວ້ ເພື່ອຄັ້ງຕໍ່ໄປແມ່ນອັດຕະໂນມັດ
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

ALTER TABLE public.wms_packing_list_detail
  ADD COLUMN IF NOT EXISTS src_text varchar(400);

CREATE TABLE IF NOT EXISTS public.wms_packing_item_alias (
  roworder             bigserial PRIMARY KEY,
  supplier_code        varchar(40),             -- NULL = ໃຊ້ໄດ້ກັບທຸກຜູ້ສະໜອງ
  source_text_norm     varchar(400) NOT NULL,   -- ຂໍ້ຄວາມທີ່ normalize ແລ້ວ
  source_text          varchar(400),            -- ຂໍ້ຄວາມຕາມຕົ້ນສະບັບ (ໄວ້ອ່ານ)
  item_code            varchar(40) NOT NULL,    -- ລະຫັດ SML
  hits                 int NOT NULL DEFAULT 1,
  creator_code         varchar(40),
  create_date_time_now timestamp DEFAULT now(),
  last_used            timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_packing_alias
  ON public.wms_packing_item_alias (COALESCE(supplier_code, ''), source_text_norm);
CREATE INDEX IF NOT EXISTS idx_wms_packing_alias_text
  ON public.wms_packing_item_alias (source_text_norm);
