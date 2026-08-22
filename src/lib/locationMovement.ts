/**
 * ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ ຕາມບ່ອນເກັບ (location) —
 *
 *   ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ = ຄົງເຫຼືອ   (ຕໍ່ 1 ບ່ອນເກັບ)
 *
 * ຄົນລະມຸມກັບ `dailyMovement.ts` ບ່ອນສຳຄັນ: ບ່ອນນັ້ນເປັນລະດັບ**ສາງ** ຈຶ່ງ
 * ຕັດການຍ້າຍບ່ອນເກັບພາຍໃນສາງ (trans_flag 77 ແລະ 99 ຄູ່ ±1) ອອກ ເພາະຍອດສາງບໍ່ປ່ຽນ.
 * ແຕ່ລະດັບ**ບ່ອນເກັບ** ການຍ້າຍນັ້ນເປັນການເຄື່ອນໄຫວຈິງ — ຊັ້ນຕົ້ນທາງໜ້ອຍລົງ
 * ຊັ້ນປາຍທາງເພີ່ມຂຶ້ນ — ຖ້າຕັດອອກ ສົມຜົນ ຍົກມາ+ຮັບ−ຈ່າຍ=ຄົງເຫຼືອ ຈະບໍ່ລົງ.
 * ດັ່ງນັ້ນຈຶ່ງ**ນັບທັງໝົດ** ແລ້ວແຍກສ່ວນທີ່ເປັນການຍ້າຍພາຍໃນ (`move_in`/`move_out`)
 * ໄວ້ໃຫ້ຜູ້ອ່ານເຫັນວ່າ ຮັບ/ຈ່າຍ ນັ້ນມາຈາກການຍ້າຍຊັ້ນ ຫຼື ມາຈາກນອກສາງແທ້.
 *
 * ບໍ່ກັ່ນຕອງ `status`: ໃນ odg_wms_trans_detail status=1 ບໍ່ແມ່ນ "ຍົກເລີກ" —
 * ມັນໝາຍເຖິງຂາອອກ (−1) ຂອງການຍ້າຍຊັ້ນ (ເບິ່ງໝາຍເຫດໃນໜ້າ /movements/balance).
 */
import { query } from "@/lib/db";

export type LocRow = {
  rack: string;
  rack_name: string | null;
  loc: string;
  loc_name: string | null;
  /** ຍອດຍົກມາ — ຄົງເຫຼືອຂອງບ່ອນເກັບກ່ອນວັນທີ່ເລີ່ມ. */
  opening: number;
  qty_in: number;
  qty_out: number;
  /** ສ່ວນຂອງ ຮັບເຂົ້າ/ຈ່າຍອອກ ທີ່ເປັນການຍ້າຍບ່ອນເກັບພາຍໃນສາງ. */
  move_in: number;
  move_out: number;
  /** ຄົງເຫຼືອ = ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ. */
  closing: number;
  /** ຈຳນວນລາຍການສິນຄ້າ / ເອກະສານ ທີ່ເຄື່ອນໄຫວໃນຊ່ວງ. */
  items: number;
  docs: number;
};

export type LocFilter = {
  wh: string;
  from: string;
  to: string;
  /** ເອົາບ່ອນເກັບທີ່ບໍ່ເຄື່ອນໄຫວ (ມີແຕ່ຍອດຄ້າງ) ມານຳບໍ່. */
  includeIdle: boolean;
};

/** ບ່ອນເກັບຫຼາຍກວ່ານີ້ໃນໃບດຽວ ອ່ານບໍ່ໄຫວຢູ່ແລ້ວ — ກັນ payload ໃຫຍ່ເກີນ. */
export const MAX_LOCATIONS = 3000;

const num = (v: string | null | undefined) => Math.round((Number.parseFloat(v ?? "") || 0) * 1e6) / 1e6;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * ແຖວດິບ: ນັບຄັ້ງດຽວທັງ ຍອດຍົກມາ (doc_date < from) ແລະ ການເຄື່ອນໄຫວໃນຊ່ວງ.
 *
 * `reloc` ດຶງຄູ່ flag 99 ທີ່ມີທັງ +1 ແລະ −1 ໃນສາງດຽວກັນ = ຍ້າຍພາຍໃນ. ຍົກຂຶ້ນມາ
 * ເປັນ CTE ນ້ອຍກ່ອນ (ຄືກັນກັບ dailyMovement) ເພາະ correlated NOT EXISTS ຕໍ່
 * ຕາຕະລາງທັງໝົດຊ້າຫຼາຍ.
 */
