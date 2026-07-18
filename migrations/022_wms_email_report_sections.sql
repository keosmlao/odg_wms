------------------------------------------------------------
-- 022: More email-report sections
--
-- Adds two optional blocks to a scheduled report (021):
--   incl_movers        — Top movers (ສິນຄ້າເຄື່ອນໄຫວຫຼາຍສຸດ) over the last 7 days
--   incl_issue_pending — ສິນຄ້າຄ້າງຈ່າຍ (outbound docs not yet issued), oldest first
--
-- Default FALSE so existing reports keep their current content unchanged; a
-- manager opts in per report from /settings/email-reports. (The 021 sections
-- defaulted TRUE because they defined the report's original baseline.)
------------------------------------------------------------

ALTER TABLE public.odg_wms_email_report
  ADD COLUMN IF NOT EXISTS incl_movers        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incl_issue_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.odg_wms_email_report.incl_movers IS 'Top outbound movers, last 7 days';
COMMENT ON COLUMN public.odg_wms_email_report.incl_issue_pending IS 'Outbound docs still waiting to be issued (ສິນຄ້າຄ້າງຈ່າຍ)';
