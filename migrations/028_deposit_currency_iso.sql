------------------------------------------------------------
-- 027: Store ISO currency symbols on deposits, not ERP codes
--
-- ic_trans (and therefore wms_pending_bill_cache) carries the ERP
-- currency *code* — '01' = ບາດ, '02' = ກີບ, '03' = ໂດລາ, '04' = ຢວນ —
-- which migration 026 copied verbatim onto wms_deposit.currency.
-- Translate those to the ISO symbol from erp_currency so the amount
-- prints as "1,234 THB" instead of "1,234 01".
--
-- Codes are also matched unpadded ('1' as well as '01') because older
-- rows are not zero-padded.
------------------------------------------------------------

UPDATE public.wms_deposit d
   SET currency = c.symbol
  FROM public.erp_currency c
 WHERE NULLIF(c.symbol, '') IS NOT NULL
   AND (d.currency = c.code OR d.currency = LTRIM(c.code, '0'))
   AND d.currency <> c.symbol;

UPDATE public.wms_deposit_bill b
   SET currency_code = c.symbol
  FROM public.erp_currency c
 WHERE NULLIF(c.symbol, '') IS NOT NULL
   AND (b.currency_code = c.code OR b.currency_code = LTRIM(c.code, '0'))
   AND b.currency_code <> c.symbol;

UPDATE public.wms_deposit_payment p
   SET currency = c.symbol
  FROM public.erp_currency c
 WHERE NULLIF(c.symbol, '') IS NOT NULL
   AND (p.currency = c.code OR p.currency = LTRIM(c.code, '0'))
   AND p.currency <> c.symbol;

------------------------------------------------------------
-- Active deposits whose bills carry no currency at all predate the
-- currency column on the cache. Goods are valued from THB sales bills,
-- so stamp them with the configured default. Settled deposits keep
-- their historical snapshot.
------------------------------------------------------------
UPDATE public.wms_deposit d
   SET currency = COALESCE(
         (SELECT s.value FROM public.wms_deposit_setting s WHERE s.key = 'currency'),
         'THB')
 WHERE d.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM public.wms_deposit_bill b
     WHERE b.deposit_id = d.deposit_id
       AND NULLIF(b.currency_code, '') IS NOT NULL
   );