const BASE_CTE = `
  WITH reloc AS (
    SELECT doc_no, item_code
    FROM public.odg_wms_trans_detail
    WHERE trans_flag = 99 AND wh_code = $1 AND doc_date >= $2 AND doc_date <= $3
    GROUP BY doc_no, item_code
    HAVING count(*) FILTER (WHERE calc_flag = 1) > 0
       AND count(*) FILTER (WHERE calc_flag = -1) > 0
  ),
  base AS (
    SELECT COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
           COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS loc,
           t.qty, t.calc_flag, t.item_code, t.item_name, t.unit_code, t.doc_no, t.doc_date,
           (t.trans_flag = 77 OR r.doc_no IS NOT NULL) AS is_reloc
    FROM public.odg_wms_trans_detail t
    LEFT JOIN reloc r ON r.doc_no = t.doc_no AND r.item_code = t.item_code AND t.trans_flag = 99
    WHERE t.wh_code = $1 AND t.doc_date <= $3
  )`;

type MasterRow = { code: string; name: string | null; rack: string | null };

/** ຊື່ຊັ້ນວາງ (odg_wms_location) ແລະ ຊື່ບ່ອນເກັບ (odg_wms_location1) ຂອງສາງໜຶ່ງ. */
async function locationNames(wh: string) {
  const [racks, locs] = await Promise.all([
    query<MasterRow>(`SELECT code, name_1 AS name, NULL::text AS rack FROM public.odg_wms_location WHERE wh_code = $1`, [wh]),
    query<MasterRow>(`SELECT code, name_1 AS name, location_id AS rack FROM public.odg_wms_location1 WHERE wh_code = $1`, [wh]),
  ]);
  const rackName = new Map<string, string>();
  for (const r of racks) if (r.code && r.name) rackName.set(r.code.trim(), r.name);
  const locName = new Map<string, string>();
  for (const l of locs) if (l.code && l.name) locName.set(`${(l.rack ?? "").trim()} ${l.code.trim()}`, l.name);
  return { rackName, locName };
}

/** ໜຶ່ງແຖວຕໍ່ໜຶ່ງບ່ອນເກັບ — ຫົວໃຈຂອງລາຍງານ. */
export async function locationFlow(f: LocFilter): Promise<LocRow[]> {
  const [rows, names] = await Promise.all([
    query<{
      rack: string; loc: string; opening: string; qty_in: string; qty_out: string;
      move_in: string; move_out: string; items: number; docs: number;
    }>(
      `${BASE_CTE}
       SELECT rack, loc,
              COALESCE(SUM(qty * calc_flag) FILTER (WHERE doc_date < $2), 0)::numeric::text AS opening,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = 1), 0)::numeric::text  AS qty_in,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = -1), 0)::numeric::text AS qty_out,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = 1 AND is_reloc), 0)::numeric::text  AS move_in,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = -1 AND is_reloc), 0)::numeric::text AS move_out,
              count(DISTINCT item_code) FILTER (WHERE doc_date >= $2)::int AS items,
              count(DISTINCT doc_no) FILTER (WHERE doc_date >= $2)::int AS docs
       FROM base
       GROUP BY rack, loc
       HAVING COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2), 0) <> 0
          ${f.includeIdle ? "OR COALESCE(SUM(qty * calc_flag) FILTER (WHERE doc_date < $2), 0) <> 0" : ""}
       ORDER BY rack, loc
       LIMIT ${MAX_LOCATIONS}`,
      [f.wh, f.from, f.to],
    ),
    locationNames(f.wh),
  ]);

  return rows.map((r) => {
    const opening = num(r.opening);
    const qty_in = num(r.qty_in);
    const qty_out = num(r.qty_out);
    return {
      rack: r.rack,
      rack_name: names.rackName.get(r.rack) ?? null,
      loc: r.loc,
      loc_name: names.locName.get(`${r.rack} ${r.loc}`) ?? null,
      opening,
      qty_in,
      qty_out,
      move_in: num(r.move_in),
      move_out: num(r.move_out),
      closing: round(opening + qty_in - qty_out),
      items: r.items,
      docs: r.docs,
    };
  });
}

