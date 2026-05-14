-- WMS role + warehouse-assignment tables.
-- Safe to run multiple times (IF NOT EXISTS).
-- Roles:
--   manager     = ຜູ້ຈັດການ (sees all warehouses)
--   supervisor  = ເບິ່ງຫຼາຍສາງ (only assigned)
--   keeper      = ນາຍສາງ (single warehouse)

CREATE TABLE IF NOT EXISTS public.wms_user_role (
    employee_id  INTEGER     PRIMARY KEY
                 REFERENCES public.odg_employee(employee_id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL
                 CHECK (role IN ('manager','supervisor','keeper')),
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.wms_user_warehouse (
    employee_id     INTEGER     NOT NULL
                    REFERENCES public.odg_employee(employee_id) ON DELETE CASCADE,
    warehouse_code  VARCHAR(20) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id, warehouse_code)
);

CREATE INDEX IF NOT EXISTS idx_wms_user_warehouse_warehouse
    ON public.wms_user_warehouse(warehouse_code);
