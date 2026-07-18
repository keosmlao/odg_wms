------------------------------------------------------------
-- 021: Scheduled email reports (ສົ່ງລາຍງານທາງເມວອັດຕະໂນມັດ)
--
-- One row = one scheduled email. A manager configures WHAT goes in it, WHEN it
-- is sent, and WHO receives it, from /settings/email-reports.
--
--   sections   — which blocks the mail contains:
--                  incl_receive — ລາຍງານຮັບເຂົ້າ ປະຈຳວັນ
--                  incl_issue   — ລາຍງານຈ່າຍອອກ ປະຈຳວັນ
--                  incl_pending — ໃບຮັບທີ່ຍັງຄ້າງ (PO ຄ້າງຮັບ)
--                  incl_health  — ສະຕັອກຕໍ່າ / dead stock + SN ບໍ່ກົງ
--   schedule   — send_hour/send_minute in LOCAL time (Asia/Vientiane, the tz the
--                DB session already runs in), on the weekdays in send_days
--                (0=Sunday … 6=Saturday, ISO-free to match JS getDay()).
--   wh_scope   — warehouses to report on; empty/NULL = every warehouse.
--   recipients — plain email addresses. Kept here, NOT on odg_employee: that
--                table is ERP-shared (same rule as 019 vs ic_warehouse) and has
--                no email column at all.
--
-- last_sent_on is a DATE and is the idempotency key: the scheduler only sends
-- when last_sent_on < today, so a restart or a double tick cannot re-send.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.odg_wms_email_report (
  id            serial PRIMARY KEY,
  name          varchar(100) NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,

  incl_receive  boolean NOT NULL DEFAULT true,
  incl_issue    boolean NOT NULL DEFAULT true,
  incl_pending  boolean NOT NULL DEFAULT true,
  incl_health   boolean NOT NULL DEFAULT true,

  send_hour     smallint NOT NULL DEFAULT 8  CHECK (send_hour BETWEEN 0 AND 23),
  send_minute   smallint NOT NULL DEFAULT 0  CHECK (send_minute BETWEEN 0 AND 59),
  send_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  wh_scope      text[] NOT NULL DEFAULT '{}',
  recipients    text[] NOT NULL DEFAULT '{}',

  last_sent_on  date,
  last_status   varchar(20),
  last_error    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    varchar(50)
);

COMMENT ON TABLE  public.odg_wms_email_report IS 'ລາຍງານທາງເມວຕາມເວລາ — one row per scheduled email report';
COMMENT ON COLUMN public.odg_wms_email_report.send_days IS 'Weekdays to send on, 0=Sunday..6=Saturday (matches JS Date.getDay())';
COMMENT ON COLUMN public.odg_wms_email_report.wh_scope IS 'Warehouse codes to cover; empty = all warehouses';
COMMENT ON COLUMN public.odg_wms_email_report.recipients IS 'Recipient email addresses (WMS-owned; odg_employee has no email column)';
COMMENT ON COLUMN public.odg_wms_email_report.last_sent_on IS 'Local date this report last went out — the scheduler idempotency key';
