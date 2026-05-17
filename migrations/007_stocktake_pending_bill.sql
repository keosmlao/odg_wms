------------------------------------------------------------
-- 007: Manual pending-bill selection for stocktake
--
-- Previously the pending snapshot auto-pulled every open
-- shipment bill for the warehouse. That was too broad — the
-- user wants to pick specific bills whose qty should be added
-- back to the SML baseline.
--
-- New table holds the chosen (doc_no, trans_flag) per session.
-- wms_stocktake_pending becomes a derived snapshot rebuilt
-- from the picked bills whenever the selection changes.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_stocktake_pending_bill (
  session_id  INTEGER     NOT NULL
                          REFERENCES public.wms_stocktake_session(session_id)
                          ON DELETE CASCADE,
  doc_no      VARCHAR(50) NOT NULL,
  trans_flag  SMALLINT    NOT NULL,
  added_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, doc_no, trans_flag)
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_pending_bill_session
  ON public.wms_stocktake_pending_bill(session_id);

------------------------------------------------------------
-- Clear the auto-filled pending snapshot. The user will
-- re-populate it through bill selection. Existing sessions
-- start with an empty pending baseline (= SML only) until
-- the user picks bills.
------------------------------------------------------------
DELETE FROM public.wms_stocktake_pending;
