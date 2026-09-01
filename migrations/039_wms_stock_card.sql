------------------------------------------------------------
-- 039: Stock card (ບັດສະຕັອກ) — a manual, self-contained stock ledger
--
-- Deliberately SEPARATE from the WMS movement ledger (odg_wms_trans_detail):
-- nothing here is written by receive/issue/transfer. An operator syncs an
-- opening balance from SML, then hand-posts + ຂາເຂົ້າ / − ຂາອອກ entries. The
-- card's remaining balance is therefore its OWN number and is not expected to
-- agree with the WMS balance page — that is the point: it is a side ledger for
-- stock the warehouse tracks by hand.
--
-- THE LEVEL MISMATCH is the core design constraint:
--   · the opening balance can only be synced down to WAREHOUSE level — the SML
--     function sml_ic_function_stock_balance_warehouse() knows nothing about
--     racks or bins.
--   · entries are posted down to RACK → LOCATION.
-- So a warehouse's stock splits into "located" (the net of entries that name a
-- rack/location) and "unlocated" (everything else — the opening balance plus any
-- entry posted without a bin). Reports must show both; the located figures alone
-- never sum to the warehouse total.
--
--   wh_code       → public.ic_warehouse.code
--   rack_code     → public.odg_wms_location.code       (its wh_code scopes it)
--   location_code → public.odg_wms_location1.code      (its location_id = rack)
------------------------------------------------------------

