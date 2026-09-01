import "server-only";
import { query } from "@/lib/db";
import { health, pendingIssues, pendingReceipts, type Scope } from "@/lib/reportData";
import { minStockSummary } from "@/lib/minStock";

/**
 * ລາຍງານປະສິດທິພາບການບໍລິຫານສາງ — KPI ມາດຕະຖານ 5 ດ້ານ ໃນບ່ອນດຽວ:
 * ຂາເຂົ້າ · ຂາອອກ · ຄົງຄັງ · ແຮງງານ · ພື້ນທີ່.
 *
 * ນິຍາມການເຄື່ອນໄຫວ**ຢືມມາຈາກລາຍງານທີ່ມີຢູ່** ບໍ່ໄດ້ຄິດໃໝ່ — ບໍ່ດັ່ງນັ້ນຕົວເລກ
 * ໜ້ານີ້ຈະຄ້ານກັບໜ້າ /movements/daily ແລະ /movements/pending-out ເຊິ່ງຮ້າຍກວ່າ
 * ການບໍ່ມີລາຍງານ:
 *   · ຍ້າຍພາຍໃນບໍ່ນັບເປັນການເຄື່ອນໄຫວ — trans_flag 77 ຕັດອອກໝົດ, flag 99 ຕັດ
 *     ສະເພາະຄູ່ທີ່ມີທັງ ±1 ໃນສາງດຽວກັນ (ຄືກັບ dailyMovement.dailyStock)
 *   · ຄ້າງຮັບ / ຄ້າງຈ່າຍ ເອີ້ນ pendingReceipts / pendingIssues ໂດຍກົງ
 *   · ສິນຄ້າຕາຍ + SN ບໍ່ກົງ ເອີ້ນ health()
 *
 * ທຸກຕົວເລກທຽບກັບ**ຊ່ວງກ່ອນໜ້າທີ່ຍາວເທົ່າກັນ** ເພື່ອໃຫ້ເຫັນທ່າອ່ຽງ ບໍ່ແມ່ນຕົວເລກລອຍໆ.
 */

export type Period = { from: string; to: string; days: number };

/** ຄ່າປັດຈຸບັນ + ຊ່ວງກ່ອນ — ໜ້າຈໍຄິດ % ປ່ຽນແປງເອງ. */
export type Delta = { now: number; prev: number };

export type Throughput = {
  in_qty: Delta;
  out_qty: Delta;
  in_lines: Delta;
  out_lines: Delta;
  in_docs: Delta;
  out_docs: Delta;
};

export type LeadTime = {
  /** ມັດທະຍະຖານ (ມື້) — ໃຊ້ p50 ບໍ່ແມ່ນຄ່າສະເລ່ຍ ເພາະໃບຄ້າງດົນໆ ດຶງຄ່າສະເລ່ຍເພື້ອນ. */
  p50: number | null;
  p90: number | null;
  docs: number;
};

export type Backlog = {
  docs: number;
  qty: number;
  /** ອາຍຸສະເລ່ຍຂອງໃບທີ່ຄ້າງ (ມື້). */
  avg_days: number;
  /** ໃບທີ່ຄ້າງເກີນ 7 ມື້ — ຕົວຊີ້ບັນຫາ ບໍ່ແມ່ນວຽກປົກກະຕິ. */
  over_7d: number;
  oldest_days: number;
};

export type Ira = {
  wh_code: string;
  count_date: string | null;
  items_counted: number;
  matched: number;
  /** % ລາຍການທີ່ນັບຈິງກົງກັບຍອດລະບົບ. */
  accuracy: number;
};

export type OperatorRow = { user_created: string; lines: number; docs: number; days: number };

export type WarehouseRow = {
  wh_code: string;
  wh_name: string | null;
  in_qty: number;
  out_qty: number;
  lines: number;
  docs: number;
  users: number;
};

