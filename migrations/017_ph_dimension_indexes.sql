-- Shared PH-dimension matching support.
-- The matcher uses inventory classification fields to resolve units per pallet
-- and stack rules from odg_wms_ph_dimension.

CREATE INDEX IF NOT EXISTS idx_odg_wms_ph_dimension_match
  ON public.odg_wms_ph_dimension (
    item_category,
    item_size,
    item_design,
    item_air,
    roworder
  );

CREATE INDEX IF NOT EXISTS idx_odg_wms_ph_dimension_groups
  ON public.odg_wms_ph_dimension (
    group_main,
    group_sub,
    group_sub2,
    item_brand,
    item_pattern
  );

