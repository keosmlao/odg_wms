-- WMS stocktake v2 — best-practice upgrade.
-- Adds:
--   1. Snapshot table — freeze SML balance at session start so the variance
--      report does not drift while movements continue.
--   2. Location-aware lines — rack/location stored per counted line for
--      traceability and drill-down.
--   3. Approval workflow — sessions go through pending_approval before close.
--   4. Blind counting flag — counter UI hides SML balance by default.
--
-- Safe to run multiple times.

------------------------------------------------------------
-- 1. Session columns: blind, approval workflow audit fields
------------------------------------------------------------
ALTER TABLE public.wms_stocktake_session
  ADD COLUMN IF NOT EXISTS blind         BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS submitted_by  INTEGER
                                          REFERENCES public.odg_employee(employee_id)
                                          ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by   INTEGER
                                          REFERENCES public.odg_employee(employee_id)
                                          ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

------------------------------------------------------------
-- 2. Update status CHECK to allow 'pending_approval'
------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  -- Drop any existing CHECK constraint on status (auto-named).
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wms_stocktake_session'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.wms_stocktake_session DROP CONSTRAINT %I', c);
  END LOOP;

  ALTER TABLE public.wms_stocktake_session
    ADD CONSTRAINT wms_stocktake_session_status_check
    CHECK (status IN ('open','pending_approval','closed'));
END $$;

------------------------------------------------------------
-- 3. Location-aware lines
------------------------------------------------------------
ALTER TABLE public.wms_stocktake_line
  ADD COLUMN IF NOT EXISTS rack_code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS location_code VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_line_loc
  ON public.wms_stocktake_line(session_id, rack_code, location_code);

------------------------------------------------------------
-- 4. Snapshot table — frozen SML balance per item per session
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wms_stocktake_snapshot (
  session_id    INTEGER       NOT NULL
                              REFERENCES public.wms_stocktake_session(session_id)
                              ON DELETE CASCADE,
  item_code     VARCHAR(40)   NOT NULL,
  item_name     VARCHAR(200),
  unit_code     VARCHAR(20),
  snapshot_qty  NUMERIC(18,4) NOT NULL DEFAULT 0,
  taken_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_snapshot_session
  ON public.wms_stocktake_snapshot(session_id);

------------------------------------------------------------
-- 5. Backfill snapshot for existing sessions (one-time).
--    Uses current SML balance — not historically accurate, but
--    consistent so existing sessions keep working with new logic.
------------------------------------------------------------
INSERT INTO public.wms_stocktake_snapshot
  (session_id, item_code, item_name, unit_code, snapshot_qty)
SELECT
  s.session_id,
  t.item_code,
  MAX(t.item_name)               AS item_name,
  MAX(t.unit_code)               AS unit_code,
  SUM(t.qty * t.calc_flag)::numeric AS snapshot_qty
FROM public.wms_stocktake_session s
JOIN public.odg_wms_trans_detail t ON t.wh_code = s.wh_code
WHERE (t.status = 0 OR t.status IS NULL)
  AND t.item_code IS NOT NULL
  AND t.item_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.wms_stocktake_snapshot ss
    WHERE ss.session_id = s.session_id
  )
GROUP BY s.session_id, t.item_code
HAVING SUM(t.qty * t.calc_flag) <> 0;
