-- WMS stocktake v2 — correctness fixes.
-- Adds the missing index on snapshot.item_code so the variance FULL OUTER
-- JOIN does not full-scan the snapshot for large sessions.
-- Safe to run multiple times.

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_snapshot_item
  ON public.wms_stocktake_snapshot(item_code);
