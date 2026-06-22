import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { AlertIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import PendingBillCard, { type Bill } from "./PendingBillCard";
import OtherPendingList from "./OtherPendingList";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";

type SearchParams = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return v?.trim() ?? "";
}
type RemainRow = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  send_date: string | null;
  creator_name: string | null;
  transport_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  erp_balance: string;
};

// odg_po_remain is an ERP view that takes ~1.2s to compute, and the warehouse
// filter doesn't speed it up (it materializes everything first). Cache the full
// result in-memory (all warehouses) and scope per-request in JS — same 5-min TTL
// as /api/receive/pending. First load pays ~1.2s; the rest are instant.
declare global {
  // eslint-disable-next-line no-var
  var __poRemainAllCache: { rows: RemainRow[]; ts: number } | undefined;
}
const REMAIN_TTL_MS = 5 * 60_000;

async function getAllRemain(): Promise<RemainRow[]> {
  const hit = globalThis.__poRemainAllCache;
  if (hit && Date.now() - hit.ts < REMAIN_TTL_MS) return hit.rows;
  const rows = await query<RemainRow>(
    `SELECT p.doc_no AS po_no, p.cust_code, p.cust_name,
            w.code AS wh_code, w.name_1 AS wh_name,
            to_char(p.doc_date,'YYYY-MM-DD')  AS doc_date,
            to_char(COALESCE(t.send_date, p.send_date),'YYYY-MM-DD') AS send_date,
            e.fullname_lo AS creator_name, tt.name_1 AS transport_name,
            p.item_code, p.item_name, p.unit_code,
            p.qty::text AS ordered, p.qty_balance::text AS erp_balance
     FROM public.odg_po_remain p
     JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
     LEFT JOIN public.ic_trans t ON t.doc_no = p.doc_no AND t.trans_flag = 6
     LEFT JOIN public.odg_employee e ON e.employee_code = t.creator_code
     LEFT JOIN public.transport_type tt ON tt.code = t.transport_code
     WHERE p.qty_balance > 0`,
  );
  globalThis.__poRemainAllCache = { rows, ts: Date.now() };
  return rows;
}
type PhRule = { pallet: number; stack: number };

/**
 * Pending-receipt list: every PO (ໃບສັ່ງຊື້) with goods still owed, across all
 * accessible warehouses, shown whole (one card per bill) and loaded automatically
 * — no warehouse picker / load button. Remaining = ERP qty_balance − WMS received.
 */
