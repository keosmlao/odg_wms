------------------------------------------------------------
-- 013: Per-bill currency on cache + deposit_bill
--
-- Bills can be issued in different currencies (LAK / THB / USD).
-- The bill value should be displayed in the bill's own currency,
-- not the deposit's settlement currency, so the user sees the
-- number that matches the printed invoice.
--
-- The deposit fee is still charged in the deposit.currency.
------------------------------------------------------------

ALTER TABLE public.wms_pending_bill_cache
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8);

ALTER TABLE public.wms_deposit_bill
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8);
