import Link from "next/link";
import { query } from "@/lib/db";
import DeleteIssueButton from "./DeleteIssueButton";
import ScanLogPanel from "./ScanLogPanel";
import { hasPerm } from "@/lib/permissions";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { Chip, KpiCard, EmptyState } from "@/components/ui/Card";
import {
  BuildingIcon,
  CalendarIcon,
  ListIcon,
  PackageIcon,
  SearchIcon,
  UserIcon,
} from "@/components/ui/Icons";

const PAGE_SIZE = 20;
const BASE_PATH = "/movements/issue";
/** odg_wms_trans(_detail) flag for a WMS goods issue (matches the POST route). */
const ISSUE_STOCK_FLAG = 72;

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  doc_ref: string | null;
  wh_code: string | null;
  wh_name: string | null;
  creator_code: string | null;
  creator_name: string | null;
  line_count: number;
  out_qty: string;
  /** ໃບຈັດຖ້ຽວທີ່ DP ນີ້ອອກມາຈາກ (ຖ້າຈ່າຍຜ່ານແທັບ "ໃບຈັດຖ້ຽວ"). */
  trip_doc_no: string | null;
  trip_car: string | null;
  trip_car_name: string | null;
};

type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  shelf_code: string | null;
  shelf_code1: string | null;
  pallet: string | null;
  qty: string;
};

type WarehouseOption = { code: string; name: string | null };
type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

