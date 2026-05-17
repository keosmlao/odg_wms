CREATE TABLE IF NOT EXISTS public.wms_stocktake_unit_log (
    log_id          SERIAL              PRIMARY KEY,
    session_id      INTEGER             NOT NULL
                                        REFERENCES public.wms_stocktake_session(session_id)
                                        ON DELETE CASCADE,
    line_id         INTEGER             NOT NULL
                                        REFERENCES public.wms_stocktake_line(line_id)
                                        ON DELETE CASCADE,
    item_code       VARCHAR(40)         NOT NULL,
    old_unit_code   VARCHAR(20),
    new_unit_code   VARCHAR(20),
    changed_by      INTEGER             REFERENCES public.odg_employee(employee_id)
                                        ON DELETE SET NULL,
    changed_at      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note            VARCHAR(200)
);

CREATE INDEX IF NOT EXISTS idx_wms_stocktake_unit_log_session
    ON public.wms_stocktake_unit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_wms_stocktake_unit_log_line
    ON public.wms_stocktake_unit_log(line_id);
CREATE INDEX IF NOT EXISTS idx_wms_stocktake_unit_log_item
    ON public.wms_stocktake_unit_log(session_id, item_code);