export type PerformanceReport = {
  period: Period;
  prev: Period;
  throughput: Throughput;
  inbound: { lead: LeadTime; backlog: Backlog };
  outbound: { cycle: LeadTime; backlog: Backlog; short_notes: number };
  inventory: {
    ira: Ira[];
    dead_items: number;
    dead_qty: number;
    sn_mismatch: number;
    below_min: number;
    above_max: number;
    min_rules: number;
    min_warehouses: number;
  };
  labor: {
    users: number;
    lines: Delta;
    docs: Delta;
    lines_per_day: number;
    lines_per_user_day: number;
    top: OperatorRow[];
    by_hour: { hour: number; lines: number }[];
  };
  space: {
    locations: number;
    used: number;
    empty: number;
    with_dims: number;
    racks: number;
    racks_with_dims: number;
  };
  warehouses: WarehouseRow[];
};

// ─────────────────────────── helpers ───────────────────────────

const n = (v: string | number | null | undefined) =>
  Math.round((typeof v === "number" ? v : Number.parseFloat(v ?? "") || 0) * 100) / 100;
const int = (v: string | number | null | undefined) =>
  typeof v === "number" ? Math.round(v) : Number.parseInt(v ?? "0", 10) || 0;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** ຊ່ວງກ່ອນໜ້າ ຍາວເທົ່າກັນ ຕິດກັນພໍດີ (ບໍ່ຊ້ອນກັນ). */
export function previousPeriod(p: Period): Period {
  const to = shiftDays(p.from, -1);
  return { from: shiftDays(to, -(p.days - 1)), to, days: p.days };
}

export function makePeriod(from: string, to: string): Period {
  return { from, to, days: daysBetween(from, to) };
}

/** `AND <col> = ANY($n)` ພ້ອມ args — scope null = ທຸກສາງ. */
function scoped(scope: Scope, col: string, nextArg: number): { clause: string; args: unknown[] } {
  if (scope === null) return { clause: "", args: [] };
  return { clause: `AND ${col} = ANY($${nextArg})`, args: [scope] };
}

/**
 * ການເຄື່ອນໄຫວຈິງ (ບໍ່ນັບການຍ້າຍພາຍໃນ) ຂອງ 1 ຊ່ວງເວລາ.
 * ໃຊ້ຮ່ວມກັນລະຫວ່າງ throughput, ແຮງງານ ແລະ ຕາຕະລາງຕໍ່ສາງ.
 */
const MOVE_CTE = `
  WITH selfmove AS (
    SELECT wh_code, doc_no, item_code
    FROM public.odg_wms_trans_detail
    WHERE trans_flag = 99 AND doc_date >= $1 AND doc_date <= $2
    GROUP BY wh_code, doc_no, item_code
    HAVING count(*) FILTER (WHERE calc_flag = 1) > 0
       AND count(*) FILTER (WHERE calc_flag = -1) > 0
  ),
  mv AS (
    SELECT t.*
    FROM public.odg_wms_trans_detail t
    WHERE t.doc_date >= $1 AND t.doc_date <= $2
      AND t.trans_flag <> 77
      AND NOT EXISTS (
        SELECT 1 FROM selfmove s
        WHERE s.wh_code = t.wh_code AND s.doc_no = t.doc_no AND s.item_code = t.item_code
      )`;

type MoveTotals = { in_qty: number; out_qty: number; in_lines: number; out_lines: number; in_docs: number; out_docs: number; lines: number; docs: number; users: number };

async function moveTotals(scope: Scope, p: Period): Promise<MoveTotals> {
  const s = scoped(scope, "t.wh_code", 3);
  const rows = await query<Record<string, string>>(
    `${MOVE_CTE} ${s.clause})
     SELECT COALESCE(SUM(qty) FILTER (WHERE calc_flag = 1), 0)::numeric::text  AS in_qty,
            COALESCE(SUM(qty) FILTER (WHERE calc_flag = -1), 0)::numeric::text AS out_qty,
            count(*) FILTER (WHERE calc_flag = 1)::text  AS in_lines,
            count(*) FILTER (WHERE calc_flag = -1)::text AS out_lines,
            count(DISTINCT doc_no) FILTER (WHERE calc_flag = 1)::text  AS in_docs,
            count(DISTINCT doc_no) FILTER (WHERE calc_flag = -1)::text AS out_docs,
            count(*)::text                       AS lines,
            count(DISTINCT doc_no)::text         AS docs,
            count(DISTINCT user_created)::text   AS users
     FROM mv`,
    [p.from, p.to, ...s.args],
  );
  const r = rows[0] ?? {};
  return {
    in_qty: n(r.in_qty), out_qty: n(r.out_qty),
    in_lines: int(r.in_lines), out_lines: int(r.out_lines),
    in_docs: int(r.in_docs), out_docs: int(r.out_docs),
    lines: int(r.lines), docs: int(r.docs), users: int(r.users),
  };
}

