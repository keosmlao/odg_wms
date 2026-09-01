------------------------------------------------------------
-- 040: Stock card opening balance moves from WAREHOUSE level to RACK → LOCATION
--
-- Migration 039 built the opening balance on SML's
-- sml_ic_function_stock_balance_warehouse(), which only knows warehouses. That
-- forced the card to carry an "unlocated" bucket: everything synced in landed
-- outside any bin and only moved into a bin once someone hand-posted an entry.
--
-- The opening balance is now taken from the WMS movement ledger instead, which
-- already stores the bin on every line:
--
--   SELECT wh_code, item_code, shelf_code AS rack, shelf_code1 AS location,
--          SUM(qty * calc_flag) AS balance_qty
--     FROM public.odg_wms_trans_detail
--    WHERE wh_code = $1
--    GROUP BY wh_code, item_code, shelf_code, shelf_code1
--
-- So a warehouse's opening set is now ONE ROW PER (item, rack, location) rather
-- than one row per item, and "unlocated" is no longer where stock starts life —
-- it is only what is left if a row genuinely has no bin recorded.
--
-- The SML path is retired; sml_ic_function_stock_balance_warehouse() is no
-- longer called anywhere.
------------------------------------------------------------

ALTER TABLE public.odg_wms_stock_card_opening
  ADD COLUMN IF NOT EXISTS rack_code     varchar(40),   -- odg_wms_trans_detail.shelf_code  · NULL = ບໍ່ໄດ້ລະບຸ
  ADD COLUMN IF NOT EXISTS location_code varchar(40);   -- odg_wms_trans_detail.shelf_code1 · NULL = ບໍ່ໄດ້ລະບຸ

-- The old key allowed exactly one row per item per warehouse — that is now
-- wrong, an item legitimately sits in several bins at once.
DROP INDEX IF EXISTS public.uq_stock_card_opening_wh_item;

-- COALESCE, not the bare columns: Postgres treats NULLs as distinct in a unique
-- index, so a bare (wh, item, rack, location) key would happily accept two
-- "no bin" rows for the same item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_card_opening_node
  ON public.odg_wms_stock_card_opening
     (wh_code, item_code, COALESCE(rack_code, ''), COALESCE(location_code, ''));

CREATE INDEX IF NOT EXISTS idx_stock_card_opening_wh_item
  ON public.odg_wms_stock_card_opening (wh_code, item_code);

COMMENT ON TABLE public.odg_wms_stock_card_opening
  IS 'ຍອດຕັ້ງຕົ້ນຂອງ stock card — sync ຈາກ odg_wms_trans_detail ທີລະສາງ, ຮອດລະດັບ rack → location. Sync ໃໝ່ = ລຶບຂອງເກົ່າຂອງສາງນັ້ນອອກທັງໝົດແລ້ວໃສ່ໃໝ່.';
COMMENT ON COLUMN public.odg_wms_stock_card_opening.qty
  IS 'ຍອດຕັ້ງຕົ້ນ = SUM(qty * calc_flag) ຂອງ node ນັ້ນ (ຕິດລົບໄດ້).';

-- as_of_date used to hold the date handed to the SML function; there is no such
-- date any more — the WMS ledger sum is always "as of now".
COMMENT ON COLUMN public.odg_wms_stock_card_sync_log.as_of_date
  IS 'ບໍ່ໄດ້ໃຊ້ແລ້ວ (ເກັບ NULL) — ຕັ້ງແຕ່ migration 040 ຍອດຕັ້ງຕົ້ນດຶງຈາກ odg_wms_trans_detail ເຊິ່ງເປັນຍອດປັດຈຸບັນສະເໝີ.';

-- Existing warehouse-level rows carry no bin and would read as "unlocated"
-- forever. They are a stale baseline under the new rule, so clear them: every
-- warehouse must be re-synced to get its bins.
DELETE FROM public.odg_wms_stock_card_opening WHERE rack_code IS NULL AND location_code IS NULL;
------------------------------------------------------------
