------------------------------------------------------------
-- 031: ໃບສັ່ງຈ່າຍ ທີ່ດຶງມາຈາກ "ໃບຈັດຖ້ຽວ" ຂອງຂົນສົ່ງ (TMS)
--
-- ຂົນສົ່ງຈັດຖ້ຽວໃນ TMS (odg_tms + odg_tms_detail + odg_tms_detail_item):
-- 1 ຖ້ຽວ = 1 ຄັນລົດ + ຫຼາຍບິນຂາຍ (trans_flag 44), ແລະ ແຕ່ລະບິນ ອາດຂຶ້ນລົດ
-- ພຽງບາງສ່ວນ (odg_tms_detail_item.selected_qty).
--
-- ໃບ pick (wms_product_out) ຍັງຕ້ອງເປັນ 1 ໃບ / 1 ບິນ ຄືເກົ່າ — ເພາະ
-- ref_doc_no ຂອງມັນ ຄືຕົວທີ່ໃຊ້ຫັກຍອດຄ້າງຈ່າຍ ແລະ ໃຊ້ post ເຂົ້າ ERP.
-- ຕາຕະລາງນີ້ ຈຶ່ງເປັນຕົວ "ມັດ" ໃບ pick ຫຼາຍໃບ ເຂົ້າກັບ 1 ຖ້ຽວ ເພື່ອໃຫ້
-- ໜ້າຢືນຢັນ / ໃບພິມ / ປະຫວັດ ເບິ່ງເປັນຖ້ຽວດຽວກັນໄດ້.
--
-- Idempotent: safe to run more than once.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_pick_trip (
  doc_no               varchar(40) PRIMARY KEY,  -- ໃບ pick (wms_product_out.doc_no)
  trip_doc_no          varchar(40) NOT NULL,     -- ໃບຈັດຖ້ຽວ (odg_tms.doc_no)
  bill_no              varchar(40),              -- ບິນຂາຍຕົ້ນທາງ (= wms_product_out.ref_doc_no)
  wh_code              varchar(20),
  car                  varchar(40),              -- odg_tms.car (ລະຫັດລົດ)
  driver               varchar(40),              -- odg_tms.driver (ລະຫັດຄົນຂັບ)
  route_code           varchar(20),              -- odg_tms.delivery_route_code
  round_code           varchar(20),              -- odg_tms.delivery_round_code
  date_logistic        date,                     -- ວັນທີ່ອອກຖ້ຽວ
  created_by           varchar(40),
  create_date_time_now timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_pick_trip_trip ON public.wms_pick_trip (trip_doc_no);
CREATE INDEX IF NOT EXISTS idx_wms_pick_trip_bill ON public.wms_pick_trip (bill_no);
