import type { PoolClient } from "pg";
import { normAliasText } from "@/lib/packingList";

/**
 * ຈັບຄູ່ລາຍການໃນໃບ packing ຂອງຜູ້ສະໜອງ (ມີແຕ່ຄຳອະທິບາຍ) ກັບ **ສິນຄ້າ SML**
 * ແລ້ວ **ຈັດສັນເຂົ້າ PO ຄ້າງຮັບ** — ຈຳນວນທີ່ເກີນຄ້າງຮັບຂອງ PO ໜຶ່ງ
 * ຈະໄຫຼໄປ PO ຕໍ່ໄປ (ເກົ່າກ່ອນ) ໂດຍອັດຕະໂນມັດ.
 *
 * ຜົນທີ່ໄດ້ແມ່ນ **ຄຳແນະນຳ** — ໃຫ້ຜູ້ໃຊ້ກວດ/ແກ້ ກ່ອນສ້າງໃບກວດນັບ.
 */

/** ໜຶ່ງແຖວຄ້າງຮັບ (PO × ສິນຄ້າ) ໃນສາງໜຶ່ງ */
export type PendingPoLine = {
  po_no: string;
  po_date: string | null;
  approved: boolean;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  remaining: number;
};

/** ການຈັດສັນຈຳນວນເຂົ້າ PO ໜຶ່ງ */
export type Allocation = { po_no: string; qty: number; remaining: number; po_date: string | null };

/** ສິນຄ້າ SML ທີ່ແນະນຳໃຫ້ 1 ແຖວ */
export type Candidate = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  /** ຄ້າງຮັບລວມທຸກ PO ໃນສາງນີ້ */
  total_remaining: number;
  pos: string[];
  score: number;
  /** ມາຈາກການຈື່ໄວ້ (alias) — ເຊື່ອຖືໄດ້ສູງສຸດ */
  from_alias: boolean;
};

export type MatchedLine = {
  id: string;
  text: string;
  qty: number;
  /** ລະຫັດ SML ທີ່ເລືອກ (ຄຳແນະນຳອັນດັບ 1 ຫຼື ທີ່ຜູ້ໃຊ້ກຳນົດ) */
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  /** ໝັ້ນໃຈພໍທີ່ຈະໃຊ້ເລີຍບໍ່ (alias ຫຼື ຄະແນນຊະນະຂາດ) */
  confident: boolean;
  candidates: Candidate[];
  /** ແຜນຈັດສັນເຂົ້າ PO (ເກົ່າກ່ອນ, ເຕັມແລ້ວໄຫຼໄປໃບຕໍ່ໄປ) */
  allocations: Allocation[];
  /** ຈຳນວນທີ່ບໍ່ມີ PO ຮອງຮັບ (ເກີນຄ້າງຮັບທັງໝົດ) */
  unallocated: number;
  note: string;
};

// ─────────────────────────── text scoring ───────────────────────────

/** ໂຕເລກ/ຂະໜາດ ເຊັ່ນ 3/8 · 1-1/4 · 90 · 55 — ຕົວບອກທີ່ຂ້າມພາສາໄດ້ */
const NUM_TOKEN = /\d+(?:[./-]\d+)*/g;
/** ຄຳລາຕິນ (ຍີ່ຫໍ້/ລຸ້ນ) ເຊັ່ນ PURE · BS-M · ACONATIC */
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9-]{1,}/g;

