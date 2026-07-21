------------------------------------------------------------
-- 023: Multi-PO count sheets (ໃບກວດນັບຫຼາຍ PO)
--
-- A count sheet (wms_product_receive, doc_type=2) historically referenced a
-- single PO on the header column `ref_doc_no`. This lets ONE count sheet cover
-- MANY POs (still one warehouse per sheet):
--
--   * wms_product_receive_po — the sheet's PO list (1 header → N POs). The
--     header's `ref_doc_no` keeps the first/primary PO for backward compat.
--   * wms_product_receive_detail gets ref_doc_no + wh_code, populated on the
--     POSTED receipt rows so each received qty is attributed back to the PO it
--     was allocated to (count-sheet draft rows keep them NULL — the lines there
--     are merged per item and allocated across POs only at receipt time).
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_product_receive_po (
  roworder             bigserial PRIMARY KEY,
  doc_no               varchar(40) NOT NULL,   -- the count sheet / receipt doc_no
  po_no                varchar(40) NOT NULL,    -- a PO referenced by that doc
  wh_code              varchar(20),             -- PO's warehouse (= sheet warehouse)
  supplier_code        varchar(40),             -- PO's supplier (cust_code)
  line_order           int,                     -- display / allocation order
  create_date_time_now timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_prod_recv_po_doc ON public.wms_product_receive_po (doc_no);
CREATE INDEX IF NOT EXISTS idx_wms_prod_recv_po_po  ON public.wms_product_receive_po (po_no);

-- Per-line PO + warehouse attribution on the receipt detail (audit of allocation).
ALTER TABLE public.wms_product_receive_detail
  ADD COLUMN IF NOT EXISTS ref_doc_no varchar(40),
  ADD COLUMN IF NOT EXISTS wh_code    varchar(20);

-- Backfill the PO list for every existing count sheet / receipt from its single
-- header ref_doc_no, so old docs read back through the same multi-PO path.
INSERT INTO public.wms_product_receive_po (doc_no, po_no, wh_code, supplier_code, line_order)
SELECT h.doc_no, h.ref_doc_no, h.warehouse_code, h.supplier_code, 1
FROM public.wms_product_receive h
WHERE COALESCE(NULLIF(TRIM(h.ref_doc_no), ''), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.wms_product_receive_po p WHERE p.doc_no = h.doc_no
  );
