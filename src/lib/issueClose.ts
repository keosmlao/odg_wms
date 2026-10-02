/**
 * Reason codes for "ປິດງານ" — closing a pending-to-issue bill out of the list
 * without actually posting a WMS issue against it (the goods already left, or
 * never will, outside WMS). Stored in `wms_issue_close` (migration 046).
 */
export const ISSUE_CLOSE_REASONS: { code: string; label: string }[] = [
  { code: "reopened_cannot_return", label: "ເປີດບິນແລ້ວຮັບຄືນບໍ່ໄດ້ ຕ້ອງຈ່າຍອອກ" },
  { code: "already_issued_stuck", label: "ບິນຈ່າຍອອກຄົບແລ້ວ ແຕ່ຍັງຄ້າງໃນລະບົບ" },
  { code: "other", label: "ອື່ນໆ" },
];
export const ISSUE_CLOSE_REASON_CODES = new Set(ISSUE_CLOSE_REASONS.map((r) => r.code));
