# ຄູ່ມື WMS — ODIEN GROUP (ບໍລິຫານສາງສິນຄ້າ)

ເອກະສານນີ້ສະຫຼຸບ feature ທັງໝົດ, ຂະບວນການເຮັດວຽກ (workflow), ແລະ **checklist ສຳລັບ test**.
ກ່ອນ test: **restart dev server** (`npm run dev`) ເພື່ອໃຫ້ໂຄ້ດໃໝ່ມີຜົນ.

> ໝາຍເຫດ: ວັນທີ່ສະແດງເປັນ `dd-MM-yyyy`. ທຸກ feature scope ຕາມ **ສິດສາງ** ຂອງຜູ້ໃຊ້ (null=ທຸກສาง). ນາຍສาง ສາງດຽວ → auto-load.

---

## 1. ການເຄື່ອນໄຫວ (Movements)

| Menu | ເສັ້ນທາງ | ໜ້າທີ່ |
|---|---|---|
| ຮັບສິນຄ້າ | `/movements/receive` | ຮັບເຂົ້າສາງ + ISN |
| ຈ່າຍສິນຄ້າ | `/movements/issue` | ຈ່າຍອອກ (doc **DP**) ອ້າງอิง ໃບຂໍເບີກ / ໃບຂໍໂອນ / ບິນຂາຍ |
| ປັບປຸງ stock | `/movements/adjust` | ນັບ + ປັບ ISN/serial · pallet |
| ປະກອບ Pallet | `/movements/pallet-load` | ສະແກນ ໂຫລດສິນຄ້າເຂົ້າ pallet |
| ຍ້າຍ Pallet | `/movements/pallet-move` | ຍ້າຍ pallet (ທຸກລະດັບ · ຂ້າມສາງ · doc **PMV**) |
| ກວດ SN vs Stock | `/movements/sn-check` | serial ທຽບ location → ປັບໃຫ້ຕົງ (doc **SNMV**) |

## 2. ກວດສອບ & ບໍລິຫານ (Audit & Ops)

| Menu | ເສັ້ນທາງ | ໜ້າທີ່ |
|---|---|---|
| ຄວາມຖືກຕ້ອງ stock | `/movements/accuracy` | WMS ທຽບ SML/ERP — % ແມ່ນຍຳ (cached) |
| ສິນຄ້າເຄື່ອນໄຫວ | `/movements/movers` | fast movers + ແນວໂນ້ມ ເຂົ້າ/ອອກ |
| ສິນຄ້າຄ້າງ (Aging) | `/movements/aging` | dead stock idle > 90 ມື້ |
| ບ່ອນວ່າງ (Putaway) | `/movements/putaway` | ຫາ location ວ່າງ ໃສ່ສິນຄ້າ |
| ປະຫວັດ (Audit) | `/movements/ledger` | ບັນທຶກລວມທຸກ doc + CSV/Print |
| ພິມ Label/Barcode | `/movements/labels` | ປ້າຍ pallet/location (Code 128) |

---

## ຂະບວນການ (workflows)

**ປະກອບ → ຍ້າຍ pallet:**
1. `labels` → ພິມປ້າຍ pallet, ຕິດໃສ່ pallet ຈິງ.
2. `pallet-load` → ເລືອກ pallet, ສະແກນສິນຄ້າ/ISN ເຂົ້າ → ບັນທຶກ.
3. `pallet-move` → ຍ້າຍ pallet ໄປ rack/location (ຫຼື ຂ້າມສາງ).

**ກວດ & ປັບ serial:**
1. `sn-check` → ເລືອກສາງ → ເຫັນ location ທີ່ SN ≠ stock.
2. ປັບອັດຕະໂນມັດ ຫຼື manual (ສະແກນ SN ໃສ່ location).

**ກວດສຸຂະພາບປະຈຳວັນ (ນາຍສาง):**
1. ໜ້າຫຼັກ → badge ສຸຂະພາບ (ສິນຄ້າຄ້າງ / SN ບໍ່ຕົງ).
2. `accuracy` → % ແມ່ນຍຳ · `aging` → ສິນຄ້າຄ້າງ · `movers` → fast movers.
3. `ledger` → export CSV ລາຍງານ.

