/**
 * Stock card (ບັດສະຕັອກ) shared vocabulary — client-safe (no `pg` import), so
 * both the server routes and the browser components agree on the same labels
 * and on how the two storage levels relate.
 *
 * Tables live in migrations/039_wms_stock_card.sql (+ 040):
 *   odg_wms_stock_card_opening   ຍອດຕັ້ງຕົ້ນ  (rack → location level since 040)
 *   odg_wms_stock_card_doc       ຫົວໃບບັນທຶກ
 *   odg_wms_stock_card_entry     ລາຍການ +/−   (rack → location level)
 *   odg_wms_stock_card_sync_log  ປະຫວັດ sync
 */

/** +1 ຂາເຂົ້າ / −1 ຂາອອກ — same convention as odg_wms_trans_detail.calc_flag. */
export type CalcFlag = 1 | -1;

export const DIRECTIONS: { flag: CalcFlag; label: string; sign: string; tone: "emerald" | "red" }[] = [
  { flag: 1, label: "ຂາເຂົ້າ", sign: "+", tone: "emerald" },
  { flag: -1, label: "ຂາອອກ", sign: "−", tone: "red" },
];

export function directionLabel(flag: number): string {
  return flag === 1 ? "+ ຂາເຂົ້າ" : flag === -1 ? "− ຂາອອກ" : "—";
}

/** Where the opening balance comes from — shown on the sync screen so it is
 *  obvious the baseline is the WMS ledger, not SML. */
export const SYNC_SOURCE_LABEL = "odg_wms_trans_detail (ຍອດ WMS ປັດຈຸບັນ)";

/** Shown wherever a quantity is not tied to a rack/location. Since the opening
 *  balance syncs per bin this should normally be empty — a non-zero figure means
 *  some row carries no shelf code. */
export const UNLOCATED_LABEL = "ບໍ່ໄດ້ລະບຸບ່ອນເກັບ";

/** Formats a number for the card's tables — trims trailing zeros, keeps sign. */
export function fmtQty(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

/**
 * GET a stock-card endpoint and parse it, treating "the body is not JSON" as a
 * normal failure instead of a crash.
 *
 * A route that throws — a missing table, a bad query — answers with an EMPTY
 * body, and `res.json()` on that raises `SyntaxError: Unexpected end of JSON
 * input`. Thrown from a client component that has no catch, it takes the whole
 * screen down with a runtime error overlay and hides the real problem. So read
 * the body once as text and turn every failure into an Error carrying the
 * server's own message where there is one.
 */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { /* empty body or an HTML error page */ }
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new Error(msg ?? `ເຊີເວີຕອບ HTTP ${res.status}`);
  }
  if (body === null || typeof body !== "object") throw new Error("ຄຳຕອບຈາກເຊີເວີບໍ່ຖືກຕ້ອງ");
  return body as T;
}
