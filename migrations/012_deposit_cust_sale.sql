------------------------------------------------------------
-- 012: Customer name + sales-staff info on deposit cache/snapshot
--
-- Adds three pieces of context to the bill cache (and therefore
-- to deposit snapshots and the picker UI):
--   - cust_name  (from ar_customer.name_1)
--   - sale_code  (from ic_trans.sale_code)
--   - sale_name  (from odg_employee.fullname_lo via sale_code)
--
-- These let the deposit form show read-only customer / sales-staff
-- info derived from the chosen bill instead of asking the user.
------------------------------------------------------------

ALTER TABLE public.wms_pending_bill_cache
  ADD COLUMN IF NOT EXISTS cust_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS sale_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS sale_name VARCHAR(200);

ALTER TABLE public.wms_deposit_bill
  ADD COLUMN IF NOT EXISTS cust_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS sale_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS sale_name VARCHAR(200);

ALTER TABLE public.wms_deposit
  ADD COLUMN IF NOT EXISTS sale_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS sale_name VARCHAR(200);