/**
 * ໄລຍະເວລາຈາກເອກະສານຕົ້ນທາງ → ການເຄື່ອນໄຫວຈິງໃນ WMS (ມື້).
 *   ຂາເຂົ້າ  flag 1     = PO/ໃບຮັບ → ຮັບເຂົ້າສາງ (dock-to-stock)
 *   ຂາອອກ   flag 2, 72 = ໃບເບີກ/ໂອນ/ບິນຂາຍ → ຈ່າຍອອກ (order cycle time)
 *
 * ຂາອອກຕ້ອງນັບ **ທັງ 2 flag**: 2 ຄືແຖວທີ່ ERP ຂຽນ (30 ມື້ຫຼ້າສຸດ 3,018 ໃບ) ສ່ວນ
 * 72 ຄືແຖວທີ່ໜ້າຈ່າຍອອກໃນລະບົບຂຽນ (ພຽງ 2 ໃບ) — ນັບແຕ່ 72 ຈະໄດ້ຕົວຢ່າງນ້ອຍເກີນ
 * ຈົນຕົວເລກບໍ່ມີຄວາມໝາຍ (ຄືກັບ pendingOut.OUT_MOVE_FLAGS ທີ່ນັບທັງສອງ).
 *
 * ຂໍ້ຈຳກັດ: ເວລາທີ່ໃຊ້ຄື create_date_time_now ຂອງແຖວ WMS — ສຳລັບ flag 2 ນັ້ນຄື
 * ເວລາທີ່ ERP ບັນທຶກ ບໍ່ແມ່ນເວລາທີ່ເຄື່ອງອອກຈາກປະຕູແທ້ໆ.
 *
 * ຕັດຄ່າຕິດລົບ (ເອກະສານລົງວັນທີຫຼັງການເຄື່ອນໄຫວ) ແລະ ເກີນ 1 ປີ (ຂໍ້ມູນເກົ່າຄ້າງ).
 */
async function leadTime(scope: Scope, p: Period, wmsFlags: number[]): Promise<LeadTime> {
  const s = scoped(scope, "t.wh_code", 4);
  const rows = await query<{ p50: string | null; p90: string | null; docs: string }>(
    `WITH d AS (
       SELECT t.doc_no,
              MIN(t.create_date_time_now::date - src.doc_date) AS days
       FROM public.odg_wms_trans t
       JOIN public.ic_trans src ON src.doc_no = t.doc_ref
       WHERE t.trans_flag = ANY($3)
         AND t.create_date_time_now >= $1::date
         AND t.create_date_time_now < ($2::date + 1)
         ${s.clause}
       GROUP BY t.doc_no
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::numeric::text AS p50,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY days)::numeric::text AS p90,
            count(*)::text AS docs
     FROM d WHERE days >= 0 AND days <= 365`,
    [p.from, p.to, wmsFlags, ...s.args],
  );
  const r = rows[0];
  return {
    p50: r?.p50 == null ? null : n(r.p50),
    p90: r?.p90 == null ? null : n(r.p90),
    docs: int(r?.docs),
  };
}

/** ສະຫຼຸບກອງຄ້າງ ຈາກລາຍການທີ່ລາຍງານອື່ນຄິດໃຫ້ແລ້ວ (ນິຍາມດຽວກັນ). */
function summarizeBacklog(rows: { days_waiting: number; remaining: number }[]): Backlog {
  if (rows.length === 0) return { docs: 0, qty: 0, avg_days: 0, over_7d: 0, oldest_days: 0 };
  const days = rows.map((r) => r.days_waiting);
  return {
    docs: rows.length,
    qty: n(rows.reduce((s, r) => s + r.remaining, 0)),
    avg_days: n(days.reduce((s, d) => s + d, 0) / rows.length),
    over_7d: rows.filter((r) => r.days_waiting > 7).length,
    oldest_days: Math.max(...days),
  };
}

