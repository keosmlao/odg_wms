------------------------------------------------------------
-- 010: Item deposit / temporary storage system
--
-- Workflow: pending sales bills are taken into deposit ("hold"
-- in the warehouse on the customer's behalf). When the customer
-- collects, a fee is calculated from the elapsed days using the
-- configurable rates in wms_deposit_setting, and a payment row
-- is recorded.
--
-- Fee formula (days = ceil(now - start_date) - free_days, clamped >=0):
--   total = days * (per_deposit + items * per_item + qty * per_qty)
--   total = clamp(total, min_charge, max_charge OR +∞)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_deposit_setting (
  key          VARCHAR(40) PRIMARY KEY,
  value        VARCHAR(100) NOT NULL,
  description  VARCHAR(200),
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   INTEGER
);

INSERT INTO public.wms_deposit_setting (key, value, description)
VALUES
  ('fee_per_deposit_per_day', '5000', 'ຄ່າຝາກພື້ນຖານຕໍ່ມື້ (LAK)'),
  ('fee_per_item_per_day',    '0',    'ຄ່າຝາກເພີ່ມຕໍ່ສິນຄ້າ ຕໍ່ມື້ (LAK)'),
  ('fee_per_qty_per_day',     '0',    'ຄ່າຝາກເພີ່ມຕໍ່ qty ຕໍ່ມື້ (LAK)'),
  ('free_days',               '0',    'ມື້ຟຣີ (ບໍ່ຄິດຄ່າ)'),
  ('min_charge',              '0',    'ຄ່າຝາກຂັ້ນຕ່ຳ (LAK, 0 = ບໍ່ຈຳກັດ)'),
  ('max_charge',              '0',    'ຄ່າຝາກສູງສຸດ (LAK, 0 = ບໍ່ຈຳກັດ)'),
  ('currency',                'LAK',  'ສະກຸນເງິນ')
ON CONFLICT (key) DO NOTHING;

------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wms_deposit (
  deposit_id     SERIAL       PRIMARY KEY,
  deposit_code   VARCHAR(40)  NOT NULL UNIQUE,
  wh_code        VARCHAR(40)  NOT NULL,
  cust_code      VARCHAR(40),
  cust_name      VARCHAR(200),
  start_date     DATE         NOT NULL,
  end_date       DATE,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
                              -- 'active' | 'settled' | 'cancelled'
  -- Snapshot of rates at create time so settlements remain
  -- predictable even if global settings change later.
  rate_per_deposit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  rate_per_item     NUMERIC(18,2) NOT NULL DEFAULT 0,
  rate_per_qty      NUMERIC(18,2) NOT NULL DEFAULT 0,
  free_days         INTEGER       NOT NULL DEFAULT 0,
  min_charge        NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_charge        NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency          VARCHAR(8)    NOT NULL DEFAULT 'LAK',
  -- Cached totals (denormalized from wms_deposit_bill at create time)
  total_items    INTEGER      NOT NULL DEFAULT 0,
  total_qty      NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Final settled fee and notes
  settled_fee    NUMERIC(18,2),
  settled_days   INTEGER,
  note           VARCHAR(500),
  created_by     INTEGER,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_by     INTEGER,
  settled_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wms_deposit_status_date
  ON public.wms_deposit(status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_wms_deposit_wh
  ON public.wms_deposit(wh_code);
CREATE INDEX IF NOT EXISTS idx_wms_deposit_cust
  ON public.wms_deposit(cust_code);

------------------------------------------------------------
-- Bills attached to this deposit. Items/qty totals on the
-- header are summed from these rows at create time.
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wms_deposit_bill (
  deposit_id   INTEGER     NOT NULL
                           REFERENCES public.wms_deposit(deposit_id) ON DELETE CASCADE,
  doc_no       VARCHAR(50) NOT NULL,
  trans_flag   SMALLINT    NOT NULL,
  -- Snapshot of the bill at deposit time
  doc_date     DATE,
  cust_code    VARCHAR(40),
  lines        INTEGER     NOT NULL DEFAULT 0,
  items        INTEGER     NOT NULL DEFAULT 0,
  qty_sum      NUMERIC(18,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (deposit_id, doc_no, trans_flag)
);

CREATE INDEX IF NOT EXISTS idx_wms_deposit_bill_deposit
  ON public.wms_deposit_bill(deposit_id);

------------------------------------------------------------
-- Payment recorded when a deposit is settled. One row per
-- settlement (today: 1:1 with deposit; future: could allow
-- partial payments).
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wms_deposit_payment (
  payment_id     SERIAL       PRIMARY KEY,
  deposit_id     INTEGER      NOT NULL
                              REFERENCES public.wms_deposit(deposit_id) ON DELETE CASCADE,
  amount         NUMERIC(18,2) NOT NULL,
  currency       VARCHAR(8)   NOT NULL DEFAULT 'LAK',
  method         VARCHAR(20)  NOT NULL DEFAULT 'cash',
                              -- 'cash' | 'transfer' | 'other'
  reference      VARCHAR(100),
  paid_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by    INTEGER,
  note           VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_wms_deposit_payment_deposit
  ON public.wms_deposit_payment(deposit_id);
