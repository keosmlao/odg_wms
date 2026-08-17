------------------------------------------------------------
-- 033: ຕົວເຊື່ອມ ໃບຈ່າຍ (DP) ↔ ໃບຈັດຖ້ຽວ
--
-- ໃບ pick ຂອງຖ້ຽວເປັນ *ໃບດຽວ* ແຕ່ຕອນຢືນຢັນ ຈະ post ອອກເປັນຫຼາຍ DP
-- (1 DP / 1 ບິນຂາຍ). ຕາຕະລາງນີ້ຈື່ໄວ້ວ່າ DP ໃດມາຈາກຖ້ຽວໃດ / ບິນໃດ
-- ເພື່ອໃຫ້ໜ້າ "ປະຫວັດການຈ່າຍ" ສະແດງເລກຖ້ຽວ + ລົດ ໄດ້, ແລະ ຄົ້ນຫາຕາມຖ້ຽວໄດ້.
--
-- (odg_wms_pick_scan_log.issue_doc ເປັນ varchar(40) ໃສ່ໄດ້ DP ດຽວ ຈຶ່ງໃຊ້ແທນບໍ່ໄດ້)
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_pick_trip_issue (
  issue_doc            varchar(40) PRIMARY KEY,  -- DP… ທີ່ post ອອກ
  trip_doc_no          varchar(40) NOT NULL,     -- odg_tms.doc_no
  pick_doc             varchar(40),              -- ໃບ pick ຕົ້ນທາງ (wms_product_out)
  bill_no              varchar(40),              -- ບິນຂາຍທີ່ DP ນີ້ຈ່າຍໃຫ້
  wh_code              varchar(20),
  create_date_time_now timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_pick_trip_issue_trip ON public.wms_pick_trip_issue (trip_doc_no);
CREATE INDEX IF NOT EXISTS idx_wms_pick_trip_issue_pick ON public.wms_pick_trip_issue (pick_doc);
