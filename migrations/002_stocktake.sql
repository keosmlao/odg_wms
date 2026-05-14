-- WMS stocktake (ກວດນັບ / cycle count) tables.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- Model:
--   session = ຮອບກວດນັບ (one warehouse, may have many labels/lines)
--   label   = ປ້າຍ a01,a02,... ໝາຍບ່ອນກວດນັບ (ອິດສະຫຼະຕໍ່ຮອບ, ບໍ່ຜູກ master)
--   line   = ສິນຄ້າທີ່ນັບໄດ້ໃນປ້າຍນັ້ນ

CREATE TABLE IF NOT EXISTS public.wms_stocktake_session (
    session_id      SERIAL          PRIMARY KEY,
    session_code    VARCHAR(40)     NOT NULL UNIQUE,
    wh_code         VARCHAR(20)     NOT NULL,
    name            VARCHAR(200),
    note            TEXT,
    status          VARCHAR(20)     NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed')),
    count_date      DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_by      INTEGER         REFERENCES public.odg_employee(employee_id)
                                    ON DELETE SET NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_by       INTEGER         REFERENCES public.odg_employee(employee_id)
                                    ON DELETE SET NULL,
    closed_at       TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_session_wh
    ON public.wms_stocktake_session(wh_code);
CREATE INDEX IF NOT EXISTS idx_wms_stocktake_session_status
    ON public.wms_stocktake_session(status);

CREATE TABLE IF NOT EXISTS public.wms_stocktake_label (
    label_id        SERIAL          PRIMARY KEY,
    session_id      INTEGER         NOT NULL
                                    REFERENCES public.wms_stocktake_session(session_id)
                                    ON DELETE CASCADE,
    label_code      VARCHAR(40)     NOT NULL,
    note            VARCHAR(200),
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      INTEGER         REFERENCES public.odg_employee(employee_id)
                                    ON DELETE SET NULL,
    UNIQUE (session_id, label_code)
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_label_session
    ON public.wms_stocktake_label(session_id);

CREATE TABLE IF NOT EXISTS public.wms_stocktake_line (
    line_id         SERIAL              PRIMARY KEY,
    session_id      INTEGER             NOT NULL
                                        REFERENCES public.wms_stocktake_session(session_id)
                                        ON DELETE CASCADE,
    label_id        INTEGER             NOT NULL
                                        REFERENCES public.wms_stocktake_label(label_id)
                                        ON DELETE CASCADE,
    item_code       VARCHAR(40)         NOT NULL,
    item_name       VARCHAR(200),
    unit_code       VARCHAR(20),
    qty             NUMERIC(18,4)       NOT NULL,
    note            VARCHAR(200),
    counted_by      INTEGER             REFERENCES public.odg_employee(employee_id)
                                        ON DELETE SET NULL,
    counted_at      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_line_session
    ON public.wms_stocktake_line(session_id);
CREATE INDEX IF NOT EXISTS idx_wms_stocktake_line_label
    ON public.wms_stocktake_line(label_id);
CREATE INDEX IF NOT EXISTS idx_wms_stocktake_line_item
    ON public.wms_stocktake_line(session_id, item_code);