---

## ✅ Test Checklist

ໝາຍ ☐ → ☑ ເມື່ອ test ຜ່ານ. ຖ້າພົບ bug ບອກ Claude ພ້ອມ ໜ້າ + ສິ່ງທີ່ກົດ.

### ໜ້າຫຼັກ
- [ ] badge ສຸຂະພາບໂຫລດຂຶ້ນ (ສິນຄ້າຄ້າງ / SN ບໍ່ຕົງ ຫຼື "ສຸຂະພາບດີ")
- [ ] cards "ບໍລິຫານ & ກວດສອບ" ກົດເຂົ້າແຕ່ລະໜ້າໄດ້

### ປະກອບ Pallet (`/movements/pallet-load`)
- [ ] ເລືອກສາງ + pallet → ສະແດງບ່ອນຂອງ pallet
- [ ] ສະແກນສິນຄ້າທຳມະດາ → ໃສ່ຈຳນວນ → ບັນທຶກ → stock ເພີ່ມຖືກ
- [ ] ສິນຄ້າ serial → "ຈັດການ SN" → ສະແກນ/ສ້າງ ISN → ບັນທຶກ
- [ ] ກວດ `ledger` ເຫັນ doc ADJ ທີ່ໂຫລດ

### ຍ້າຍ Pallet (`/movements/pallet-move`)
- [ ] ຍ້າຍ pallet ພາຍໃນສາງ → stock & serial ຕາມໄປ
- [ ] ຍ້າຍ **ຂ້າມສาง** → stock ອອກສາງเก่า + ເຂົ້າສາງໃໝ່
- [ ] doc **PMV** ປະກົດໃນ `ledger`

### ກວດ SN vs Stock (`/movements/sn-check`)
- [ ] ເຫັນ location ທີ່ SN ≠ stock
- [ ] ປັບ auto → serial ຍ້າຍໄປ location ຂອງ WMS
- [ ] ປັບ manual (ສະແກນ) → ບໍ່ເກີນຈຳນວນ location
- [ ] history + delete (undo) ເຮັດວຽກ

### Audit Ledger (`/movements/ledger`)
- [ ] filter ສາງ / ວັນທີ / ປະເພດ / ຄົ້ນຫາ
- [ ] ກົດແຖວ → expand ເຫັນ lines
- [ ] **⬇ CSV** download (ເປີດໃນ Excel ພາສາລາວ ບໍ່ເພี้ยน)
- [ ] **🖨 Print**

### Putaway (`/movements/putaway`)
- [ ] KPI ວ່າງ/ມີສິນຄ້າ/ໃຊ້ໄປ % ຖືກ
- [ ] "ສະແດງແຕ່ບ່ອນວ່າງ" + ຄົ້ນຫາ

### Movers (`/movements/movers`)
- [ ] top movers sort (ອອກ/ເຂົ້າ/ຄັ້ງ)
- [ ] trend bars ສະແດງ ເຂົ້າ/ອອກ ຕາມວັນ

### Labels (`/movements/labels`)  ⭐ ສຳคัญ
- [ ] ເລືອກ pallet/location → barcode render
- [ ] ເລືອກ → 🖨 ພິມ → ອອກມາແຕ່ labels (ບໍ່ມີ menu/sidebar)
- [ ] **scanner ອ່ານ barcode ໄດ້** → ກົງກັບ code (test ໃນ pallet-load)

---

## ⚠️ ຂໍ້จำกัด ທີ່ຮູ້ແລ້ວ
- ERP **ບໍ່ມີ min/max** (ໝົດ = 0) → replenishment ບໍ່ສ້າງໄດ້.
- SML balance function ຊ້າ (~30–80s) → `accuracy` cache 10 ນາທີ.
- Stock status (good/damaged/hold), returns, kitting → **ຕ້ອງແກ້ schema DB** — ຍังບໍ່ໄດ້ສ້າງ (ລໍຖ້າ authorization).
