------------------------------------------------------------
-- 018: Performance indexes for receive & issue pages
--
-- odg_wms_trans_detail (~282k rows) had ONLY a roworder PK,
-- so every stock/FIFO/reconcile query on the receive and
-- issue pages did a parallel seq scan over the whole table.
-- A single 3-item FIFO probe measured 111ms (Rows Removed by
-- Filter: 93,937 per worker); each page fires several of
-- these per load.
--
-- sn_inventory (~140k rows) was indexed only on sn/isn/roworder,
-- so the is_isn EXISTS probe and serial-location loads on the
-- issue page scanned all 140k rows.
--
-- These indexes turn those scans into direct index lookups.
-- All are non-unique btree, IF NOT EXISTS, no data change.
------------------------------------------------------------

-- FIFO stock-location lookup (issue/source + receive/putaway):
--   WHERE wh_code = $1 AND item_code = ANY($2) ... GROUP BY ...
CREATE INDEX IF NOT EXISTS idx_odg_wms_trans_detail_wh_item
  ON public.odg_wms_trans_detail (wh_code, item_code);

-- Source-doc reconciliation (issued CTE, transfer/return matching):
--   WHERE doc_ref = $1 AND trans_flag = 72 AND calc_flag = -1
CREATE INDEX IF NOT EXISTS idx_odg_wms_trans_detail_docref_flag
  ON public.odg_wms_trans_detail (doc_ref, trans_flag);

-- Issue-history line fetch and per-document lookups:
--   WHERE doc_no = ANY($1) AND calc_flag = -1
CREATE INDEX IF NOT EXISTS idx_odg_wms_trans_detail_docno
  ON public.odg_wms_trans_detail (doc_no);

-- Serial availability / location load (issue is_isn + serial match):
--   WHERE wh_code = $1 AND item_code = ANY($2) AND COALESCE(status,0)=0
CREATE INDEX IF NOT EXISTS idx_sn_inventory_wh_item_status
  ON public.sn_inventory (wh_code, item_code, status);
