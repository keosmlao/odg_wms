CREATE TABLE IF NOT EXISTS public.wms_samsung_serial (
    samsung_serial_id  BIGSERIAL           PRIMARY KEY,
    source_file        TEXT                NOT NULL,
    source_row         INTEGER             NOT NULL,
    record_date        DATE,
    record_year        SMALLINT            NOT NULL,
    record_month       SMALLINT            NOT NULL,
    month_name         VARCHAR(20)         NOT NULL,
    record_day         SMALLINT            NOT NULL,
    serial_no          VARCHAR(100)        NOT NULL,
    item_code          VARCHAR(100),
    product_name       TEXT                NOT NULL,
    bill_no            VARCHAR(100),
    week_label         VARCHAR(30),
    quantity           NUMERIC(14, 3)      NOT NULL DEFAULT 1,
    quarter_label      VARCHAR(10),
    note               TEXT,
    claim_note         TEXT,
    imported_at        TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_wms_samsung_serial_source UNIQUE (source_file, source_row),
    CONSTRAINT ck_wms_samsung_serial_year CHECK (record_year BETWEEN 2000 AND 2200),
    CONSTRAINT ck_wms_samsung_serial_month CHECK (record_month BETWEEN 1 AND 12),
    CONSTRAINT ck_wms_samsung_serial_day CHECK (record_day BETWEEN 1 AND 31)
);

ALTER TABLE public.wms_samsung_serial
    ALTER COLUMN record_date DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS record_month SMALLINT;

UPDATE public.wms_samsung_serial
SET record_month = EXTRACT(MONTH FROM record_date)::SMALLINT
WHERE record_month IS NULL AND record_date IS NOT NULL;

ALTER TABLE public.wms_samsung_serial
    ALTER COLUMN record_month SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_wms_samsung_serial_month'
          AND conrelid = 'public.wms_samsung_serial'::regclass
    ) THEN
        ALTER TABLE public.wms_samsung_serial
            ADD CONSTRAINT ck_wms_samsung_serial_month
            CHECK (record_month BETWEEN 1 AND 12);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_date
    ON public.wms_samsung_serial(record_date DESC);
CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_serial
    ON public.wms_samsung_serial(serial_no);
CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_item
    ON public.wms_samsung_serial(item_code);
CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_bill
    ON public.wms_samsung_serial(bill_no);
CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_year_quarter
    ON public.wms_samsung_serial(record_year, quarter_label);
