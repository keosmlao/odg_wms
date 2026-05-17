------------------------------------------------------------
-- 008: Index on odg_tms_detail.bill_no
--
-- The pending-bill picker joins odg_tms_detail by bill_no to
-- detect bills that already have a TMS delivery (status = 1).
-- Without this index it falls back to a seq scan over the
-- whole table (~66k rows). Adding the index turns it into a
-- direct lookup for each bill.
------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_odg_tms_detail_bill_no
  ON public.odg_tms_detail (bill_no);

-- Optional partial index: only rows that mark a shipment done.
-- Speeds up "does this bill have any shipped delivery?" probes.
CREATE INDEX IF NOT EXISTS idx_odg_tms_detail_bill_no_shipped
  ON public.odg_tms_detail (bill_no)
  WHERE status = 1;
