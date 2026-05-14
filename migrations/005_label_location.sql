-- WMS stocktake — pin labels to (rack, location) for "label = location" flow.
-- Labels generated from location master have these set; ad-hoc labels
-- (a01, a02 ...) leave them NULL.
-- Safe to run multiple times.

ALTER TABLE public.wms_stocktake_label
  ADD COLUMN IF NOT EXISTS rack_code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS location_code VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_label_loc
  ON public.wms_stocktake_label(session_id, rack_code, location_code);