/** ຈຳນວນເອກະສານທີ່ມີການບັນທຶກ "ຈ່າຍ/ຮັບ ບໍ່ຄົບ" ພ້ອມເຫດຜົນ (migration 038). */
async function shortNotes(scope: Scope, p: Period): Promise<number> {
  const s = scoped(scope, "t.wh_code", 3);
  try {
    const rows = await query<{ n: string }>(
      `SELECT count(DISTINCT (mn.doc_no, mn.item_code))::text AS n
       FROM public.odg_wms_move_note mn
       LEFT JOIN public.odg_wms_trans t ON t.doc_no = mn.doc_no
       WHERE mn.created_at >= $1::date AND mn.created_at < ($2::date + 1) ${s.clause}`,
      [p.from, p.to, ...s.args],
    );
    return int(rows[0]?.n);
  } catch {
    return 0; // ຍັງບໍ່ໄດ້ run migration 038
  }
}

/**
 * ຄວາມຖືກຕ້ອງຂອງຍອດ (IRA) ຈາກການນັບຄັ້ງລ່າສຸດ**ທີ່ປິດແລ້ວ**ຂອງແຕ່ລະສາງ.
 *
 * ຮັບສະເພາະ session ທີ່ status = 'closed' ໂດຍເຈດຕະນາ: session ທີ່ຍັງເປີດຢູ່ນັບ
 * ບໍ່ທັນທົ່ວທຸກບ່ອນ ຈຶ່ງມີລາຍການທີ່ "ນັບໄດ້ໜ້ອຍກວ່າລະບົບ" ຈຳນວນຫຼາຍ ທີ່ບໍ່ແມ່ນ
 * ຄວາມຜິດພາດຂອງຍອດ ແຕ່ຄືການນັບຍັງບໍ່ແລ້ວ (session 5 ຂອງສາງ 1203: 986 ຈາກ
 * 1,554 ລາຍການເປັນແບບນັ້ນ → ຖ້າເອົາມາຄິດຈະໄດ້ IRA 16% ເຊິ່ງຜິດຄວາມຈິງ).
 *
 * ນັບສະເພາະລາຍການທີ່**ນັບຈິງ** — ລາຍການທີ່ບໍ່ໄດ້ນັບບໍ່ຖືວ່າຜິດ.
 */
async function iraLatest(scope: Scope): Promise<Ira[]> {
  const s = scoped(scope, "se.wh_code", 1);
  try {
    return (
      await query<{ wh_code: string; count_date: string | null; items: string; matched: string }>(
        `WITH latest AS (
           SELECT DISTINCT ON (se.wh_code) se.session_id, se.wh_code, se.count_date
           FROM public.wms_stocktake_session se
           WHERE se.status = 'closed'
             AND EXISTS (SELECT 1 FROM public.wms_stocktake_line l WHERE l.session_id = se.session_id)
             ${s.clause}
           ORDER BY se.wh_code, se.count_date DESC NULLS LAST, se.session_id DESC
         ),
         counted AS (
           SELECT l.session_id, l.item_code, SUM(l.qty) AS qty
           FROM public.wms_stocktake_line l
           JOIN latest la ON la.session_id = l.session_id
           GROUP BY 1, 2
         ),
         snap AS (
           SELECT sn.session_id, sn.item_code, SUM(sn.snapshot_qty) AS qty
           FROM public.wms_stocktake_snapshot sn
           JOIN latest la ON la.session_id = sn.session_id
           GROUP BY 1, 2
         )
         SELECT la.wh_code,
                to_char(la.count_date, 'YYYY-MM-DD') AS count_date,
                count(*)::text AS items,
                count(*) FILTER (
                  WHERE abs(c.qty - COALESCE(sp.qty, 0)) < 0.001
                )::text AS matched
           FROM counted c
           JOIN latest la ON la.session_id = c.session_id
           LEFT JOIN snap sp ON sp.session_id = c.session_id AND sp.item_code = c.item_code
          GROUP BY la.wh_code, la.count_date
          ORDER BY la.wh_code`,
        s.args,
      )
    ).map((r) => {
      const items = int(r.items);
      const matched = int(r.matched);
      return {
        wh_code: r.wh_code,
        count_date: r.count_date,
        items_counted: items,
        matched,
        accuracy: items > 0 ? Math.round((matched / items) * 1000) / 10 : 0,
      };
    });
  } catch {
    return [];
  }
}

