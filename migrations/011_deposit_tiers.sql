------------------------------------------------------------
-- 011: Tier-based deposit fee model (% of item value)
--
-- Replaces the flat per-day model with a tiered percentage of
-- the goods' value:
--
--   ≤ free_days_max  → 0 (free period)
--   ≤ tier1_days_max → tier1_pct of total_value
--   ≤ tier2_days_max → tier2_pct
--   ≤ tier3_days_max → tier3_pct
--   else            → tier4_pct
--
-- Defaults are taken from the operations policy:
--   free_days_max=3, tier1≤7=0.5%, tier2≤30=0.75%,
--   tier3≤90=1.0%, tier4>90=1.5%
------------------------------------------------------------

-- New settings (additive; existing keys remain harmless)
INSERT INTO public.wms_deposit_setting (key, value, description) VALUES
  ('fee_model',       'tiered_percent', 'fee model: tiered_percent ຫຼື linear_per_day'),
  ('free_days_max',   '3',  'ຝາກ ≤ X ມື້ ບໍ່ຄິດຄ່າ'),
  ('tier1_days_max',  '7',  'ຂັ້ນ 1: ສູງສຸດ X ມື້'),
  ('tier1_pct',       '0.5','ຂັ້ນ 1: % ຂອງມູນຄ່າສິນຄ້າ'),
  ('tier2_days_max',  '30', 'ຂັ້ນ 2: ສູງສຸດ X ມື້'),
  ('tier2_pct',       '0.75','ຂັ້ນ 2: %'),
  ('tier3_days_max',  '90', 'ຂັ້ນ 3: ສູງສຸດ X ມື້'),
  ('tier3_pct',       '1.0','ຂັ້ນ 3: %'),
  ('tier4_pct',       '1.5','ຂັ້ນ 4: % (ເກີນ tier3)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

------------------------------------------------------------
-- Add item-value tracking to cache + deposit tables.
-- value_sum is the goods' total amount before tax/discount
-- summed from ic_trans_detail.sum_amount for the warehouse.
------------------------------------------------------------
ALTER TABLE public.wms_pending_bill_cache
  ADD COLUMN IF NOT EXISTS value_sum NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.wms_deposit_bill
  ADD COLUMN IF NOT EXISTS value_sum NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.wms_deposit
  ADD COLUMN IF NOT EXISTS total_value NUMERIC(18,2) NOT NULL DEFAULT 0;

------------------------------------------------------------
-- Tier rate snapshot on the deposit header so the settlement
-- stays deterministic if global settings change later.
------------------------------------------------------------
ALTER TABLE public.wms_deposit
  ADD COLUMN IF NOT EXISTS fee_model        VARCHAR(20)    NOT NULL DEFAULT 'tiered_percent',
  ADD COLUMN IF NOT EXISTS free_days_max    INTEGER        NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS tier1_days_max   INTEGER        NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS tier1_pct        NUMERIC(8,4)   NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS tier2_days_max   INTEGER        NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS tier2_pct        NUMERIC(8,4)   NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS tier3_days_max   INTEGER        NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS tier3_pct        NUMERIC(8,4)   NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS tier4_pct        NUMERIC(8,4)   NOT NULL DEFAULT 1.5;
