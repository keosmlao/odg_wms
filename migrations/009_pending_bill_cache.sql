------------------------------------------------------------
-- 009: Pending-bill cache table
--
-- The bill picker UI used to JOIN ic_trans_shipment +
-- ic_trans + ic_trans_detail + odg_tms_detail on every open,
-- aggregating across all 32k+ pending bills of a warehouse
-- before LIMIT — slow (~4s) and burns ~700k buffer reads.
--
-- This table is a precomputed cache, one row per (wh_code,
-- doc_no, trans_flag), refreshed on demand from a button in
-- the bill picker. Reads are O(rows-for-warehouse) and use a
-- composite index on (wh_code, doc_date DESC).
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_pending_bill_cache (
  wh_code        VARCHAR(40)   NOT NULL,
  doc_no         VARCHAR(50)   NOT NULL,
  trans_flag     SMALLINT      NOT NULL,
  doc_date       DATE,
  cust_code      VARCHAR(40),
  transport_name VARCHAR(200),
  lines          INTEGER       NOT NULL DEFAULT 0,
  items          INTEGER       NOT NULL DEFAULT 0,
  qty_sum        NUMERIC(18,4) NOT NULL DEFAULT 0,
  tms_total      INTEGER       NOT NULL DEFAULT 0,
  tms_shipped    INTEGER       NOT NULL DEFAULT 0,
  tms_last_sent  TIMESTAMP,
  refreshed_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wh_code, doc_no, trans_flag)
);

CREATE INDEX IF NOT EXISTS idx_wms_pending_bill_cache_wh_date
  ON public.wms_pending_bill_cache (wh_code, doc_date DESC);

-- Per-warehouse refresh log: lets the UI show "last refreshed".
CREATE TABLE IF NOT EXISTS public.wms_pending_bill_cache_meta (
  wh_code       VARCHAR(40) NOT NULL PRIMARY KEY,
  refreshed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_by  INTEGER,
  row_count     INTEGER     NOT NULL DEFAULT 0
);