/** ພື້ນທີ່: ມີ location ຈັກບ່ອນ, ໃຊ້ຢູ່ຈັກບ່ອນ, ວັດຂະໜາດແລ້ວຈັກບ່ອນ (migration 037). */
async function spaceStats(scope: Scope): Promise<PerformanceReport["space"]> {
  const loc = scoped(scope, "l.wh_code", 1);
  const bal = scoped(scope, "t.wh_code", 1);
  const rack = scoped(scope, "r.wh_code", 1);
  const [locRows, usedRows, rackRows] = await Promise.all([
    query<{ total: string; with_dims: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE l.width IS NOT NULL AND l.length IS NOT NULL AND l.height IS NOT NULL)::text AS with_dims
       FROM public.odg_wms_location1 l WHERE COALESCE(l.is_active, 1) = 1 ${loc.clause}`,
      loc.args,
    ),
    query<{ used: string }>(
      `SELECT count(*)::text AS used FROM (
         SELECT t.wh_code, NULLIF(TRIM(t.shelf_code1), '') AS loc
         FROM public.odg_wms_trans_detail t
         WHERE NULLIF(TRIM(t.shelf_code1), '') IS NOT NULL ${bal.clause}
         GROUP BY 1, 2
         HAVING SUM(t.qty * t.calc_flag) > 0.0001
       ) x`,
      bal.args,
    ),
    query<{ total: string; with_dims: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE r.width IS NOT NULL)::text AS with_dims
       FROM public.odg_wms_location r WHERE COALESCE(r.is_active, 1) = 1 ${rack.clause}`,
      rack.args,
    ),
  ]);
  const locations = int(locRows[0]?.total);
  const used = Math.min(int(usedRows[0]?.used), locations || Number.MAX_SAFE_INTEGER);
  return {
    locations,
    used,
    empty: Math.max(locations - used, 0),
    with_dims: int(locRows[0]?.with_dims),
    racks: int(rackRows[0]?.total),
    racks_with_dims: int(rackRows[0]?.with_dims),
  };
}

async function operators(scope: Scope, p: Period): Promise<OperatorRow[]> {
  const s = scoped(scope, "t.wh_code", 3);
  return (
    await query<{ user_created: string; lines: string; docs: string; days: string }>(
      `${MOVE_CTE} ${s.clause})
       SELECT COALESCE(NULLIF(TRIM(user_created), ''), '—') AS user_created,
              count(*)::text                  AS lines,
              count(DISTINCT doc_no)::text    AS docs,
              count(DISTINCT doc_date)::text  AS days
       FROM mv
       GROUP BY 1
       ORDER BY count(*) DESC
       LIMIT 12`,
      [p.from, p.to, ...s.args],
    )
  ).map((r) => ({ user_created: r.user_created, lines: int(r.lines), docs: int(r.docs), days: int(r.days) }));
}

async function byHour(scope: Scope, p: Period): Promise<{ hour: number; lines: number }[]> {
  const s = scoped(scope, "t.wh_code", 3);
  const rows = await query<{ hour: string; lines: string }>(
    `${MOVE_CTE} ${s.clause})
     SELECT EXTRACT(HOUR FROM create_date_time_now)::int::text AS hour, count(*)::text AS lines
     FROM mv WHERE create_date_time_now IS NOT NULL
     GROUP BY 1 ORDER BY 1`,
    [p.from, p.to, ...s.args],
  );
  const by = new Map(rows.map((r) => [int(r.hour), int(r.lines)]));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, lines: by.get(h) ?? 0 }));
}