/** ISO date string (YYYY-MM-DD) → dd-MM-yyyy for display. */
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export default async function IssueHistory({
  session,
  params,
}: {
  session: Session;
  params: SearchParams;
}) {
  const accessible = accessibleWarehouses(session);

  const search = pickStr(params.q);
  const requestedWh = pickStr(params.wh);
  const allTime = pickStr(params.all) === "1";
  const today = new Date().toISOString().slice(0, 10);
  const explicitFrom = pickStr(params.from);
  const explicitTo = pickStr(params.to);
  const fromDate = allTime ? "" : explicitFrom || (explicitTo ? "" : today);
  const toDate = allTime ? "" : explicitTo || (explicitFrom ? "" : today);
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  const whOptions =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  const allowedSet = new Set(whOptions.map((w) => w.code));
  const wh = requestedWh && allowedSet.has(requestedWh) ? requestedWh : "";

  // Headers are odg_wms_trans rows (flag 72, DP doc). Quantity/lines come from
  // the matching odg_wms_trans_detail rows.
  const where: string[] = [
    `h.trans_flag = ${ISSUE_STOCK_FLAG}`,
    `h.doc_no LIKE 'DP%'`,
    // Only real OUT documents (a −1 leg at a real warehouse). Excludes the +1
    // in-transit leg of a transfer and the receive/return docs (which move out of 9903).
    `EXISTS (SELECT 1 FROM public.odg_wms_trans_detail od WHERE od.doc_no = h.doc_no AND od.calc_flag = -1 AND od.wh_code <> '9903')`,
  ];
  const args: unknown[] = [];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`h.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`h.wh_code = $${args.length}`);
  }
  // ຈື່ຕຳແໜ່ງຂອງ argument ວັນທີ ເພື່ອຖອດມັນອອກໄດ້ຕອນນັບ "ນອກຊ່ວງວັນທີ" ຂ້າງລຸ່ມ
  const dateArgIndexes: { from: number; to: number } = { from: -1, to: -1 };
  if (fromDate) {
    args.push(fromDate);
    dateArgIndexes.from = args.length - 1;
    where.push(`h.doc_date >= $${args.length}`);
  }
  if (toDate) {
    args.push(toDate);
    dateArgIndexes.to = args.length - 1;
    where.push(`h.doc_date <= $${args.length}`);
  }
  if (search) {
    args.push(`%${search}%`);
    const i = args.length;
    where.push(
      `(h.doc_no ILIKE $${i} OR h.doc_ref ILIKE $${i} OR h.user_created ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM public.wms_pick_trip_issue ti
          LEFT JOIN public.odg_tms_car tc ON tc.code = (SELECT car FROM public.wms_pick_trip pt WHERE pt.trip_doc_no = ti.trip_doc_no LIMIT 1)
          WHERE ti.issue_doc = h.doc_no AND (ti.trip_doc_no ILIKE $${i} OR tc.name_1 ILIKE $${i})
        )
        OR EXISTS (
          SELECT 1 FROM public.odg_wms_trans_detail x
          WHERE x.doc_no = h.doc_no AND (x.item_code ILIKE $${i} OR x.item_name ILIKE $${i})
        ))`,
    );
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [countRows, docs] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.odg_wms_trans h ${whereSql}`,
      args,
    ),
    query<DocRow>(
      `SELECT
         h.doc_no,
         to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
         h.doc_time,
         h.doc_ref,
         h.wh_code,
         w.name_1 AS wh_name,
         h.user_created AS creator_code,
         e.fullname_lo AS creator_name,
         COALESCE(agg.line_count, 0) AS line_count,
         COALESCE(agg.out_qty, 0)::text AS out_qty,
         ti.trip_doc_no,
         pt.car AS trip_car,
         tc.name_1 AS trip_car_name
       FROM public.odg_wms_trans h
       LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_code = h.user_created
       LEFT JOIN public.wms_pick_trip_issue ti ON ti.issue_doc = h.doc_no
       LEFT JOIN public.wms_pick_trip pt ON pt.doc_no = ti.pick_doc
       LEFT JOIN public.odg_tms_car tc ON tc.code = pt.car
       LEFT JOIN (
         SELECT doc_no, count(*)::int AS line_count, SUM(qty) AS out_qty
         FROM public.odg_wms_trans_detail
         WHERE calc_flag = -1 AND wh_code <> '9903'
         GROUP BY doc_no
       ) agg ON agg.doc_no = h.doc_no
       ${whereSql}
       ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    ),
  ]);

  const total = countRows[0]?.n ?? 0;

  // ຜົນລັບເປັນສູນ ບອກບໍ່ໄດ້ວ່າ "ບໍ່ມີໃນຊ່ວງວັນທີນີ້" ຫຼື "ບໍ່ມີເລີຍ" — ສອງອັນນີ້
  // ຄົນໃຊ້ຕ້ອງເຮັດຄົນລະຢ່າງ. ຄຳແນະນຳເກົ່າ ("ລອງປ່ຽນຊ່ວງວັນທີ") ຈຶ່ງພາໃຫ້ຄົນ
  // ໄລ່ກົດຫາຢູ່ບໍ່ຮູ້ຈົບ ທັງທີ່ສາງຂອງລາວຍັງບໍ່ເຄີຍຈ່າຍຜ່ານ WMS ເລີຍ.
  // ນັບຊ້ຳເທື່ອໜຶ່ງ ໂດຍຖອດສະເພາະຕົວກອງວັນທີອອກ ແລ້ວບອກຄວາມແຕກຕ່າງໃຫ້ຮູ້.
  let outsideRange = 0;
  if (total === 0 && (fromDate || toDate)) {
    const dropped = new Set(
      [dateArgIndexes.from, dateArgIndexes.to].filter((i) => i >= 0),
    );
    // ແຜນທີ່ $ເກົ່າ → $ໃໝ່. ຕ້ອງເປັນແຜນທີ່ ບໍ່ແມ່ນການນັບຕໍ່ໄປເລື້ອຍໆ ເພາະເງື່ອນໄຂ
    // ຄົ້ນຫາອ້າງ argument ອັນດຽວກັນຫຼາຍເທື່ອ ($3 ຊ້ຳ 4 ບ່ອນ) — ຖ້ານັບຕໍ່ໄປ
    // ຈະກາຍເປັນ $3 $4 $5 $6 ແລ້ວ query ຈະຂາດ argument.
    const remap = new Map<number, number>();
    let next = 0;
    for (let i = 0; i < args.length; i++) {
      if (dropped.has(i)) continue;
      next += 1;
      remap.set(i + 1, next);
    }
    const rebuilt = where
      .filter((c) => !c.includes("h.doc_date >=") && !c.includes("h.doc_date <="))
      .map((c) => c.replace(/\$(\d+)/g, (_m, d: string) => `$${remap.get(Number(d))}`));
    const noDateArgs = args.filter((_, i) => !dropped.has(i));
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.odg_wms_trans h WHERE ${rebuilt.join(" AND ")}`,
      noDateArgs,
    );
    outsideRange = rows[0]?.n ?? 0;
  }

  const hasNext = docs.length > PAGE_SIZE;
  const pageDocs = hasNext ? docs.slice(0, PAGE_SIZE) : docs;

  const docNos = pageDocs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT doc_no, item_code, item_name, unit_code, shelf_code, shelf_code1, pallet,
                qty::text AS qty
         FROM public.odg_wms_trans_detail
         WHERE doc_no = ANY($1) AND calc_flag = -1 AND wh_code <> '9903'
         ORDER BY doc_no, roworder`,
        [docNos],
      )
    : [];

  const linesByDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.doc_no);
    if (arr) arr.push(l);
    else linesByDoc.set(l.doc_no, [l]);
  }

  // Which of these DP docs are transfer-OUTs — they parked goods in the in-transit
  // warehouse, so voiding one needs the `delete_transfer_out` grant. A plain
  // consumption issue keeps its old role+warehouse rule.
  const transferOutDocs = docNos.length
    ? new Set(
        (await query<{ doc_no: string }>(
          `SELECT DISTINCT doc_no FROM public.odg_wms_trans_detail
           WHERE doc_no = ANY($1) AND calc_flag = 1 AND wh_code = '9903'`,
          [docNos],
        )).map((r) => r.doc_no),
      )
    : new Set<string>();
  const canDeleteTransferOut = await hasPerm(session, "delete_transfer_out");

  // Related ERP documents this issue posted, plus the FULL document chain of a
  // transfer request: the request (124) is fulfilled from the SOURCE at issue-
  // confirm time (this DP → an outbound ໃບໂອນ, source→9903) and later RECEIVED
  // at the DESTINATION (a completely different DP, from the receive screen —
  // 9903→dest). Both legs share `ic_trans.doc_ref` = the 124's doc_no, so we can
  // trace the whole chain even though the receive-side doc wasn't created here.
  //  · ownRows   — linked via doc_ref_trans = THIS page's own DP doc.
  //  · chainRows — linked via doc_ref = the request doc_no this DP fulfilled
  //                (catches the destination's transfer-in, posted by a DP we
  //                never see on this screen).
  const ownDocRefs = Array.from(new Set(pageDocs.map((d) => d.doc_ref).filter((v): v is string => !!v)));
  type ErpRow = { key: string; doc_no: string; trans_flag: number; wh_from: string | null; wh_to: string | null };
  const [ownRows, chainRows] = await Promise.all([
    docNos.length
      ? query<ErpRow>(
          `SELECT DISTINCT doc_ref_trans AS key, doc_no, trans_flag, wh_from, wh_to
           FROM public.ic_trans WHERE doc_ref_trans = ANY($1)`,
          [docNos],
        )
      : [],
    ownDocRefs.length
      ? query<ErpRow>(
          `SELECT DISTINCT doc_ref AS key, doc_no, trans_flag, wh_from, wh_to
           FROM public.ic_trans WHERE doc_ref = ANY($1) AND trans_flag IN (56, 70, 72)`,
          [ownDocRefs],
        )
      : [],
  ]);

  // ໃບໂອນອອກ = posted INTO the in-transit wh (9903); ໃບໂອນເຂົ້າ = posted OUT of it.
  function erpLabel(trans_flag: number, wh_from: string | null, wh_to: string | null): string {
    if (trans_flag === 56) return "ໃບເບີກ";
    if (wh_from === "9903") return "ໃບໂອນເຂົ້າ";
    if (wh_to === "9903") return "ໃບໂອນອອກ";
    return "ໃບໂອນ";
  }
  const erpByDoc = new Map<string, { doc_no: string; label: string }[]>();
  const addedFor = new Set<string>(); // `${pageDocNo}|${erpDocNo}` — de-dupe own vs chain
  function addErp(pageDocNo: string, row: ErpRow) {
    const dedupeKey = `${pageDocNo}|${row.doc_no}`;
    if (addedFor.has(dedupeKey)) return;
    addedFor.add(dedupeKey);
    const arr = erpByDoc.get(pageDocNo) ?? [];
    arr.push({ doc_no: row.doc_no, label: erpLabel(row.trans_flag, row.wh_from, row.wh_to) });
    erpByDoc.set(pageDocNo, arr);
  }
  for (const r of ownRows) addErp(r.key, r);
  for (const r of chainRows) for (const d of pageDocs) if (d.doc_ref === r.key) addErp(d.doc_no, r);

  const todayCount = pageDocs.filter((d) => d.doc_date === today).length;

  // ຂໍ້ຄວາມບ່ອນວ່າງເປົ່າຄວນລະບຸໃຫ້ຊັດວ່າ "ສາງໃດ" ບໍ່ມີ — ຄົນສ່ວນຫຼາຍເຫັນສິດແຕ່
  // ສາງດຽວ ຈຶ່ງເຂົ້າໃຈຜິດວ່າທັງລະບົບບໍ່ມີຂໍ້ມູນ.
  const scopeNames = whOptions
    .filter((w) => (wh ? w.code === wh : true))
    .map((w) => `${w.code}${w.name ? ` ${w.name}` : ""}`);
  const whLabel =
    scopeNames.length === 0
      ? "ສາງຂອງທ່ານ"
      : scopeNames.length <= 2
        ? `ສາງ ${scopeNames.join(" ແລະ ")}`
        : `ທັງ ${scopeNames.length} ສາງທີ່ທ່ານມີສິດ`;


  const dateLabel = allTime
    ? "ທຸກວັນ"
    : fromDate && toDate && fromDate === toDate
      ? fromDate === today
        ? "ມື້ນີ້"
        : fmtDate(fromDate)
      : fromDate && toDate
        ? `${fmtDate(fromDate)} → ${fmtDate(toDate)}`
        : fromDate
          ? fmtDate(fromDate)
          : toDate
            ? fmtDate(toDate)
            : "—";

  function buildHref(
    overrides: Partial<{ q: string; wh: string; from: string; to: string; page: string; all: string }>,
  ) {
    const sp = new URLSearchParams();
    sp.set("tab", "history");
    const next = {
      q: overrides.q ?? search,
      wh: overrides.wh ?? wh,
      from: overrides.from ?? (allTime ? "" : explicitFrom),
      to: overrides.to ?? (allTime ? "" : explicitTo),
      page: overrides.page ?? String(page),
      all: overrides.all ?? (allTime ? "1" : ""),
    };
    if (next.q) sp.set("q", next.q);
    if (next.wh) sp.set("wh", next.wh);
    if (next.from) sp.set("from", next.from);
    if (next.to) sp.set("to", next.to);
    if (next.all) sp.set("all", next.all);
    if (next.page && next.page !== "1") sp.set("page", next.page);
    return `?${sp.toString()}`;
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<ListIcon className="h-4 w-4" />} label="ເອກະສານທັງໝົດ" value={total} sub={dateLabel} />
        <KpiCard icon={<CalendarIcon className="h-4 w-4" />} label="ໃນໜ້ານີ້ (ມື້ນີ້)" value={todayCount} />
        <KpiCard icon={<BuildingIcon className="h-4 w-4" />} label="ສາງໃນສິດ" value={accessible === null ? "ທຸກສາງ" : `${whOptions.length}`} />
      </section>

      {/* Filter */}
      <form method="get" className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <input type="hidden" name="tab" value="history" />
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_170px_170px]">
          <div>
            <label className={labelCls}>ຄົ້ນຫາ (doc_no / ອ້າງອີງ / ສິນຄ້າ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" name="q" defaultValue={search} placeholder="ເຊັ່ນ DP260626 ຫຼື ຊື່ສິນຄ້າ" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>ສາງ</label>
            <select name="wh" defaultValue={wh} className={inputCls}>
              <option value="">{accessible === null ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${whOptions.length})`}</option>
              {whOptions.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} {w.name ? `· ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>ຈາກວັນທີ</label>
            <input type="date" name="from" defaultValue={fromDate} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ຫາວັນທີ</label>
            <input type="date" name="to" defaultValue={toDate} className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${BASE_PATH}?tab=history`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
              ມື້ນີ້
            </Link>
            <Link href={`${BASE_PATH}?tab=history&all=1`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
              ທຸກວັນ
            </Link>
          </div>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition hover:shadow-lg">
            ກອງ
          </button>
        </div>
      </form>

      {pageDocs.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-7 w-7" />}
          title={
            outsideRange > 0
              ? "ບໍ່ມີປະຫວັດການຈ່າຍໃນຊ່ວງວັນທີນີ້"
              : "ຍັງບໍ່ມີການຈ່າຍທີ່ເຮັດຜ່ານ WMS"
          }
          description={
            outsideRange > 0
              ? `ມີ ${outsideRange} ໃບຢູ່ນອກຊ່ວງທີ່ເລືອກ — ກົດ "ທຸກວັນ" ເພື່ອເບິ່ງທັງໝົດ`
              : `${whLabel} ຍັງບໍ່ເຄີຍມີໃບຈ່າຍທີ່ສ້າງຜ່ານລະບົບນີ້. ໃບຈ່າຍທີ່ອອກຈາກ ERP ໂດຍກົງບໍ່ຂຶ້ນຢູ່ນີ້ — ເບິ່ງລາຍການທີ່ຍັງຄ້າງຈ່າຍໄດ້ທີ່ຂັ້ນຕອນ ① ສ້າງໃບ pick`
          }
        />
      ) : (
        <div className="space-y-3">
          {pageDocs.map((d) => {
            const docLines = linesByDoc.get(d.doc_no) ?? [];
            return (
              <details key={d.doc_no} open={pageDocs.length <= 5} className="group shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 font-mono text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {(d.wh_code ?? "?").slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                      {d.doc_ref && <Chip tone="red">ref: {d.doc_ref}</Chip>}
                      {d.trip_doc_no && (
                        <Chip tone="brand">🚚 ຖ້ຽວ {d.trip_doc_no}{d.trip_car_name || d.trip_car ? ` · ${d.trip_car_name ?? d.trip_car}` : ""}</Chip>
                      )}
                      {d.wh_code && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <BuildingIcon className="h-3 w-3" />
                          {d.wh_code}
                          {d.wh_name ? ` · ${d.wh_name}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {fmtDate(d.doc_date)}
                        {d.doc_time ? ` ${d.doc_time}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {d.creator_name ?? d.creator_code ?? "—"}
                        {d.creator_name && d.creator_code ? ` (${d.creator_code})` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-base font-bold tabular-nums text-red-600 dark:text-red-400">−{formatQty(d.out_qty)}</div>
                    <div className="text-[10px] text-zinc-400">{d.line_count} ລາຍການ</div>
                  </div>
                  <a href={`/print/wms/${encodeURIComponent(d.doc_no)}`} target="_blank" rel="noopener"
                    title="ເບິ່ງລາຍລະອຽດ SN / ISN + ບ່ອນຈ່າຍອອກ" className="shrink-0 rounded-lg p-2 text-zinc-400 ring-1 ring-zinc-200 transition hover:bg-brand-50 hover:text-brand-600 dark:ring-zinc-800">👁</a>
                  <a href={`/print/wms/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener"
                    title="ພິມໃບຈ່າຍ / ໃບໂອນ (ມີ SN + ບ່ອນເກັບ)" className="shrink-0 rounded-lg p-2 text-zinc-400 ring-1 ring-zinc-200 transition hover:bg-slate-50 hover:text-slate-700 dark:ring-zinc-800">🖨</a>
                  <a href={`/print/wms/${encodeURIComponent(d.doc_no)}/bill?auto=1`} target="_blank" rel="noopener"
                    title="ພິມໃບບິນໂອນ (ສະເພາະສິນຄ້າ + ຈຳນວນ · ບໍ່ມີບ່ອນເກັບ)" className="shrink-0 rounded-lg px-2 py-2 text-[10px] font-bold text-zinc-400 ring-1 ring-zinc-200 transition hover:bg-emerald-50 hover:text-emerald-700 dark:ring-zinc-800">🧾 ບິນ</a>
                  {transferOutDocs.has(d.doc_no) && !canDeleteTransferOut ? (
                    <span
                      title="ບໍ່ມີສິດລົບໃບໂອນອອກ — ໃຫ້ຜູ້ຈັດການເປີດສິດໃນ ຕັ້ງຄ່າ › ຈັດການສິດເຂົ້າເຖິງ"
                      className="shrink-0 cursor-not-allowed rounded-lg bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-600 dark:ring-zinc-800"
                    >
                      🔒 ລົບ
                    </span>
                  ) : (
                    <DeleteIssueButton docNo={d.doc_no} />
                  )}
                </summary>

                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                        <th className="px-4 py-2">ສິນຄ້າ</th>
                        <th className="px-4 py-2">ພື້ນທີ່</th>
                        <th className="px-4 py-2 text-right">ຈ່າຍອອກ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {docLines.map((l, idx) => {
                        const loc = [l.shelf_code, l.shelf_code1, l.pallet].filter(Boolean).join(" / ");
                        return (
                          <tr key={`${l.doc_no}-${l.item_code}-${idx}`}>
                            <td className="px-4 py-2">
                              <div className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400">{l.item_code}</div>
                              <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{loc || "—"}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs font-bold tabular-nums text-red-600 dark:text-red-400">
                              −{formatQty(l.qty)}
                              <span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* ເອກະສານທີ່ກ່ຽວຂ້ອງ */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/40 px-4 py-2.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/20">
                    <span className="font-bold text-zinc-500 dark:text-zinc-400">ເອກະສານກ່ຽວຂ້ອງ:</span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold text-red-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-red-400 dark:ring-zinc-800" title="WMS ໃບຈ່າຍ">DP · {d.doc_no}</span>
                    {d.doc_ref && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold text-brand-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-brand-400 dark:ring-zinc-800" title="ໃບຂໍ (ຕົ້ນທາງ)">ໃບຂໍ · {d.doc_ref}</span>
                    )}
                    {(erpByDoc.get(d.doc_no) ?? []).map((e) => (
                      <span key={e.doc_no + e.label}
                        className={`inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 ${e.label === "ໃບໂອນເຂົ້າ" ? "text-aqua-700 dark:text-aqua-400" : "text-emerald-700 dark:text-emerald-400"}`}
                        title={e.label === "ໃບໂອນເຂົ້າ" ? "ຮັບໂອນເຂົ້າສາງປາຍທາງ (ERP)" : "ERP"}>
                        {e.label} · {e.doc_no}
                      </span>
                    ))}
                    {(erpByDoc.get(d.doc_no) ?? []).length === 0 && (
                      <span className="text-[10px] text-zinc-400">(ບໍ່ມີ ERP doc ຫຼື ຍັງບໍ່ post)</span>
                    )}
                  </div>

                  {/* ປະຫວັດການຍິງ SN ຕອນຢືນຢັນ — ໄວ້ກວດຄືນເມື່ອຈ່າຍຜິດບ່ອນ / ຜິດໜ່ວຍ */}
                  <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
                    <ScanLogPanel issue={d.doc_no} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {pageDocs.length > 0 && (
        <nav className="shadow-card flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            ໜ້າ <span className="font-semibold text-zinc-700 dark:text-zinc-200">{page}</span> · ສະແດງ{" "}
            {pageDocs.length.toLocaleString("en-US")} ຈາກ {total.toLocaleString("en-US")}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={`${BASE_PATH}${buildHref({ page: String(page - 1) })}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                ← ກ່ອນໜ້າ
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">← ກ່ອນໜ້າ</span>
            )}
            {hasNext ? (
              <Link href={`${BASE_PATH}${buildHref({ page: String(page + 1) })}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                ໜ້າຕໍ່ →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">ໜ້າຕໍ່ →</span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