export type LocTotals = {
  locations: number;
  opening: number;
  qty_in: number;
  qty_out: number;
  closing: number;
  move_in: number;
  move_out: number;
};

export function locTotals(rows: LocRow[]): LocTotals {
  const t = rows.reduce(
    (s, r) => ({
      opening: s.opening + r.opening,
      qty_in: s.qty_in + r.qty_in,
      qty_out: s.qty_out + r.qty_out,
      closing: s.closing + r.closing,
      move_in: s.move_in + r.move_in,
      move_out: s.move_out + r.move_out,
    }),
    { opening: 0, qty_in: 0, qty_out: 0, closing: 0, move_in: 0, move_out: 0 },
  );
  return {
    locations: rows.length,
    opening: round(t.opening),
    qty_in: round(t.qty_in),
    qty_out: round(t.qty_out),
    closing: round(t.closing),
    move_in: round(t.move_in),
    move_out: round(t.move_out),
  };
}

export type LocDay = { date: string; opening: number; qty_in: number; qty_out: number; closing: number };
export type LocItem = {
  item_code: string; item_name: string | null; unit_code: string | null;
  opening: number; qty_in: number; qty_out: number; closing: number;
};

/** YYYY-MM-DD ທຸກມື້ໃນຊ່ວງ — ມື້ທີ່ງຽບກໍຍັງມີແຖວ. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * ລາຍລະອຽດຂອງບ່ອນເກັບໜຶ່ງ: ໄຫຼຕາມມື້ ແລະ ຍອດຕາມສິນຄ້າ.
 * ທັງສອງໃຊ້ນິຍາມດຽວກັນກັບຕາຕະລາງໃຫຍ່ ຈຶ່ງບວກລົບແລ້ວລົງກັນ.
 */
export async function locationDetail(
  wh: string, rack: string, loc: string, from: string, to: string,
): Promise<{ days: LocDay[]; items: LocItem[] }> {
  const where = `rack = $4 AND loc = $5`;
  const args = [wh, from, to, rack, loc];

  const [dayRows, itemRows] = await Promise.all([
    query<{ d: string | null; opening: string; qin: string; qout: string }>(
      `${BASE_CTE}
       SELECT to_char(doc_date, 'YYYY-MM-DD') AS d,
              '0' AS opening,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag = 1), 0)::numeric::text  AS qin,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag = -1), 0)::numeric::text AS qout
       FROM base WHERE ${where} AND doc_date >= $2
       GROUP BY 1
       UNION ALL
       SELECT NULL, COALESCE(SUM(qty * calc_flag), 0)::numeric::text, '0', '0'
       FROM base WHERE ${where} AND doc_date < $2`,
      args,
    ),
    query<{
      item_code: string; item_name: string | null; unit_code: string | null;
      opening: string; qin: string; qout: string;
    }>(
      `${BASE_CTE}
       SELECT item_code,
              MAX(item_name) AS item_name,
              MAX(unit_code) AS unit_code,
              COALESCE(SUM(qty * calc_flag) FILTER (WHERE doc_date < $2), 0)::numeric::text AS opening,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = 1), 0)::numeric::text  AS qin,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = -1), 0)::numeric::text AS qout
       FROM base WHERE ${where}
       GROUP BY item_code
       HAVING COALESCE(SUM(qty * calc_flag), 0) <> 0
           OR COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2), 0) <> 0
       ORDER BY item_code
       LIMIT 500`,
      args,
    ),
  ]);

  const byDate = new Map(dayRows.filter((r) => r.d).map((r) => [r.d as string, r]));
  let running = num(dayRows.find((r) => !r.d)?.opening ?? "0");
  const days = dateRange(from, to).map((date) => {
    const r = byDate.get(date);
    const qty_in = num(r?.qin);
    const qty_out = num(r?.qout);
    const row: LocDay = { date, opening: round(running), qty_in, qty_out, closing: round(running + qty_in - qty_out) };
    running = row.closing;
    return row;
  });

  const items = itemRows.map((r) => {
    const opening = num(r.opening);
    const qty_in = num(r.qin);
    const qty_out = num(r.qout);
    return {
      item_code: r.item_code,
      item_name: r.item_name,
      unit_code: r.unit_code,
      opening,
      qty_in,
      qty_out,
      closing: round(opening + qty_in - qty_out),
    };
  });

  return { days, items };
}
