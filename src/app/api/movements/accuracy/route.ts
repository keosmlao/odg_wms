import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Inventory-accuracy check for one warehouse: compares, per item, the ERP
 * balance (SML, from sml_ic_function_stock_balance_warehouse) vs the WMS balance
 * (Σ odg_wms_trans_detail.qty·calc_flag, all statuses) vs the in-stock serial
 * count (sn_inventory). Returns accuracy KPIs + the mismatched items.
 *
 * The SML function is slow (~30s for hundreds of items) so the full computation
 * is cached in-memory per warehouse (10-min TTL); ?refresh=1 recomputes.
 *
 * Query: ?wh=<code>&q=&limit=&refresh=1
 */
const EPS = 0.001;
const TTL_MS = 10 * 60_000;

type MismatchRow = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  sml: number;
  wms: number;
  sn: number;
  /**
   * ຈຳນວນທີ່ຢູ່ໃນ "ໃບຝາກສາງ" ທີ່ຍັງ active — ບິນຖືກຕັດ stock ໃນ ERP ໄປແລ້ວ ແຕ່
   * ເຄື່ອງຍັງຢູ່ໃນສາງ (WMS ຍັງນັບ). ສະແດງເປັນຂໍ້ມູນປະກອບເທົ່ານັ້ນ — ບໍ່ໄດ້ນຳໄປ
   * ຫັກໃນ `var_wms_sml` ຫຼື %ຄວາມຖືກຕ້ອງ.
   */
  deposit: number;
  var_wms_sml: number;
};
type Kpi = { total: number; matched: number; mismatched: number; accuracy: number; total_abs_var: number };
type Entry = { kpi: Kpi; mismatched: MismatchRow[]; ts: number };

declare global {
  // eslint-disable-next-line no-var
  var __accuracyCache: Map<string, Entry> | undefined;
}
const cache: Map<string, Entry> = globalThis.__accuracyCache ?? new Map();
globalThis.__accuracyCache = cache;

async function compute(wh: string): Promise<Entry> {
  // 1) WMS balance per item (all statuses).
  const wmsRows = await query<{ item_code: string; item_name: string | null; unit_code: string | null; wms: string }>(
    `SELECT t.item_code, MAX(t.item_name) AS item_name, MAX(t.unit_code) AS unit_code,
            SUM(t.qty * t.calc_flag)::numeric::text AS wms
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND t.item_code IS NOT NULL AND t.item_code <> ''
     GROUP BY t.item_code
     HAVING SUM(t.qty * t.calc_flag) <> 0`,
    [wh],
  );
  // 2) In-stock serials per item.
  const snRows = await query<{ item_code: string; sn: number }>(
    `SELECT item_code, count(*)::int AS sn FROM public.sn_inventory
     WHERE wh_code = $1 AND COALESCE(status, 0) = 0 GROUP BY item_code`,
    [wh],
  );

  // 2b) ເຄື່ອງຝາກສາງທີ່ຍັງ active — ບິນທີ່ຮັບຝາກໄວ້ ຕັດ stock ໃນ ERP ໄປແລ້ວ ແຕ່
  //     ຂອງຍັງຢູ່ໃນສາງ. `wms_deposit_bill` ເກັບແຕ່ເລກບິນ → ດຶງແຖວສິນຄ້າຈາກ
  //     ic_trans_detail ຕາມ (doc_no, trans_flag) ໃນສາງດຽວກັນ.
  const depRows = await query<{ item_code: string; qty: string }>(
    `SELECT d.item_code, SUM(d.qty)::numeric::text AS qty
     FROM public.wms_deposit dep
     JOIN public.wms_deposit_bill b ON b.deposit_id = dep.deposit_id
     JOIN public.ic_trans_detail d
       ON d.doc_no = b.doc_no AND d.trans_flag = b.trans_flag AND d.wh_code = dep.wh_code
     WHERE dep.status = 'active' AND dep.wh_code = $1
       AND (d.status = 0 OR d.status IS NULL)
     GROUP BY d.item_code`,
    [wh],
  ).catch(() => [] as { item_code: string; qty: string }[]);

  const wmsBy = new Map(wmsRows.map((r) => [r.item_code, Number.parseFloat(r.wms) || 0]));
  const nameBy = new Map(wmsRows.map((r) => [r.item_code, r.item_name]));
  const unitBy = new Map(wmsRows.map((r) => [r.item_code, r.unit_code]));
  const snBy = new Map(snRows.map((r) => [r.item_code, r.sn]));
  const depBy = new Map(depRows.map((r) => [r.item_code, Number.parseFloat(r.qty) || 0]));
  // ບໍ່ເອົາສິນຄ້າທີ່ມີແຕ່ໃນໃບຝາກ ເຂົ້າມາໃນຊຸດທີ່ນັບ — ຄ່າ %ຄວາມຖືກຕ້ອງຄືເກົ່າ.
  const items = Array.from(new Set([...wmsBy.keys(), ...snBy.keys()]));

  // 3) SML (ERP) balance via the SmartBiz function (slow).
  let smlBy = new Map<string, number>();
  if (items.length > 0) {
    const sml = await query<{ ic_code: string; ic_name: string | null; balance_qty: string }>(
      `SELECT ic_code, ic_name, balance_qty
       FROM public.sml_ic_function_stock_balance_warehouse('2099-12-31'::date, $1, $2)`,
      [items.join(","), wh],
    ).catch(() => [] as { ic_code: string; ic_name: string | null; balance_qty: string }[]);
    smlBy = new Map(sml.map((r) => [r.ic_code, Number.parseFloat(r.balance_qty) || 0]));
    for (const r of sml) if (!nameBy.get(r.ic_code) && r.ic_name) nameBy.set(r.ic_code, r.ic_name);
  }

  let matched = 0;
  let totalAbsVar = 0;
  const mismatched: MismatchRow[] = [];
  for (const code of items) {
    const wmsV = wmsBy.get(code) ?? 0;
    const smlV = smlBy.get(code) ?? 0;
    const snV = snBy.get(code) ?? 0;
    const v = Math.round((wmsV - smlV) * 1e6) / 1e6;
    if (Math.abs(v) < EPS) {
      matched += 1;
    } else {
      totalAbsVar += Math.abs(v);
      mismatched.push({ item_code: code, item_name: nameBy.get(code) ?? null, unit_code: unitBy.get(code) ?? null, sml: smlV, wms: wmsV, sn: snV, deposit: depBy.get(code) ?? 0, var_wms_sml: v });
    }
  }
  mismatched.sort((a, b) => Math.abs(b.var_wms_sml) - Math.abs(a.var_wms_sml));

  const total = items.length;
  const kpi: Kpi = {
    total,
    matched,
    mismatched: mismatched.length,
    accuracy: total > 0 ? Math.round((matched / total) * 1000) / 10 : 100,
    total_abs_var: Math.round(totalAbsVar * 1e6) / 1e6,
  };
  return { kpi, mismatched, ts: Date.now() };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
  const refresh = url.searchParams.get("refresh") === "1";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  let entry = refresh ? undefined : cache.get(wh);
  if (!entry || Date.now() - entry.ts >= TTL_MS) {
    entry = await compute(wh);
    cache.set(wh, entry);
  }

  const rows = (q
    ? entry.mismatched.filter((m) => m.item_code.toLowerCase().includes(q) || (m.item_name ?? "").toLowerCase().includes(q))
    : entry.mismatched
  ).slice(0, limit);

  return NextResponse.json({ kpi: entry.kpi, rows, computed_at: entry.ts });
}
