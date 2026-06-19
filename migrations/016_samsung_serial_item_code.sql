ALTER TABLE public.wms_samsung_serial
    ADD COLUMN IF NOT EXISTS item_code VARCHAR(100);

UPDATE public.wms_samsung_serial samsung
SET item_code = inventory.item_code
FROM public.sn_inventory inventory
WHERE inventory.sn = samsung.serial_no
  AND samsung.item_code IS DISTINCT FROM inventory.item_code;

CREATE INDEX IF NOT EXISTS idx_wms_samsung_serial_item
    ON public.wms_samsung_serial(item_code);