async function byWarehouse(scope: Scope, p: Period): Promise<WarehouseRow[]> {
  const s = scoped(scope, "t.wh_code", 3);
  return (
    await query<{ wh_code: string; wh_name: string | null; in_qty: string; out_qty: string; lines: string; docs: string; users: string }>(
      `${MOVE_CTE} ${s.clause})
       SELECT mv.wh_code,
              MAX(w.name_1)                                            AS wh_name,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.calc_flag = 1), 0)::numeric::text  AS in_qty,
              COALESCE(SUM(mv.qty) FILTER (WHERE mv.calc_flag = -1), 0)::numeric::text AS out_qty,
              count(*)::text                        AS lines,
              count(DISTINCT mv.doc_no)::text       AS docs,
              count(DISTINCT mv.user_created)::text AS users
       FROM mv
       LEFT JOIN public.ic_warehouse w ON w.code = mv.wh_code
       GROUP BY mv.wh_code
       ORDER BY count(*) DESC`,
      [p.from, p.to, ...s.args],
    )
  ).map((r) => ({
    wh_code: r.wh_code,
    wh_name: r.wh_name,
    in_qty: n(r.in_qty),
    out_qty: n(r.out_qty),
    lines: int(r.lines),
    docs: int(r.docs),
    users: int(r.users),
  }));
}

// ─────────────────────────── ຕົວລາຍງານ ───────────────────────────

/**
 * ລວມທຸກ KPI ຂອງຊ່ວງເວລາໜຶ່ງ. ທຸກ query ແລ່ນຂະໜານກັນ —
 * ຕົວທີ່ຊ້າສຸດຄື ຄ້າງຮັບ (odg_po_remain ~1.2 ວິ) ຈຶ່ງລວມແລ້ວປະມານ 2-3 ວິ.
 */
export async function warehousePerformance(scope: Scope, period: Period): Promise<PerformanceReport> {
  const prev = previousPeriod(period);

  const [
    now, before, inLead, outCycle, shorts,
    receipts, issues, hp, ms, ira, space, top, hours, whs,
  ] = await Promise.all([
    moveTotals(scope, period),
    moveTotals(scope, prev),
    leadTime(scope, period, [1]),
    leadTime(scope, period, [2, 72]),
    shortNotes(scope, period),
    // limit ສູງ — ເອົາທຸກແຖວມາສະຫຼຸບເອງ ບໍ່ໄດ້ເອົາແຕ່ top 25
    pendingReceipts(scope, 5000),
    pendingIssues(scope, 5000),
    health(scope),
    minStockSummary(scope),
    iraLatest(scope),
    spaceStats(scope),
    operators(scope, period),
    byHour(scope, period),
    byWarehouse(scope, period),
  ]);

  const activeDays = Math.max(1, period.days);
  return {
    period,
    prev,
    throughput: {
      in_qty: { now: now.in_qty, prev: before.in_qty },
      out_qty: { now: now.out_qty, prev: before.out_qty },
      in_lines: { now: now.in_lines, prev: before.in_lines },
      out_lines: { now: now.out_lines, prev: before.out_lines },
      in_docs: { now: now.in_docs, prev: before.in_docs },
      out_docs: { now: now.out_docs, prev: before.out_docs },
    },
    inbound: { lead: inLead, backlog: summarizeBacklog(receipts) },
    outbound: { cycle: outCycle, backlog: summarizeBacklog(issues), short_notes: shorts },
    inventory: {
      ira,
      dead_items: hp.dead_items,
      dead_qty: hp.dead_qty,
      sn_mismatch: hp.sn_mismatch,
      below_min: ms.below,
      above_max: ms.above,
      min_rules: ms.rules,
      min_warehouses: ms.warehouses,
    },
    labor: {
      users: now.users,
      lines: { now: now.lines, prev: before.lines },
      docs: { now: now.docs, prev: before.docs },
      lines_per_day: n(now.lines / activeDays),
      lines_per_user_day: now.users > 0 ? n(now.lines / activeDays / now.users) : 0,
      top,
      by_hour: hours,
    },
    space,
    warehouses: whs,
  };
}
