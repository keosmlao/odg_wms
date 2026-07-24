------------------------------------------------------------
-- 023: Separate "require SN at pick-slip creation" flag
--
-- sn_issue (020) means "serial numbers are tracked in the goods-issue flow":
-- when on, the physical unit's SN is scanned at CONFIRM time and consumed.
--
-- This adds sn_issue_pick — whether the earlier PICK-SLIP screen must also
-- pre-select the exact serials, or may leave them blank and defer the scan to
-- the confirm screen. It only matters when sn_issue is on.
--
--   sn_issue_pick = true  (default): pick slip must specify each SN up front
--                                    (today's behaviour — unchanged).
--   sn_issue_pick = false          : pick slip picks location + qty only; the
--                                    SN is scanned later at ຢືນຢັນຈ່າຍ.
--
-- Defaults TRUE so every warehouse keeps today's behaviour.
------------------------------------------------------------

ALTER TABLE public.odg_wms_warehouse_config
  ADD COLUMN IF NOT EXISTS sn_issue_pick boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.odg_wms_warehouse_config.sn_issue_pick
  IS 'When TRUE (default), the goods-issue pick slip must pre-select serials; when FALSE, serials are left blank at pick and scanned at confirm instead. Only meaningful when sn_issue is TRUE.';
