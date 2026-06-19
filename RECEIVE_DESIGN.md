# ລະບົບຮັບເຄື່ອງເຂົ້າສາງ (Goods Receipt) — ການກວດສອບ ແລະ ການອອກແບບ

## 1. ຜົນການກວດສອບຂໍ້ມູນ (findings)

### trans_flag = 6 ແມ່ນຫຍັງ?
ຈาก `od_trans_flag`: **`trans_flag = 6` = "ໃບສັ່ງຊື້" (Purchase Order / PO)** — ບໍ່ແມ່ນໃບຮັບ.
ສະນັ້ນ "ເອກະສານຄ້າງຮັບ" = **PO ທີ່ຍັງຮັບເຂົ້າບໍ່ຄົບ**.

### ແຫຼ່ງ "ຄ້າງຮັບ" ທີ່ເຊື່ອຖືໄດ້ → `odg_po_remain` (VIEW)
ຕາຕະລາງ `ic_trans` ມີ status flags (`status`, `doc_success`, `doc_close`, `used_status`, `last_status`)
ແຕ່**ບໍ່ແນ່ນອນ** ສຳລັບ "ຮັບແລ້ວ/ບໍ່" (ເປັນ PO workflow status ຂອງ ERP).

➡️ ໃຫ້ໃຊ້ **`odg_po_remain`** ແທນ — ມັນຄຳນວນ "ຄ້າງຮັບ" ໃຫ້ແລ້ວ (1,243 ແຖວ):

| field | ຄວາມໝາຍ |
|---|---|
| `doc_no` | ເລກ PO (ເຊັ່ນ POH25030060) |
| `cust_code` / `cust_name` | ຜູ້ສະໜອງ (ເຈົ້າໜີ້) |
| `item_code` / `item_name` / `barcode` | ສິນຄ້າ |
| `qty` | ຈຳນວນ**ສັ່ງ** |
| **`qty_balance`** | ຈຳນວນ**ຄ້າງຮັບ** (ຍັງເຫຼືອ) |
| `unit_code` · `send_date` · `warehouse` | ໜ່ວຍ · ມື້ກຳນົດສົ່ງ · ສາງ (ເປັນ**ຊື່**) |

### ຮັບບາງສ່ວນ vs ຮັບໝົດ — ຕອບໄດ້ດ້ວຍ qty_balance
- **ຮັບແລ້ວ** = `qty − qty_balance`
- **ຮັບບາງສ່ວນ (partial)** = `0 < qty_balance < qty` (ເຊັ່ນ POH25030060: ສັ່ງ 2010, ຄ້າງ 30 → ຮັບໄປ 1980)
- **ຍັງບໍ່ຮັບ** = `qty_balance = qty`
- **ຮັບໝົດ (full)** = `qty_balance = 0` → line ນັ້ນ**ຫາຍ**ຈาก view

> ສະຫຼຸບ: ບໍ່ຕ້ອງເດົາจาก status — `qty_balance` ບອກໝົດແລ້ວ.

### ສາງ = ຊື່ → map ໄປ code
`odg_po_remain.warehouse` ເປັນ**ຊື່** ("ສາງດອນຕີ້ວ 2(ສາງແອ)"). map ໄປ code ຜ່ານ `ic_warehouse.name_1` → 1202 (ທົດສອບແລ້ວ ກົງທຸກສາງ) → ໃຊ້ scope ຕາມສິດ.

### ຕາຕະລາງ WMS receive ມີຢູ່ແລ້ວ (ວ່າງເປົ່າ, WMS-owned)
| ຕາຕະລາງ | ໃຊ້ |
|---|---|
| `wms_product_receive` | header: doc_no, doc_date/time, status, **warehouse_code**, **supplier_code**, **ref_doc_no** (PO), creator_code, **box_code/shelf_code** |
| `wms_product_receive_detail` | line: doc_no, item_code, unit_code, **qty**, **box_code/shelf_code** (location) |
| `wms_product_receive_ref` | ຜູກ doc_no ↔ PO (ref_doc_no) |

(ໂຄງສ້າງດຽວກັນກັບ adjust system: `wms_product_adj_stock` + `odg_wms_trans_detail`)

---

## 2. ການອອກແບບ workflow (wizard 3 ຂັ້ນຕອນ — ຄ້າຍ "ປັບປຸງ stock")

```
① ເລືອກໃບສັ່ງຊື້ (PO ຄ້າງຮັບ) → ② ຮັບເຂົ້າ location → ③ ຢືນຢັນ + ບັນທຶກ
```

### ຂັ້ນ ① ເລືອກ PO ຄ້າງຮັບ
- ລາຍການ `odg_po_remain` ກອງຕາມ **ສາງ (ໃນສິດ)** + ຄົ້ນຫາ/ສະແກນ (PO / ສິນຄ້າ / ຜູ້ສະໜອງ)
- ຈັດກຸ່ມຕາມ PO: ສະແດງ ຜູ້ສະໜອງ, ມື້ສັ່ງ, ຈຳນວນ line ຄ້າງ
- ເລືອກ PO ໜຶ່ງ → ໄປຂັ້ນ ②