function tokens(s: string) {
  const t = s ?? "";
  return {
    nums: new Set((t.match(NUM_TOKEN) ?? []).map((x) => x.replace(/^0+(?=\d)/, ""))),
    latin: new Set((t.match(LATIN_TOKEN) ?? []).map((x) => x.toUpperCase())),
  };
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * ຄະແນນຄວາມຄ້າຍ ລະຫວ່າງຂໍ້ຄວາມຜູ້ສະໜອງ (ອາດເປັນພາສາໄທ) ກັບຊື່ SML (ພາສາລາວ).
 * ອີງໂຕເລກ/ຂະໜາດ ແລະ ຄຳລາຕິນ ເພາະຊື່ພາສາຂ້າມກັນທຽບກົງບໍ່ໄດ້.
 */
export function similarity(srcText: string, smlName: string): number {
  const a = tokens(srcText);
  const b = tokens(smlName);
  if (a.nums.size === 0 && a.latin.size === 0) return 0;
  const numHit = overlap(a.nums, b.nums);
  const latinHit = overlap(a.latin, b.latin);
  const denom = Math.max(1, a.nums.size + a.latin.size);
  // ຄຳລາຕິນ (ຍີ່ຫໍ້) ບອກໄດ້ຊັດກວ່າໂຕເລກ
  return (numHit * 1 + latinHit * 2) / denom;
}

// ─────────────────────────── pending pool ───────────────────────────

const RECEIVED_PO = `COALESCE(NULLIF(TRIM(rd.ref_doc_no), ''), rh.ref_doc_no)`;

/**
 * ລາຍການຄ້າງຮັບທັງໝົດຂອງສາງ (ຫັກຍອດທີ່ WMS ຮັບແລ້ວ).
 * ຈຳກັດແຕ່ PO ທີ່ລະບຸໄດ້ ຖ້າສົ່ງ `poFilter` ມາ.
 */
export async function loadPendingPool(
  client: PoolClient,
  whCode: string,
  poFilter?: string[],
): Promise<PendingPoLine[]> {
  const rows = await client.query<{
    po_no: string; po_date: string | null; approve_status: number | null;
    item_code: string; item_name: string | null; unit_code: string | null; remaining: string;
  }>(
    `SELECT p.doc_no AS po_no,
            to_char(t.doc_date,'YYYY-MM-DD') AS po_date,
            t.approve_status,
            p.item_code,
            COALESCE(inv.name_1, NULLIF(p.item_name,'')) AS item_name,
            COALESCE(inv.unit_standard, p.unit_code) AS unit_code,
            (p.qty_balance - COALESCE((
               SELECT SUM(rd.qty)
                 FROM public.wms_product_receive rh
                 JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                WHERE ${RECEIVED_PO} = p.doc_no AND rd.item_code = p.item_code
                  AND (rh.status = 0 OR rh.status IS NULL) AND rh.warehouse_code = $1
             ), 0))::text AS remaining
       FROM public.odg_po_remain p
       JOIN public.ic_warehouse w ON w.name_1 = p.warehouse AND w.code = $1
       LEFT JOIN public.ic_trans t ON t.doc_no = p.doc_no AND t.trans_flag = 6
       LEFT JOIN public.ic_inventory inv ON inv.code = p.item_code
      WHERE p.qty_balance > 0 AND p.item_code NOT LIKE '97%'
        ${poFilter && poFilter.length > 0 ? "AND p.doc_no = ANY($2)" : ""}`,
    poFilter && poFilter.length > 0 ? [whCode, poFilter] : [whCode],
  );

  return rows.rows
    .map((r) => ({
      po_no: r.po_no,
      po_date: r.po_date,
      approved: (r.approve_status ?? 0) === 1,
      item_code: r.item_code,
      item_name: r.item_name,
      unit_code: r.unit_code,
      remaining: Number.parseFloat(r.remaining) || 0,
    }))
    .filter((r) => r.remaining > 0);
}

// ─────────────────────────── matching ───────────────────────────

export type MatchInput = {
  id: string;
  text: string;
  qty: number;
  item_code?: string | null;
  /** ລະຫັດຂອງຜູ້ສະໜອງຕາມໄຟລ໌ (ເຊັ່ນ A10000712322) — ກຸນແຈຈັບຄູ່ທີ່ແນ່ນອນທີ່ສຸດ */
  supplier_item_code?: string | null;
};

/**
 * ຈັບຄູ່ + ຈັດສັນ PO ໃຫ້ທຸກແຖວ.
 *
 * ລຳດັບການເລືອກສິນຄ້າ: ລະຫັດທີ່ຜູ້ໃຊ້ກຳນົດ → ລະຫັດທີ່ຢູ່ໃນຂໍ້ຄວາມ →
 * alias ທີ່ຈື່ໄວ້ → ຄະແນນຄວາມຄ້າຍ (ໂຕເລກ/ຂະໜາດ/ຍີ່ຫໍ້).
 * ການຈັດສັນ: PO ອະນຸມັດແລ້ວ, ເກົ່າກ່ອນ, ເຕັມແລ້ວໄຫຼໄປໃບຕໍ່ໄປ.
 */
export async function matchPackingLines(
  client: PoolClient,
  whCode: string,
  lines: MatchInput[],
  opts: { supplierCode?: string | null; poFilter?: string[] } = {},
): Promise<{ lines: MatchedLine[]; pool_size: number }> {
  const pool = await loadPendingPool(client, whCode, opts.poFilter);

  // ລວມຕໍ່ສິນຄ້າ: ຄ້າງຮັບລວມ + ລາຍການ PO ຂອງມັນ
  const byItem = new Map<string, { name: string | null; unit: string | null; lines: PendingPoLine[] }>();
  for (const p of pool) {
    const e = byItem.get(p.item_code) ?? { name: p.item_name, unit: p.unit_code, lines: [] };
    e.lines.push(p);
    byItem.set(p.item_code, e);
  }
  // ເກົ່າກ່ອນ — ຮັບ PO ທີ່ສັ່ງກ່ອນໃຫ້ຈົບກ່ອນ
  for (const e of byItem.values()) {
    e.lines.sort((a, b) => (a.po_date ?? "9999").localeCompare(b.po_date ?? "9999") || a.po_no.localeCompare(b.po_no));
  }

  // alias ທີ່ຈື່ໄວ້ — ທັງລະຫັດຜູ້ສະໜອງ ແລະ ຂໍ້ຄວາມຊື່
  const keys = Array.from(new Set(
    lines.flatMap((l) => [normAliasText(l.supplier_item_code ?? ""), normAliasText(l.text)]).filter(Boolean),
  ));
  const aliasMap = new Map<string, string>();
  if (keys.length > 0) {
    const a = await client.query<{ source_text_norm: string; item_code: string }>(
      `SELECT DISTINCT ON (source_text_norm) source_text_norm, item_code
         FROM public.wms_packing_item_alias
        WHERE source_text_norm = ANY($1)
          AND (supplier_code IS NULL OR $2::text IS NULL OR supplier_code = $2)
        ORDER BY source_text_norm, (supplier_code = $2) DESC NULLS LAST, hits DESC`,
      [keys, opts.supplierCode ?? null],
    );
    for (const r of a.rows) aliasMap.set(r.source_text_norm, r.item_code);
  }

  /** ຈັດສັນ qty ເຂົ້າ PO ຂອງສິນຄ້ານີ້ — ເຕັມແລ້ວໄຫຼໄປໃບຕໍ່ໄປ */
  const allocate = (itemCode: string, qty: number) => {
    const entry = byItem.get(itemCode);
    const allocations: Allocation[] = [];
    let left = qty;
    for (const p of entry?.lines ?? []) {
      if (left <= 1e-9) break;
      if (!p.approved) continue; // ຮັບໄດ້ສະເພາະ PO ທີ່ອະນຸມັດແລ້ວ
      const take = Math.min(left, p.remaining);
      if (take <= 0) continue;
      allocations.push({ po_no: p.po_no, qty: take, remaining: p.remaining, po_date: p.po_date });
      left -= take;
    }
    return { allocations, unallocated: Math.max(0, left) };
  };

  const out: MatchedLine[] = [];
  for (const l of lines) {
    const notes: string[] = [];
    let candidates: Candidate[] = [];
    let chosen: string | null = null;
    let fromAlias = false;

    const explicit = (l.item_code ?? "").trim();
    const supCode = (l.supplier_item_code ?? "").trim();
    const inText = (l.text.match(/\b\d{6}-\d{3,4}\b/) ?? [])[0]; // ຮູບແບບລະຫັດ SML ໃນຂໍ້ຄວາມ
    const aliasByCode = supCode ? aliasMap.get(normAliasText(supCode)) : undefined;
    const aliasByText = aliasMap.get(normAliasText(l.text));

    if (explicit && byItem.has(explicit)) chosen = explicit;
    else if (explicit) { chosen = explicit; notes.push("ລະຫັດນີ້ບໍ່ມີໃນ PO ຄ້າງຮັບຂອງສາງນີ້"); }
    else if (aliasByCode) { chosen = aliasByCode; fromAlias = true; notes.push(`ຈາກລະຫັດຜູ້ສະໜອງ ${supCode} ທີ່ຈື່ໄວ້`); }
    else if (inText && byItem.has(inText)) { chosen = inText; notes.push("ພົບລະຫັດ SML ໃນຂໍ້ຄວາມ"); }
    else if (aliasByText) { chosen = aliasByText; fromAlias = true; notes.push("ຈາກຊື່ທີ່ຈື່ໄວ້"); }
    else if (supCode) { notes.push(`ລະຫັດຜູ້ສະໜອງ ${supCode} ຍັງບໍ່ໄດ້ຈັບຄູ່ — ຈັບເທື່ອດຽວ ຄັ້ງໜ້າອັດຕະໂນມັດ`); }

    // ຄຳແນະນຳ — ຈັດອັນດັບຈາກຄວາມຄ້າຍ + ຈຳນວນທີ່ຄ້າງພຽງພໍ
    const scored: Candidate[] = [];
    for (const [code, e] of byItem) {
      const totalRemaining = e.lines.reduce((s, p) => s + (p.approved ? p.remaining : 0), 0);
      // ຄະແນນອີງ **ຂໍ້ຄວາມຢ່າງດຽວ** — ຈຳນວນຄ້າງບໍ່ຄວນປ່ຽນວ່າແມ່ນສິນຄ້າໃດ
      // (ບໍ່ດັ່ງນັ້ນ ຂໍ້ຄວາມດຽວກັນແຕ່ຄົນລະຈຳນວນ ຈະຈັບຄູ່ຕ່າງກັນ)
      let score = similarity(l.text, `${code} ${e.name ?? ""}`);
      if (code === chosen) score = fromAlias ? 10 : 9;
      if (score <= 0) continue;
      scored.push({
        item_code: code, item_name: e.name, unit_code: e.unit,
        total_remaining: totalRemaining, pos: e.lines.map((p) => p.po_no),
        score: Math.round(score * 100) / 100, from_alias: fromAlias && code === chosen,
      });
    }
    // ຄະແນນເທົ່າກັນ → ເອົາອັນທີ່ຄ້າງຮັບພຽງພໍກ່ອນ, ແລ້ວອັນທີ່ຄ້າງຫຼາຍກວ່າ
    scored.sort((a, b) =>
      b.score - a.score
      || Number(b.total_remaining >= l.qty) - Number(a.total_remaining >= l.qty)
      || b.total_remaining - a.total_remaining);
    candidates = scored.slice(0, 5);

    // ບໍ່ມີການກຳນົດ → ໃຊ້ອັນດັບ 1 ຖ້າຊະນະຂາດ
    let confident = chosen !== null && (fromAlias || !!explicit || !!inText);
    if (!chosen && candidates.length > 0) {
      const best = candidates[0];
      const second = candidates[1]?.score ?? 0;
      if (best.score >= 1 && best.score >= second * 1.5) {
        chosen = best.item_code;
        confident = true;
        notes.push("ຈັບຄູ່ອັດຕະໂນມັດ — ກະລຸນາກວດຄືນ");
      } else {
        notes.push("ບໍ່ໝັ້ນໃຈ — ເລືອກສິນຄ້າເອງ");
      }
    } else if (!chosen) {
      notes.push("ບໍ່ພົບສິນຄ້າທີ່ຄ້າຍກັນໃນ PO ຄ້າງຮັບ");
    }

    const entry = chosen ? byItem.get(chosen) : undefined;
    const { allocations, unallocated } = chosen ? allocate(chosen, l.qty) : { allocations: [], unallocated: l.qty };
    if (chosen && allocations.length > 1) notes.push(`ແບ່ງເຂົ້າ ${allocations.length} PO (ໃບກ່ອນຄ້າງບໍ່ພໍ)`);
    if (chosen && unallocated > 0) notes.push(`ເກີນຄ້າງຮັບທຸກ PO ຢູ່ ${unallocated}`);

    out.push({
      id: l.id,
      text: l.text,
      qty: l.qty,
      item_code: chosen,
      item_name: entry?.name ?? candidates.find((c) => c.item_code === chosen)?.item_name ?? null,
      unit_code: entry?.unit ?? null,
      confident,
      candidates,
      allocations,
      unallocated,
      note: notes.join(" · "),
    });
  }

  return { lines: out, pool_size: pool.length };
}