export default async function PendingList({
  session,
  params,
}: {
  session: Session;
  params: SearchParams;
}) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ</div>;
  }

  const q = pickStr(params.q).toLowerCase();
  const scoped = Array.isArray(accessible);
  const allowed = scoped ? new Set(accessible) : null;

  // Cached view (~1.2s, shared 5-min TTL) + cheap WMS-received aggregation (~7ms,
  // always fresh so a new receipt reflects immediately).
  const [allRemain, rcv, countSheets] = await Promise.all([
    getAllRemain(),
    query<{ po_no: string; item_code: string; received: string }>(
      `SELECT h.ref_doc_no AS po_no, d.item_code, SUM(d.qty)::text AS received
       FROM public.wms_product_receive h
       JOIN public.wms_product_receive_detail d ON d.doc_no = h.doc_no
       WHERE h.ref_doc_no IS NOT NULL AND (h.status = 0 OR h.status IS NULL)
       GROUP BY h.ref_doc_no, d.item_code`,
    ),
    // Open count sheets per (PO, warehouse) — to flag pending docs already counted.
    query<{ po: string; wh: string; doc_no: string }>(
      `SELECT ref_doc_no AS po, warehouse_code AS wh, doc_no
       FROM public.wms_product_receive WHERE doc_type = 2 AND status = 9`,
    ),
  ]);
  const itemCodes = Array.from(new Set(allRemain.map((row) => row.item_code)));
  const phRows = itemCodes.length
    ? await query<{
        ic_code: string;
        pallet: string | null;
        stack: string | null;
      }>(
        `SELECT i.code AS ic_code,
                ph.pallet::text AS pallet,
                ph.stack::text AS stack
         FROM public.ic_inventory i
         ${phDimensionLateralJoin("i")}
         WHERE i.code = ANY($1)`,
        [itemCodes],
      )
    : [];
  const remain = allowed ? allRemain.filter((r) => allowed.has(r.wh_code)) : allRemain;

  const receivedBy = new Map<string, number>();
  for (const r of rcv) receivedBy.set(`${r.po_no} ${r.item_code}`, Number.parseFloat(r.received) || 0);

  const phByCode = new Map<string, PhRule>();
  for (const row of phRows) {
    phByCode.set(row.ic_code, {
      pallet: Number.parseFloat(row.pallet ?? "") || 0,
      stack: Number.parseFloat(row.stack ?? "") || 0,
    });
  }

  // Open count sheet per (PO|warehouse) → flag pending docs already counted.
  const countByKey = new Map(countSheets.map((c) => [`${c.po}|${c.wh}`, c.doc_no]));

  // Group by PO *and* warehouse — a PO can span warehouses, and each card must
  // show only the goods for one warehouse (the one the user is responsible for).
  const byPo = new Map<string, Bill>();
  for (const p of remain) {
    const received = receivedBy.get(`${p.po_no} ${p.item_code}`) ?? 0;
    const remaining = (Number.parseFloat(p.erp_balance) || 0) - received;
    if (remaining <= 0) continue;
    if (q) {
      const hay = `${p.po_no} ${p.item_code} ${p.item_name ?? ""} ${p.cust_name ?? ""} ${p.cust_code ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const key = `${p.po_no}|${p.wh_code}`;
    let g = byPo.get(key);
    if (!g) {
      g = { po_no: p.po_no, cust_code: p.cust_code, cust_name: p.cust_name, wh_code: p.wh_code, wh_name: p.wh_name, doc_date: p.doc_date, send_date: p.send_date, creator_name: p.creator_name, transport_name: p.transport_name, lines: [], totalRemaining: 0, pallets: 0, phMissing: 0 };
      byPo.set(key, g);
    }
    const ph = phByCode.get(p.item_code);
    const linePallets =
      ph && ph.pallet > 0 ? Math.ceil(remaining / ph.pallet) : 0;
    g.lines.push({
      item_code: p.item_code,
      item_name: p.item_name,
      unit_code: p.unit_code,
      remaining,
      pallets: linePallets,
      unitsPerPallet: ph?.pallet ?? 0,
      stack: ph?.stack ?? 0,
    });
    g.totalRemaining += remaining;
    if (linePallets > 0) {
      g.pallets += linePallets;
    } else {
      g.phMissing += 1;
    }
  }

  // Sort by scheduled arrival (send_date) soonest-first so urgent docs surface.
  const bills = Array.from(byPo.values()).sort((a, b) => {
    const da = a.send_date ?? "9999-99-99";
    const db = b.send_date ?? "9999-99-99";
    return da.localeCompare(db);
  });

  // Days-until arrival (send_date) for the 7-day alert.
  const todayMs = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`).getTime();
  const daysUntil = (d: string | null): number | null => {
    if (!d) return null;
    const t = new Date(`${d}T00:00:00`).getTime();
    return Number.isFinite(t) ? Math.round((t - todayMs) / 86_400_000) : null;
  };
  // Count of genuinely-upcoming docs (0–7 days ahead) for the alert banner only —
  // the list itself stays as one, sorted by date (no splitting into sections).
  const within7Count = bills.filter((b) => {
    const dd = daysUntil(b.send_date);
    return dd !== null && dd >= 0 && dd <= 7;
  }).length;

  return (
    <div className="space-y-4">
      <form method="get" className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <input type="hidden" name="tab" value="pending" />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input type="text" name="q" defaultValue={pickStr(params.q)} placeholder="ຄົ້ນຫາ PO / ສິນຄ້າ / ຜູ້ສະໜອງ..." className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800" />
          </div>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white">ກອງ</button>
        </div>
      </form>

      {bills.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm font-semibold text-zinc-500">ບໍ່ມີໃບສັ່ງຊື້ຄ້າງຮັບ</p>
        </div>
      ) : (
        <div className="space-y-3">
          {within7Count > 0 && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/50">
              <AlertIcon className="h-4 w-4 shrink-0" />⚠️ ສິນຄ້າຈະມາພາຍໃນ 7 ວັນ — {within7Count} ໃບ
            </div>
          )}
          {bills.map((b) => (
            <PendingBillCard key={`${b.po_no}|${b.wh_code}`} b={b} days={daysUntil(b.send_date)} defaultOpen={bills.length <= 4} countSheetNo={countByKey.get(`${b.po_no}|${b.wh_code}`) ?? null} />
          ))}
        </div>
      )}

      <OtherPendingList session={session} params={params} />
    </div>
  );
}
