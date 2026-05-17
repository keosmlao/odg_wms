------------------------------------------------------------
-- 006: Pending-shipment snapshot for stocktake
--
-- ບິນຄ້າງຈ່າຍ = bills with shipment created (ic_trans_shipment)
-- but the source transaction (ic_trans) still has status = 0
-- (not yet posted/closed). The qty has already been deducted
-- from the SML balance, but the goods are still physically in
-- the warehouse — so for stocktake comparison we add it back:
--
--     real_balance = SML snapshot + Pending shipments
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_stocktake_pending (
  session_id   INTEGER       NOT NULL
                             REFERENCES public.wms_stocktake_session(session_id)
                             ON DELETE CASCADE,
  item_code    VARCHAR(40)   NOT NULL,
  item_name    VARCHAR(200),
  unit_code    VARCHAR(20),
  pending_qty  NUMERIC(18,4) NOT NULL DEFAULT 0,
  taken_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_pending_session
  ON public.wms_stocktake_pending(session_id);

------------------------------------------------------------
-- Backfill: for every existing session, take a pending snapshot
-- if one does not exist yet. Uses the CURRENT pending state —
-- not historically accurate for closed sessions, but consistent
-- so existing variance reports start including the pending leg.
------------------------------------------------------------
INSERT INTO public.wms_stocktake_pending
  (session_id, item_code, item_name, unit_code, pending_qty)
SELECT
  s.session_id,
  d.item_code,
  MAX(d.item_name) AS item_name,
  MAX(d.unit_code) AS unit_code,
  SUM(d.qty)::numeric AS pending_qty
FROM public.wms_stocktake_session s
JOIN public.ic_trans_shipment sh ON TRUE
JOIN public.ic_trans t
  ON t.doc_no = sh.doc_no
 AND t.trans_flag = sh.trans_flag
JOIN public.ic_trans_detail d
  ON d.doc_no = sh.doc_no
 AND d.trans_flag = sh.trans_flag
 AND d.wh_code = s.wh_code
WHERE t.status = 0
  AND (d.status = 0 OR d.status IS NULL)
  AND d.item_code IS NOT NULL
  AND d.item_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.wms_stocktake_pending p
    WHERE p.session_id = s.session_id
  )
GROUP BY s.session_id, d.item_code
HAVING SUM(d.qty) <> 0;