-- ── Opening balance ────────────────────────────────────────────────────────
-- ONE row per (warehouse, item) — re-syncing a warehouse REPLACES its whole set
-- (delete + insert in one transaction), so a warehouse always holds exactly one
-- opening set and the unique constraint below is what guarantees it.
CREATE TABLE IF NOT EXISTS public.odg_wms_stock_card_opening (
  roworder     bigserial PRIMARY KEY,
  wh_code      varchar(20)  NOT NULL,
  item_code    varchar(40)  NOT NULL,
  item_name    varchar(200),
  unit_code    varchar(40),
  qty          numeric      NOT NULL DEFAULT 0,  -- ຍອດຕັ້ງຕົ້ນ, ລະດັບສາງ (ບໍ່ມີ rack/location)
  synced_at    timestamptz  NOT NULL DEFAULT now(),
  user_created varchar(50)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_card_opening_wh_item
  ON public.odg_wms_stock_card_opening (wh_code, item_code);

COMMENT ON TABLE public.odg_wms_stock_card_opening
  IS 'ຍອດຕັ້ງຕົ້ນຂອງ stock card — sync ຈາກ SML ທີລະສາງ, ລະດັບສາງເທົ່ານັ້ນ (ບໍ່ຮອດ rack/location). Sync ໃໝ່ = ລຶບຂອງເກົ່າຂອງສາງນັ້ນອອກທັງໝົດແລ້ວໃສ່ໃໝ່.';

-- ── Entry document (ໃບບັນທຶກ) ───────────────────────────────────────────────
-- Every hand-posted batch is one doc, so a mistake can be found and rolled back
-- as a unit instead of hunting individual rows.
CREATE TABLE IF NOT EXISTS public.odg_wms_stock_card_doc (
  doc_no       varchar(40) PRIMARY KEY,          -- STC<YYMMDD>-<seq5>
  wh_code      varchar(20) NOT NULL,
  doc_date     date        NOT NULL DEFAULT CURRENT_DATE,
  doc_time     varchar(5),
  remark       varchar(200),
  line_count   integer     NOT NULL DEFAULT 0,
  user_created varchar(50),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.odg_wms_stock_card_doc
  IS 'ຫົວໃບບັນທຶກ stock card (1 ໃບ = 1 ຄັ້ງທີ່ເພີ່ມຂໍ້ມູນ, ມີຫຼາຍລາຍການ).';

CREATE SEQUENCE IF NOT EXISTS public.odg_wms_stock_card_doc_seq;

-- ── Entry lines (ລາຍການເຄື່ອນໄຫວ) ───────────────────────────────────────────
-- calc_flag follows the same convention as odg_wms_trans_detail: +1 = ຂາເຂົ້າ,
-- −1 = ຂາອອກ. qty is always stored POSITIVE; the sign lives in calc_flag alone,
-- so SUM(qty * calc_flag) is the net and SUM(qty) FILTER (…) gives in/out totals.
--
-- rack_code / location_code are NULLABLE on purpose: a line with no bin is the
-- only way to move stock out of the "unlocated" pool the opening balance lands
-- in (see the header note). The UI defaults to asking for a bin.
CREATE TABLE IF NOT EXISTS public.odg_wms_stock_card_entry (
  roworder      bigserial PRIMARY KEY,
  doc_no        varchar(40) NOT NULL,
  wh_code       varchar(20) NOT NULL,
  rack_code     varchar(40),                     -- odg_wms_location.code   · NULL = ບໍ່ລະບຸ
  location_code varchar(40),                     -- odg_wms_location1.code  · NULL = ບໍ່ລະບຸ
  item_code     varchar(40) NOT NULL,
  item_name     varchar(200),
  unit_code     varchar(40),
  calc_flag     smallint    NOT NULL,            -- 1 = ຂາເຂົ້າ · -1 = ຂາອອກ
  qty           numeric     NOT NULL,            -- ເກັບເປັນຄ່າບວກສະເໝີ
  remark        varchar(200),
  user_created  varchar(50),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_stock_card_entry_flag CHECK (calc_flag IN (1, -1)),
  CONSTRAINT ck_stock_card_entry_qty  CHECK (qty > 0)
);

COMMENT ON TABLE public.odg_wms_stock_card_entry
  IS 'ລາຍການເຄື່ອນໄຫວ stock card ທີ່ພິມມື (+ຂາເຂົ້າ / -ຂາອອກ) ຮອດລະດັບ rack → location.';
COMMENT ON COLUMN public.odg_wms_stock_card_entry.calc_flag
  IS '1 = ຂາເຂົ້າ (+), -1 = ຂາອອກ (-) — ຄືກັນກັບ odg_wms_trans_detail.';

CREATE INDEX IF NOT EXISTS idx_stock_card_entry_doc
  ON public.odg_wms_stock_card_entry (doc_no);
CREATE INDEX IF NOT EXISTS idx_stock_card_entry_wh_item
  ON public.odg_wms_stock_card_entry (wh_code, item_code);
CREATE INDEX IF NOT EXISTS idx_stock_card_entry_node
  ON public.odg_wms_stock_card_entry (wh_code, rack_code, location_code)
  WHERE rack_code IS NOT NULL;

-- ── Sync audit ─────────────────────────────────────────────────────────────
-- The opening table only holds the CURRENT set (re-sync wipes it), so without
-- this there is no record that a warehouse was ever re-baselined, by whom, or
-- what it replaced.
CREATE TABLE IF NOT EXISTS public.odg_wms_stock_card_sync_log (
  roworder      bigserial PRIMARY KEY,
  wh_code       varchar(20) NOT NULL,
  rows_before   integer,                         -- ຈຳນວນລາຍການທີ່ຖືກທັບ
  rows_after    integer,                         -- ຈຳນວນລາຍການທີ່ sync ເຂົ້າມາໃໝ່
  as_of_date    varchar(10),                     -- ວັນທີທີ່ສົ່ງໃຫ້ SML function
  user_created  varchar(50),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.odg_wms_stock_card_sync_log
  IS 'ປະຫວັດການ sync ຍອດຕັ້ງຕົ້ນ stock card (ໃຜ sync ສາງໃດ ເວລາໃດ ທັບໄປຈັກລາຍການ).';

CREATE INDEX IF NOT EXISTS idx_stock_card_sync_log_wh
  ON public.odg_wms_stock_card_sync_log (wh_code, created_at DESC);
------------------------------------------------------------
