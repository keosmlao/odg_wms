------------------------------------------------------------
-- 019: Per-warehouse WMS behaviour flags
--
-- Some warehouses do not track serial-level location. For
-- those, a location move (pallet-move, transfer landing, ...)
-- should relocate the STOCK only and leave the serial
-- inventory (sn_inventory) untouched.
--
-- odg_wms_warehouse_config holds per-warehouse WMS toggles,
-- keyed by warehouse code. move_serials defaults to TRUE so
-- every existing warehouse keeps today's behaviour (serials
-- move with the stock). Set it to FALSE per warehouse from
-- Settings › Warehouses to decouple serials from moves.
--
-- Kept separate from the ERP master (public.ic_warehouse) so
-- WMS-only flags never touch the shared ERP table.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_warehouse_config (
  wh_code      varchar(20) PRIMARY KEY,
  move_serials boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   varchar(50)
);

COMMENT ON TABLE  public.odg_wms_warehouse_config              IS 'Per-warehouse WMS behaviour flags (WMS-only; not part of the ERP master).';
COMMENT ON COLUMN public.odg_wms_warehouse_config.move_serials IS 'When TRUE (default), location-move flows relocate serials (sn_inventory) with the stock; when FALSE, only the stock location moves.';
