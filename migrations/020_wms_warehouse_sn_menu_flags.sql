------------------------------------------------------------
-- 020: Per-menu SN flags per warehouse
--
-- Extends odg_wms_warehouse_config (019) so a warehouse can enable/disable
-- serial-number (SN) handling independently for each menu/flow:
--   sn_receive  — ຮັບເຂົ້າ:   generate/track serials on goods receipt
--   sn_issue    — ຈ່າຍອອກ:    consume/require serials on issue
--   sn_transfer — ໂອນ:        relocate serials on 124 transfer landing
--   sn_pallet   — ຍ້າຍ pallet: relocate serials with the pallet
--   sn_adjust   — ປັບປຸງ:     serial add/remove/generate on adjust
--   sn_return   — ຮັບຄືນ:     serials on sale-return
--
-- All default TRUE, so every warehouse keeps today's behaviour. The legacy
-- move_serials flag (019) is folded into sn_transfer + sn_pallet.
------------------------------------------------------------

ALTER TABLE public.odg_wms_warehouse_config
  ADD COLUMN IF NOT EXISTS sn_receive  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sn_issue    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sn_transfer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sn_pallet   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sn_adjust   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sn_return   boolean NOT NULL DEFAULT true;

-- Fold the older single "move serials with location" flag into the two
-- location-move menus so existing config is preserved.
UPDATE public.odg_wms_warehouse_config
   SET sn_transfer = move_serials,
       sn_pallet   = move_serials
 WHERE move_serials = false;
