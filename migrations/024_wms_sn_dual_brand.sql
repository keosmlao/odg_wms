------------------------------------------------------------
-- 024: Brands that must carry BOTH sn AND isn before issue
--
-- The goods-issue confirm step locks a unit from leaving the warehouse when its
-- brand requires both the factory serial (sn) and the company serial (isn) but
-- one is missing. This was hardcoded to 'SAMSUNG'; this table makes the list
-- admin-configurable (Settings › ຍີ່ຫໍ້ບັງຄັບ SN+ISN).
--
-- Seeded with SAMSUNG to preserve today's behaviour.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_sn_dual_brand (
  brand      varchar(60) PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar(50)
);

COMMENT ON TABLE public.odg_wms_sn_dual_brand
  IS 'ic_inventory.item_brand values that require BOTH sn and isn on a unit before it can be issued out.';

INSERT INTO public.odg_wms_sn_dual_brand (brand) VALUES ('SAMSUNG')
  ON CONFLICT (brand) DO NOTHING;