### ຂັ້ນ ② ຮັບເຂົ້າ location (ຫົວໃຈ — ຮອງຮັບ partial/full)
ຕໍ່ແຕ່ລະ line ຂອງ PO:
```
ສິນຄ້າ            ສັ່ງ   ຮັບແລ້ວ  ຄ້າງ   ຮັບຄັ້ງນີ້        location
120101-2703 AIR   2010   1980    30   [  30 ] [ໝົດ]  [110301-A01 ▾]
```
- ໃສ່ **ຈຳນວນຮັບຄັ້ງນີ້** (≤ ຄ້າງ) → ປຸ່ມ "ຮັບໝົດ" ຕື່ມ = ຄ້າງ
- ເລືອກ **rack/location (+pallet)** ທີ່ຈະເກັບ (ຕໍ່ line; ຫຼື ກຳນົດรวมทั้งใบ)
- ສະແກນ barcode ສິນຄ້າ ເພື່ອเด้งไป line + ໃສ່ຈຳນວນໄວ
- ຮอງรับ: **ຮັບບາງສ່ວນ** (ໃສ່ < ຄ້າງ → line ຍັງເปิด) · **ຮັບໝົด** (= ຄ້າງ)

### ຂັ້ນ ③ ຢືນຢັນ
- ສະຫຼຸບ: line ທີ່ຈะรับ + ຈຳນວນ + location, ໝາຍເຫດ
- ກົດ "ບັນທຶກການຮັບ" → ຂຽນຂໍ້ມູນ (ລຸ່ມ)

---

## 3. ການບັນທຶກ (ເມื່อ save) — mirror ຂອງ adjust

ໃນ transaction ດຽວ:
1. **`odg_wms_trans_detail`** (ຕໍ່ line ທີ່ຮັບ): +stock ເຂົ້າ location
   `calc_flag=+1, trans_flag=<ຮັບ>, wh_code, shelf_code(rack), shelf_code1(location), pallet, item_code, qty, doc_no=<receive doc>, doc_ref=<PO no>, user_created`
   → **ຄົງເຫຼືອ (balance) update ທັນທີ**
2. **`wms_product_receive`** (header 1 ໃບ) + **`wms_product_receive_detail`** (lines) + **`wms_product_receive_ref`** (ผูก PO)
   → ເອກະສານຮັບ WMS (ໃຜ/ເມื่อ/PO/ສาง/location) = ຫຼັກຖານ

### ຕິດຕາມ partial/full ໃນ WMS
`odg_po_remain` ເປັນ **ERP view** → **ຈะบໍ່ຫຼຸດ**ເມื่อ WMS ຮັບ (ERP ຫຼຸดเมื่อมีใบรับ ERP แยก).
ສະນັ້ນ WMS ຕ້ອງ**ຫักยอดรับสะสมของ WMS เอง** ตอนแสดง pending:
> ຄ້າງจริง (WMS) = `qty_balance` (ERP) − Σ(`wms_product_receive_detail.qty` ของ PO+item ที่ WMS รับแล้ว)

---

## 4. ⚠️ ການຕັດສິນໃຈທີ່ຕ້ອງยืนยัน (ERP postback)

`odg_po_remain` / สต๊อก ERP จะไม่อัปเดตจาก WMS เว้นแต่สร้างใบรับ ERP. มี 2 ทาง:

| ທາງ | ລາຍລະອຽດ | ຄວາມສ່ຽງ |
|---|---|---|
| **A. WMS-only (ແນະນຳ)** | ຮັບ→ຂຽນ `odg_wms_trans_detail` + `wms_product_receive*` ເທົ່ານັ້ນ; ຫักยอด WMS receipts เองตอนแสดง pending | ต่ำ — ไม่แตะ ERP (เหมือน adjust) |
| **B. + post ERP** | สร้างใบรับสินค้า ERP (ic_trans receive) ให้ odg_po_remain ลดด้วย | สูง — ต้อง spec ERP posting, อาจกระทบบัญชี/สต๊อก ERP |

**ແນະນຳ A ກ່ອນ** (ปลอดภัย, สอดคล้องกับ adjust system ที่มีอยู่). ทำ B เมื่อได้ spec การ post ของ ERP.

---

## 5. ສິ່ງທີ່ຈະสร้าง (ถ้าอนุมัติ)
- **Backend:** `GET /api/receive/pending` (po_remain − WMS รับแล้ว, scoped), `POST /api/receive` (เขียน trans_detail + wms_product_receive*)
- **Web:** `/movements/receive` ใหม่ = wizard 3 ขั้น (แทนหน้า list เดิม) + ประวัติการรับ
- **Mobile:** receive tab (สแกน PO/สินค้า → รับเข้า location)
- ทั้งหมด scope ตามสิทธิ์สาง
