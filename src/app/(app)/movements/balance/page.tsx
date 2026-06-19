import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import BalanceLocationItems from "./BalanceLocationItems";
import BalanceTableClient, { TableStockRow } from "./BalanceTableClient";
import { Notice as UiNotice } from "@/components/ui/Card";
import {
  AlertIcon,
  BuildingIcon,
  LayersIcon,
  ListIcon,
  MapPinIcon,
  PackageIcon,
  SearchIcon,
} from "@/components/ui/Icons";

type AggRow = {
  wh_code: string;
  rack_code: string;
  location_code: string;
  pallet_code: string;
  item_count: number;
  qty: string;
};

type RackMasterRow = { code: string | null; name: string | null; wh_code: string | null };
type LocationMasterRow = {
  code: string | null;
  name: string | null;
  wh_code: string | null;
  rack_code: string | null;
};
type WarehouseInfo = { code: string; name: string | null };
type DirectStock = { qty: number; itemCount: number };
type PalletNode = { code: string; qty: number; itemCount: number };
type LocationNode = {
  code: string;
  label: string;
  qty: number;
  itemCount: number;
  direct: DirectStock | null;
  pallets: PalletNode[];
};
type RackNode = {
  code: string;
  label: string;
  qty: number;
  itemCount: number;
  direct: DirectStock | null;
  locations: LocationNode[];
};
type WarehouseNode = {
  code: string;
  label: string;
  qty: number;
  itemCount: number;
  direct: DirectStock | null;
  racks: RackNode[];
};

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatQty(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function nodeKey(...parts: string[]) {
  return parts.join("");
}

export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const params = await searchParams;
  const search = pickStr(params.q);
  const requestedWh = pickStr(params.wh);
  const requestedView = pickStr(params.view) || "tree";
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  const whInfoArgs: unknown[] = [];
  let whInfoSql = `SELECT code, name_1 AS name FROM public.ic_warehouse`;
  if (Array.isArray(accessible)) {
    whInfoArgs.push(accessible);
    whInfoSql += ` WHERE code = ANY($1)`;
  }
  whInfoSql += ` ORDER BY code`;

  const masterArgs: unknown[] = [];
  let masterClause = "";
  if (Array.isArray(accessible)) {
    masterArgs.push(accessible);
    masterClause = `WHERE l.wh_code = ANY($${masterArgs.length})`;
  }

  const [whInfo, rackMaster, locationMaster] = await Promise.all([
    query<WarehouseInfo>(whInfoSql, whInfoArgs),
    query<RackMasterRow>(`SELECT l.code, l.name_1 AS name, l.wh_code FROM public.odg_wms_location l ${masterClause}`, masterArgs),
    query<LocationMasterRow>(
      `SELECT l.code, l.name_1 AS name, l.wh_code, l.location_id AS rack_code FROM public.odg_wms_location1 l ${masterClause}`,
      masterArgs,
    ),
  ]);

  const allowed = new Set(whInfo.map((w) => w.code));
  const wh = requestedWh && allowed.has(requestedWh) ? requestedWh : "";

  // Unified SQL filtering for Tree/Table query based on search query `q` and chosen warehouse `wh`
  const baseArgs: unknown[] = [];
  let baseFilters = [
    "(t.status = 0 OR t.status IS NULL)",
    "t.wh_code IS NOT NULL AND t.wh_code <> ''"
  ];
  if (Array.isArray(accessible)) {
    baseArgs.push(accessible);
    baseFilters.push(`t.wh_code = ANY($${baseArgs.length})`);
  }
  if (wh) {
    baseArgs.push(wh);
    baseFilters.push(`t.wh_code = $${baseArgs.length}`);
  }
  if (search) {
    baseArgs.push(`%${search}%`);
    baseFilters.push(`(
      t.item_code ILIKE $${baseArgs.length}
      OR t.item_name ILIKE $${baseArgs.length}
      OR t.shelf_code ILIKE $${baseArgs.length}
      OR t.shelf_code1 ILIKE $${baseArgs.length}
      OR t.pallet ILIKE $${baseArgs.length}
    )`);
  }
  const baseFiltersSql = baseFilters.join(" AND ");

  // Tree query
  const aggRows = await query<AggRow>(
    `SELECT
       t.wh_code,
       COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack_code,
       COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
       COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet_code,
       count(DISTINCT t.item_code)::int              AS item_count,
       SUM(t.qty * t.calc_flag)::text                AS qty
     FROM public.odg_wms_trans_detail t
     WHERE ${baseFiltersSql}
     GROUP BY t.wh_code, rack_code, location_code, pallet_code
     HAVING SUM(t.qty * t.calc_flag) <> 0
     ORDER BY t.wh_code, rack_code, location_code, pallet_code`,
    baseArgs
  );

  const whNameByCode = new Map(whInfo.map((w) => [w.code, w.name]));
  const rackNameByKey = new Map<string, string>();
  for (const r of rackMaster) {
    if (r.wh_code && r.code && r.name) rackNameByKey.set(nodeKey(r.wh_code, r.code), r.name);
  }
  const locationNameByKey = new Map<string, string>();
  for (const l of locationMaster) {
    if (l.wh_code && l.rack_code && l.code && l.name) locationNameByKey.set(nodeKey(l.wh_code, l.rack_code, l.code), l.name);
  }

  const tree = buildTree(aggRows, whNameByCode, rackNameByKey, locationNameByKey);

  // Compute overall summary stats
  const summary = {
    warehouses: tree.length,
    racks: tree.reduce((s, w) => s + w.racks.length, 0),
    locations: tree.reduce((s, w) => s + w.racks.reduce((s2, r) => s2 + r.locations.length, 0), 0),
    items: tree.reduce((s, w) => s + w.itemCount, 0),
    totalQty: tree.reduce((s, w) => s + w.qty, 0),
    negative: tree.reduce(
      (s, w) =>
        s +
        w.racks.reduce((s2, r) => s2 + r.locations.filter((l) => l.qty < 0).length, 0),
      0,
    ),
  };

  const filtered = !!wh || !!search;
  const expandAll = filtered;

  // Table query (Paginated flat list of stock balance by items)
  let tableRows: TableStockRow[] = [];
  let tableTotal = 0;
  const tableLimit = 50;

  if (requestedView === "table") {
    // Count query
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT 1
        FROM public.odg_wms_trans_detail t
        WHERE ${baseFiltersSql}
        GROUP BY t.wh_code, t.shelf_code, t.shelf_code1, t.pallet, t.item_code
        HAVING SUM(t.qty * t.calc_flag) <> 0
      ) AS sub
    `;
    const countRes = await query<{ total: number }>(countQuery, baseArgs);
    tableTotal = countRes[0]?.total ?? 0;

    // Data query
    const tableOffset = (page - 1) * tableLimit;
    const tableArgs = [...baseArgs, tableLimit, tableOffset];
    const limitIdx = tableArgs.length - 1;
    const offsetIdx = tableArgs.length;

    const dataQuery = `
      SELECT
        t.wh_code,
        COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack_code,
        COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
        COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet_code,
        t.item_code,
        MAX(t.item_name) AS item_name,
        MAX(t.unit_code) AS unit_code,
        SUM(t.qty * t.calc_flag)::numeric AS qty
      FROM public.odg_wms_trans_detail t
      WHERE ${baseFiltersSql}
      GROUP BY t.wh_code, rack_code, location_code, pallet_code, t.item_code
      HAVING SUM(t.qty * t.calc_flag) <> 0
      ORDER BY t.wh_code, rack_code, location_code, pallet_code, t.item_code
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    tableRows = await query<TableStockRow>(dataQuery, tableArgs);
  }

  function buildHref(overrides: Record<string, string | number>) {
    const sp = new URLSearchParams();
    const next = {
      q: search,
      wh: requestedWh,
      view: requestedView,
      page: String(page),
      ...overrides,
    };
    if (next.q) sp.set("q", next.q);
    if (next.wh) sp.set("wh", next.wh);
    if (next.view && next.view !== "tree") sp.set("view", next.view);
    if (next.page && next.page !== "1") sp.set("page", next.page);
    const s = sp.toString();
    return s ? `?${s}` : "";
  }

  const hasNextTablePage = tableTotal > page * tableLimit;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* Header + filters */}
      <header className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <PackageIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">ຄົງເຫຼືອສິນຄ້າ</h1>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">ຕິດຕາມຍອດຄົງເຫຼືອຕາມ ສາງ · Rack · Location · Pallet</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {/* View Toggle Switcher */}
            <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800/60 ring-1 ring-zinc-200 dark:ring-zinc-800">
              <Link
                href={buildHref({ view: "tree", page: 1 })}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  requestedView === "tree"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                <LayersIcon className="h-3.5 w-3.5" />
                ແບບໂຄງສ້າງ
              </Link>
              <Link
                href={buildHref({ view: "table", page: 1 })}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  requestedView === "table"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                <ListIcon className="h-3.5 w-3.5" />
                ແບບຕາຕະລາງ
              </Link>
            </div>

            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">ຍອດລວມຄົງເຫຼືອ</div>
              <div className={`font-mono text-3xl font-bold tabular-nums ${summary.totalQty < 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}>
                {formatQty(summary.totalQty)}
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <form method="get" className="mt-4 grid gap-2.5 sm:grid-cols-[220px_1fr_auto]">
          {/* Keep hidden views when submitting form */}
          {requestedView !== "tree" && <input type="hidden" name="view" value={requestedView} />}
          <select
            name="wh"
            defaultValue={wh}
            className="rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
          >
            <option value="">{accessible === null ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${whInfo.length})`}</option>
            {whInfo.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code}{w.name ? ` · ${w.name}` : ""}
              </option>
            ))}
          </select>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="ຄົ້ນຫາ ລະຫັດ/ຊື່ສິນຄ້າ ຫຼື rack / location / pallet..."
              className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:shadow-lg">
              ກອງ
            </button>
            {filtered && (
              <Link href={requestedView === "table" ? "/movements/balance?view=table" : "/movements/balance"} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                ລ້າງ
              </Link>
            )}
          </div>
        </form>

        {/* Compact stat chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatChip icon={<BuildingIcon className="h-3.5 w-3.5" />} label="ສາງ" value={summary.warehouses} />
          <StatChip icon={<LayersIcon className="h-3.5 w-3.5" />} label="Rack" value={summary.racks} />
          <StatChip icon={<MapPinIcon className="h-3.5 w-3.5" />} label="Location" value={summary.locations} />
          <StatChip icon={<ListIcon className="h-3.5 w-3.5" />} label="ລາຍການ" value={summary.items} />
          {summary.negative > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50">
              <AlertIcon className="h-3.5 w-3.5" />
              {summary.negative} location ຍອດຕິດລົບ
            </span>
          )}
          <span className="ml-auto inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {ROLE_LABEL_LO[session.role]}
          </span>
        </div>
      </header>

      {/* Main View Area */}
      {requestedView === "table" ? (
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          {tableRows.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-sm font-medium text-zinc-500">
                {filtered ? "ບໍ່ພົບຜົນຕາມເງື່ອນໄຂ" : "ບໍ່ພົບລາຍການຄົງເຫຼືອ"}
              </p>
              {filtered && (
                <Link href="/movements/balance?view=table" className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                  ລ້າງການກອງ
                </Link>
              )}
            </div>
          ) : (
            <>
              <BalanceTableClient rows={tableRows} />
              
              {/* Pagination bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  ສະແດງ {( (page - 1) * tableLimit + 1 ).toLocaleString("en-US")} - {Math.min(page * tableLimit, tableTotal).toLocaleString("en-US")} ຈາກ {tableTotal.toLocaleString("en-US")} ລາຍການ
                </div>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link href={buildHref({ page: page - 1 })} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">
                      ກ່ອນໜ້າ
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-700 cursor-not-allowed">
                      ກ່ອນໜ້າ
                    </span>
                  )}
                  {hasNextTablePage ? (
                    <Link href={buildHref({ page: page + 1 })} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">
                      ຖັດໄປ
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-700 cursor-not-allowed">
                      ຖັດໄປ
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      ) : (
        /* Tree View */
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          {tree.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-sm font-medium text-zinc-500">
                {filtered ? "ບໍ່ພົບຜົນຕາມເງື່ອນໄຂ" : "ບໍ່ພົບລາຍການຄົງເຫຼືອ"}
              </p>
              {filtered && (
                <Link href="/movements/balance" className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                  ລ້າງການກອງ
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tree.map((w, i) => (
                <WarehouseTreeNode key={w.code} warehouse={w} defaultOpen={expandAll || i === 0} q={search} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      <span className="text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value.toLocaleString("en-US")}</span>
      {label}
    </span>
  );
}

function buildTree(
  rows: AggRow[],
  whNameByCode: Map<string, string | null>,
  rackNameByKey: Map<string, string>,
  locationNameByKey: Map<string, string>,
): WarehouseNode[] {
  const wMap = new Map<string, WarehouseNode>();

  function ensureWarehouse(code: string): WarehouseNode {
    let w = wMap.get(code);
    if (!w) {
      const name = whNameByCode.get(code);
      w = { code, label: name ? `${code} · ${name}` : code, qty: 0, itemCount: 0, direct: null, racks: [] };
      wMap.set(code, w);
    }
    return w;
  }
  function ensureRack(w: WarehouseNode, code: string): RackNode {
    let r = w.racks.find((x) => x.code === code);
    if (!r) {
      const name = rackNameByKey.get(nodeKey(w.code, code));
      r = { code, label: name ? `${code} · ${name}` : code, qty: 0, itemCount: 0, direct: null, locations: [] };
      w.racks.push(r);
    }
    return r;
  }
  function ensureLocation(w: WarehouseNode, r: RackNode, code: string): LocationNode {
    let l = r.locations.find((x) => x.code === code);
    if (!l) {
      const name = locationNameByKey.get(nodeKey(w.code, r.code, code));
      l = { code, label: name ? `${code} · ${name}` : code, qty: 0, itemCount: 0, direct: null, pallets: [] };
      r.locations.push(l);
    }
    return l;
  }

  for (const row of rows) {
    const qty = Number.parseFloat(row.qty) || 0;
    const itemCount = row.item_count;
    const w = ensureWarehouse(row.wh_code);
    w.qty += qty;
    w.itemCount += itemCount;
    if (row.rack_code === "") {
      w.direct = w.direct ? { qty: w.direct.qty + qty, itemCount: w.direct.itemCount + itemCount } : { qty, itemCount };
      continue;
    }
    const r = ensureRack(w, row.rack_code);
    r.qty += qty;
    r.itemCount += itemCount;
    if (row.location_code === "") {
      r.direct = r.direct ? { qty: r.direct.qty + qty, itemCount: r.direct.itemCount + itemCount } : { qty, itemCount };
      continue;
    }
    const l = ensureLocation(w, r, row.location_code);
    l.qty += qty;
    l.itemCount += itemCount;
    if (row.pallet_code === "") {
      l.direct = l.direct ? { qty: l.direct.qty + qty, itemCount: l.direct.itemCount + itemCount } : { qty, itemCount };
      continue;
    }
    l.pallets.push({ code: row.pallet_code, qty, itemCount });
  }

  const list = Array.from(wMap.values()).sort((a, b) => a.code.localeCompare(b.code));
  for (const w of list) {
    w.racks.sort((a, b) => a.code.localeCompare(b.code));
    for (const r of w.racks) {
      r.locations.sort((a, b) => a.code.localeCompare(b.code));
      for (const l of r.locations) l.pallets.sort((a, b) => a.code.localeCompare(b.code));
    }
  }
  return list;
}

function WarehouseTreeNode({ warehouse, defaultOpen, q = "" }: { warehouse: WarehouseNode; defaultOpen: boolean; q?: string }) {
  return (
    <details open={defaultOpen} className="group/wh">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <Chevron />
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 font-mono text-xs font-bold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          {warehouse.code.slice(-2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-zinc-900 dark:text-zinc-50">{warehouse.label}</div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {warehouse.racks.length} rack · {warehouse.itemCount} ລາຍການ
            {warehouse.direct && <> · ຢູ່ສາງໂດຍກົງ {warehouse.direct.itemCount}</>}
          </div>
        </div>
        <QtyTag value={warehouse.qty} big />
      </summary>
      <div className="space-y-1.5 bg-zinc-50/50 px-3 py-2.5 pl-6 dark:bg-zinc-950/30">
        {warehouse.direct && (
          <DirectItems level="warehouse" warehouse={warehouse.code} direct={warehouse.direct} q={q} />
        )}
        {warehouse.racks.map((rack) => (
          <RackTreeNode key={rack.code} warehouse={warehouse.code} rack={rack} q={q} />
        ))}
      </div>
    </details>
  );
}

function RackTreeNode({ warehouse, rack, q = "" }: { warehouse: string; rack: RackNode; q?: string }) {
  return (
    <details className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <Chevron small />
        <LayersIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{rack.label}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {rack.locations.length} location · {rack.itemCount} ລາຍການ
            {rack.direct && <> · ຢູ່ rack ໂດຍກົງ {rack.direct.itemCount}</>}
          </div>
        </div>
        <QtyTag value={rack.qty} />
      </summary>
      <div className="space-y-1.5 border-t border-zinc-100 px-3 py-2.5 pl-7 dark:border-zinc-800">
        {rack.direct && <DirectItems level="rack" warehouse={warehouse} rack={rack.code} direct={rack.direct} q={q} />}
        {rack.locations.map((loc) => (
          <LocationTreeNode key={loc.code} warehouse={warehouse} rack={rack.code} location={loc} q={q} />
        ))}
      </div>
    </details>
  );
}

function LocationTreeNode({ warehouse, rack, location, q = "" }: { warehouse: string; rack: string; location: LocationNode; q?: string }) {
  return (
    <details className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <Chevron small />
        <MapPinIcon className="h-4 w-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{location.label}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {location.pallets.length > 0 && <>{location.pallets.length} pallet · </>}
            {location.itemCount} ລາຍການ
          </div>
        </div>
        <QtyTag value={location.qty} />
      </summary>
      <div className="space-y-1.5 border-t border-zinc-100 px-3 py-2.5 pl-7 dark:border-zinc-800">
        {location.direct && (
          <DirectItems level="location" warehouse={warehouse} rack={rack} location={location.code} direct={location.direct} q={q} />
        )}
        {location.pallets.map((p) => (
          <details key={p.code} className="overflow-hidden rounded-lg bg-zinc-50/70 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-800">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70">
              <Chevron small />
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">pallet</span>
              <span className="flex-1 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">{p.code}</span>
              <span className="text-[11px] text-zinc-500">{p.itemCount} ລາຍການ</span>
              <QtyTag value={p.qty} />
            </summary>
            <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <BalanceLocationItems warehouse={warehouse} rack={rack} location={location.code} pallet={p.code} buttonLabel={`ໂຫຼດສິນຄ້າໃນ pallet (${p.itemCount})`} q={q} />
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function DirectItems(props: {
  level: "warehouse" | "rack" | "location";
  warehouse: string;
  rack?: string;
  location?: string;
  direct: DirectStock;
  q?: string;
}) {
  const labelByLevel: Record<typeof props.level, string> = {
    warehouse: "ສິນຄ້າຢູ່ສາງ (ບໍ່ໄດ້ກຳນົດ rack)",
    rack: "ສິນຄ້າຢູ່ rack (ບໍ່ໄດ້ກຳນົດ location)",
    location: "ສິນຄ້າໃນ location ນີ້",
  };
  return (
    <div className="rounded-lg bg-zinc-50/70 px-3 py-2 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-800">
      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {labelByLevel[props.level]} · {props.direct.itemCount} ລາຍການ · qty {formatQty(props.direct.qty)}
      </div>
      <BalanceLocationItems
        warehouse={props.warehouse}
        rack={props.rack ?? ""}
        location={props.location ?? ""}
        pallet=""
        buttonLabel={`ໂຫຼດ ${props.direct.itemCount} ລາຍການ`}
        q={props.q}
      />
    </div>
  );
}

function Chevron({ small = false }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`wms-chevron shrink-0 text-zinc-400 transition-transform ${small ? "h-4 w-4" : "h-5 w-5"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function QtyTag({ value, big = false }: { value: number; big?: boolean }) {
  const tone =
    value < 0
      ? "text-red-600 dark:text-red-400"
      : value === 0
        ? "text-zinc-400"
        : "text-zinc-900 dark:text-zinc-50";
  return (
    <span className={`shrink-0 font-mono font-bold tabular-nums ${big ? "text-lg" : "text-sm"} ${tone}`}>
      {formatQty(value)}
    </span>
  );
}
