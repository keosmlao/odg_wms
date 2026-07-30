------------------------------------------------------------
-- 025: Audit trail of the goods-issue confirm step
--
-- Everything the operator does on ② ຢືນຢັນຈ່າຍ before the stock actually moves
-- — every SN/ISN scan (accepted AND rejected), every un-scan, every location
-- re-point, and the final confirm — is appended here. The finished issue only
-- records the end state, so when a unit turns up wrong (issued from the wrong
-- bin, a serial that should not have left, a short pick nobody can explain)
-- this is the only place that shows how it got there.
--
-- Rows are keyed by the pick slip (doc_no). The DP issue doc is stamped onto
-- them at confirm, so the trail is still reachable after the pick slip itself
-- is consumed and deleted.
--
-- Writes are best-effort: if this table is missing, issuing still works and the
-- logging is silently skipped (same contract as odg_wms_move_note).
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_pick_scan_log (
  roworder     bigserial PRIMARY KEY,
  doc_no       varchar(40) NOT NULL,  -- OUT… pick slip
  ref_doc      varchar(40),           -- source doc (FR / ໃບຂໍ …)
  issue_doc    varchar(40),           -- DP… stamped when the pick is confirmed
  wh_code      varchar(20),
  event        varchar(20) NOT NULL,  -- scan | unscan | move | confirm
  result       varchar(20),           -- ok | not_found | duplicate | over_qty
  item_code    varchar(40),
  scan_input   varchar(120),          -- exactly what was scanned / typed
  sn           varchar(120),
  isn          varchar(120),
  rack         varchar(40),
  location     varchar(40),
  pallet       varchar(40),
  from_node    varchar(140),          -- move: the bin the slip planned
  to_node      varchar(140),          -- move: the bin actually used
  qty          numeric,               -- move: scans dropped · confirm: units issued
  note         varchar(200),
  user_created varchar(50),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.odg_wms_pick_scan_log
  IS 'ປະຫວັດການຍິງ SN / ແກ້ location ຕອນຢືນຢັນຈ່າຍ (ກ່ອນຕັດ stock) — ໄວ້ກວດຄືນເມື່ອມີຄວາມຜິດພາດ.';

CREATE INDEX IF NOT EXISTS idx_pick_scan_log_doc      ON public.odg_wms_pick_scan_log (doc_no, roworder);
CREATE INDEX IF NOT EXISTS idx_pick_scan_log_issue    ON public.odg_wms_pick_scan_log (issue_doc) WHERE issue_doc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pick_scan_log_created  ON public.odg_wms_pick_scan_log (created_at DESC);
