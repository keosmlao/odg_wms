------------------------------------------------------------
-- 026: Deposit edit audit + THB as the deposit currency
--
-- 1) An active deposit can now be edited (header fields, and
--    bills added/removed) — record who touched it and when.
-- 2) Deposited goods are valued from sales bills issued in THB,
--    so the fee currency follows the bills instead of defaulting
--    to LAK. Active deposits whose bills all share one currency
--    are re-stamped; settled ones keep their historical snapshot.
------------------------------------------------------------

ALTER TABLE public.wms_deposit
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER;

------------------------------------------------------------
UPDATE public.wms_deposit_setting
   SET value = 'THB', updated_at = CURRENT_TIMESTAMP
 WHERE key = 'currency' AND value <> 'THB';

------------------------------------------------------------
-- Re-stamp active deposits from their bills' currency (only when
-- every bill on the deposit agrees, so mixed-currency deposits are
-- left alone for a human to sort out).
------------------------------------------------------------
UPDATE public.wms_deposit d
   SET currency = b.cur
  FROM (
    SELECT deposit_id, MIN(currency_code) AS cur
    FROM public.wms_deposit_bill
    WHERE currency_code IS NOT NULL AND currency_code <> ''
    GROUP BY deposit_id
    HAVING COUNT(DISTINCT currency_code) = 1
  ) b
 WHERE b.deposit_id = d.deposit_id
   AND d.status = 'active'
   AND d.currency <> b.cur;
