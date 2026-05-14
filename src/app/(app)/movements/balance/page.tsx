import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import BalanceLocationItems from "./BalanceLocationItems";
import { Hero, Chip, KpiCard, Notice as UiNotice } from "@/components/ui/Card";
import {
  AlertIcon,
  BuildingIcon,
  LayersIcon,
  ListIcon,
  MapPinIcon,
  PackageIcon,
  TrendIcon,
} from "@/components/ui/Icons";

type AggRow = {
  wh_code: string;
  rack_code: string;
  location_code: string;
  pallet_code: string;
  item_count: number;
  qty: string;
};

type RackMasterRow = {
  code: string | null;
  name: string | null;
  wh_code: string | null;
};

type LocationMasterRow = {
  code: string | null;
  name: string | null;
  wh_code: string | null;
  rack_code: string | null;
};

type WarehouseInfo = { code: string; name: string | null };

type DirectStock = { qty: number; itemCount: number };

type PalletNode = {
  code: string;
  qty: number;
  itemCount: number;
};

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

function formatQty(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function nodeKey(...parts: string[]) {
  return parts.join("");
}

export default async function BalancePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <UiNotice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <UiNotice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
      />
    );
  }

  const whInfoArgs: unknown[] = [];
  let whInfoSql = `SELECT code, name_1 AS name FROM public.ic_warehouse`;
  if (Array.isArray(accessible)) {
    whInfoArgs.push(accessible);
    whInfoSql += ` WHERE code = ANY($1)`;
  }
  whInfoSql += ` ORDER BY code`;

  const aggArgs: unknown[] = [];
  let accessibleClause = "";
  if (Array.isArray(accessible)) {
    aggArgs.push(accessible);
    accessibleClause = `AND t.wh_code = ANY($${aggArgs.length})`;
  }

  const masterArgs: unknown[] = [];
  let masterClause = "";
  if (Array.isArray(accessible)) {
    masterArgs.push(accessible);
    masterClause = `WHERE l.wh_code = ANY($${masterArgs.length})`;
  }

  const [whInfo, aggRows, rackMaster, locationMaster] = await Promise.all([
    query<WarehouseInfo>(whInfoSql, whInfoArgs),
    query<AggRow>(
      `SELECT
         t.wh_code,
         COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack_code,
         COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
         COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet_code,
         count(DISTINCT t.item_code)::int              AS item_count,
         SUM(t.qty * t.calc_flag)::text                AS qty
       FROM public.odg_wms_trans_detail t
       WHERE (t.status = 0 OR t.status IS NULL)
         AND t.wh_code IS NOT NULL
         AND t.wh_code <> ''
         ${accessibleClause}
       GROUP BY t.wh_code, rack_code, location_code, pallet_code
       HAVING SUM(t.qty * t.calc_flag) <> 0
       ORDER BY t.wh_code, rack_code, location_code, pallet_code`,
      aggArgs,
    ),
    query<RackMasterRow>(
      `SELECT l.code, l.name_1 AS name, l.wh_code
       FROM public.odg_wms_location l
       ${masterClause}`,
      masterArgs,
    ),
    query<LocationMasterRow>(
      `SELECT
         l.code,
         l.name_1            AS name,
         l.wh_code,
         l.location_id       AS rack_code
       FROM public.odg_wms_location1 l
       ${masterClause}`,
      masterArgs,
    ),
  ]);

  const whNameByCode = new Map(whInfo.map((w) => [w.code, w.name]));
  const rackNameByKey = new Map<string, string>();
  for (const r of rackMaster) {
    if (r.wh_code && r.code && r.name) {
      rackNameByKey.set(nodeKey(r.wh_code, r.code), r.name);
    }
  }
  const locationNameByKey = new Map<string, string>();
  for (const l of locationMaster) {
    if (l.wh_code && l.rack_code && l.code && l.name) {
      locationNameByKey.set(nodeKey(l.wh_code, l.rack_code, l.code), l.name);
    }
  }

  const tree = buildTree(aggRows, whNameByCode, rackNameByKey, locationNameByKey);

  const summary = {
    warehouses: tree.length,
    racks: tree.reduce((s, w) => s + w.racks.length, 0),
    locations: tree.reduce(
      (s, w) => s + w.racks.reduce((s2, r) => s2 + r.locations.length, 0),
      0,
    ),
    pallets: tree.reduce(
      (s, w) =>
        s +
        w.racks.reduce(
          (s2, r) =>
            s2 + r.locations.reduce((s3, l) => s3 + l.pallets.length, 0),
          0,
        ),
      0,
    ),
    items: tree.reduce((s, w) => s + w.itemCount, 0),
    totalQty: tree.reduce((s, w) => s + w.qty, 0),
    negative: tree.filter((w) => w.qty < 0).length,
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <Hero
        title="ຄົງເຫຼືອສິນຄ້າ"
        description="ໂຄງສ້າງ 4 ລະດັບ ຄຳນວນຈາກ odg_wms_trans_detail (qty × calc_flag, status = 0)"
        icon={<PackageIcon className="h-6 w-6" />}
        tone="blue"
        chips={
          <>
            <Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>
            <Chip>
              <BuildingIcon className="h-3.5 w-3.5" />
              {accessible === null
                ? "ທຸກສາງ"
                : `${accessible.length} ສາງ`}
            </Chip>
            <Chip>ສາງ → rack → location → pallet</Chip>
          </>
        }
        right={
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              ຍອດລວມຄົງເຫຼືອ
            </div>
            <div
              className={`mt-1 font-mono text-3xl font-bold tabular-nums ${
                summary.totalQty < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-blue-600 dark:text-blue-400"
              }`}
            >
              {formatQty(summary.totalQty)}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {summary.items.toLocaleString("en-US")} ລາຍການ ·{" "}
              {summary.warehouses} ສາງ
            </div>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<BuildingIcon className="h-4 w-4" />}
          label="ຈຳນວນສາງ"
          value={summary.warehouses}
          tone="blue"
          highlight
        />
        <KpiCard
          icon={<LayersIcon className="h-4 w-4" />}
          label="Rack"
          value={summary.racks}
        />
        <KpiCard
          icon={<MapPinIcon className="h-4 w-4" />}
          label="Location"
          value={summary.locations}
        />
        <KpiCard
          icon={<PackageIcon className="h-4 w-4" />}
          label="Pallet"
          value={summary.pallets}
        />
        <KpiCard
          icon={<ListIcon className="h-4 w-4" />}
          label="ລາຍການສິນຄ້າ"
          value={summary.items}
        />
        <KpiCard
          icon={<TrendIcon className="h-4 w-4" />}
          label="ຍອດລວມ"
          value={formatQty(summary.totalQty)}
          tone="blue"
          highlight
        />
        <KpiCard
          icon={<AlertIcon className="h-4 w-4" />}
          label="ສາງຍອດຕິດລົບ"
          value={summary.negative}
          tone="red"
          highlight={summary.negative > 0}
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              tree ຄົງເຫຼືອ
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              ກົດ ▸ ເພື່ອຂະຫຍາຍ; ກົດປຸ່ມ "ໂຫຼດລາຍການ" ເພື່ອເບິ່ງສິນຄ້າທີ່ມີຄົງເຫຼືອ
            </p>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {summary.warehouses.toLocaleString("en-US")} ສາງ
          </div>
        </div>

        {tree.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            ບໍ່ພົບລາຍການຄົງເຫຼືອ
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tree.map((w, i) => (
              <WarehouseTreeNode key={w.code} warehouse={w} defaultOpen={i === 0} />
            ))}
          </div>
        )}
      </section>
    </div>
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
      w = {
        code,
        label: name ? `${code} · ${name}` : code,
        qty: 0,
        itemCount: 0,
        direct: null,
        racks: [],
      };
      wMap.set(code, w);
    }
    return w;
  }

  function ensureRack(w: WarehouseNode, code: string): RackNode {
    let r = w.racks.find((x) => x.code === code);
    if (!r) {
      const name = rackNameByKey.get(nodeKey(w.code, code));
      r = {
        code,
        label: name ? `${code} · ${name}` : code,
        qty: 0,
        itemCount: 0,
        direct: null,
        locations: [],
      };
      w.racks.push(r);
    }
    return r;
  }

  function ensureLocation(
    w: WarehouseNode,
    r: RackNode,
    code: string,
  ): LocationNode {
    let l = r.locations.find((x) => x.code === code);
    if (!l) {
      const name = locationNameByKey.get(nodeKey(w.code, r.code, code));
      l = {
        code,
        label: name ? `${code} · ${name}` : code,
        qty: 0,
        itemCount: 0,
        direct: null,
        pallets: [],
      };
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
      w.direct = w.direct
        ? { qty: w.direct.qty + qty, itemCount: w.direct.itemCount + itemCount }
        : { qty, itemCount };
      continue;
    }

    const r = ensureRack(w, row.rack_code);
    r.qty += qty;
    r.itemCount += itemCount;

    if (row.location_code === "") {
      r.direct = r.direct
        ? { qty: r.direct.qty + qty, itemCount: r.direct.itemCount + itemCount }
        : { qty, itemCount };
      continue;
    }

    const l = ensureLocation(w, r, row.location_code);
    l.qty += qty;
    l.itemCount += itemCount;

    if (row.pallet_code === "") {
      l.direct = l.direct
        ? { qty: l.direct.qty + qty, itemCount: l.direct.itemCount + itemCount }
        : { qty, itemCount };
      continue;
    }

    l.pallets.push({ code: row.pallet_code, qty, itemCount });
  }

  const list = Array.from(wMap.values()).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  for (const w of list) {
    w.racks.sort((a, b) => a.code.localeCompare(b.code));
    for (const r of w.racks) {
      r.locations.sort((a, b) => a.code.localeCompare(b.code));
      for (const l of r.locations) {
        l.pallets.sort((a, b) => a.code.localeCompare(b.code));
      }
    }
  }
  return list;
}

function WarehouseTreeNode({
  warehouse,
  defaultOpen,
}: {
  warehouse: WarehouseNode;
  defaultOpen: boolean;
}) {
  return (
    <details open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-zinc-50 px-4 py-3 transition hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/70">
        <TreeArrow />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">
              {warehouse.label}
            </span>
            <QtyBadge qty={warehouse.qty} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {warehouse.racks.length.toLocaleString("en-US")} rack ·{" "}
            {warehouse.itemCount.toLocaleString("en-US")} ລາຍການສິນຄ້າ
            {warehouse.direct && (
              <> · ສິນຄ້າຢູ່ສາງໂດຍກົງ {warehouse.direct.itemCount}</>
            )}
          </div>
        </div>
        <TreeQty value={warehouse.qty} />
      </summary>

      <div className="px-4 py-3">
        {warehouse.direct && (
          <div className="mb-3 ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <DirectItems
              level="warehouse"
              warehouse={warehouse.code}
              direct={warehouse.direct}
            />
          </div>
        )}
        {warehouse.racks.length === 0 && !warehouse.direct ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            ສາງນີ້ບໍ່ມີຍອດຄົງເຫຼືອ
          </div>
        ) : (
          <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <div className="space-y-2">
              {warehouse.racks.map((rack) => (
                <RackTreeNode
                  key={rack.code}
                  warehouse={warehouse.code}
                  rack={rack}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function RackTreeNode({
  warehouse,
  rack,
}: {
  warehouse: string;
  rack: RackNode;
}) {
  return (
    <details className="relative rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-200 dark:bg-zinc-800" />
        <TreeArrow small />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
              {rack.label}
            </span>
            <QtyBadge qty={rack.qty} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {rack.locations.length.toLocaleString("en-US")} location ·{" "}
            {rack.itemCount.toLocaleString("en-US")} ລາຍການ
            {rack.direct && <> · ຢູ່ rack ໂດຍກົງ {rack.direct.itemCount}</>}
          </div>
        </div>
        <TreeQty value={rack.qty} />
      </summary>

      <div className="px-3 pb-3">
        {rack.direct && (
          <div className="mb-2 ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <DirectItems
              level="rack"
              warehouse={warehouse}
              rack={rack.code}
              direct={rack.direct}
            />
          </div>
        )}
        {rack.locations.length === 0 && !rack.direct ? (
          <div className="ml-3 border-l border-dashed border-zinc-200 pl-4 dark:border-zinc-800">
            <div className="rounded-lg px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              ບໍ່ມີ location ຍ່ອຍ ແລະ ບໍ່ມີສິນຄ້າຢູ່ rack ນີ້ໂດຍກົງ
            </div>
          </div>
        ) : rack.locations.length > 0 ? (
          <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <div className="space-y-2">
              {rack.locations.map((loc) => (
                <LocationTreeNode
                  key={loc.code}
                  warehouse={warehouse}
                  rack={rack.code}
                  location={loc}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function LocationTreeNode({
  warehouse,
  rack,
  location,
}: {
  warehouse: string;
  rack: string;
  location: LocationNode;
}) {
  return (
    <details className="relative rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-200 dark:bg-zinc-800" />
        <TreeArrow small />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
              {location.label}
            </span>
            <QtyBadge qty={location.qty} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {location.pallets.length.toLocaleString("en-US")} pallet ·{" "}
            {location.itemCount.toLocaleString("en-US")} ລາຍການ
            {location.direct && (
              <> · ຢູ່ location ໂດຍກົງ {location.direct.itemCount}</>
            )}
          </div>
        </div>
        <TreeQty value={location.qty} />
      </summary>

      <div className="px-3 pb-3">
        {location.direct && (
          <div className="mb-2 ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <DirectItems
              level="location"
              warehouse={warehouse}
              rack={rack}
              location={location.code}
              direct={location.direct}
            />
          </div>
        )}
        {location.pallets.length > 0 && (
          <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <div className="space-y-2">
              {location.pallets.map((p) => (
                <PalletTreeNode
                  key={p.code}
                  warehouse={warehouse}
                  rack={rack}
                  location={location.code}
                  pallet={p}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function PalletTreeNode({
  warehouse,
  rack,
  location,
  pallet,
}: {
  warehouse: string;
  rack: string;
  location: string;
  pallet: PalletNode;
}) {
  return (
    <details className="relative rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-200 dark:bg-zinc-800" />
        <TreeArrow small />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              pallet
            </span>
            <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
              {pallet.code}
            </span>
            <QtyBadge qty={pallet.qty} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {pallet.itemCount.toLocaleString("en-US")} ລາຍການ
          </div>
        </div>
        <TreeQty value={pallet.qty} />
      </summary>
      <div className="px-3 pb-3">
        <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <BalanceLocationItems
            warehouse={warehouse}
            rack={rack}
            location={location}
            pallet={pallet.code}
            buttonLabel={`ໂຫຼດສິນຄ້າໃນ pallet (${pallet.itemCount} ລາຍການ)`}
          />
        </div>
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
}) {
  const labelByLevel: Record<typeof props.level, string> = {
    warehouse: "ສິນຄ້າຢູ່ສາງ (ບໍ່ໄດ້ກຳນົດ rack)",
    rack: "ສິນຄ້າຢູ່ rack (ບໍ່ໄດ້ກຳນົດ location)",
    location: "ສິນຄ້າໃນ location ນີ້",
  };
  return (
    <div className="rounded-lg bg-zinc-50/60 px-3 py-2 dark:bg-zinc-800/30">
      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {labelByLevel[props.level]} ({props.direct.itemCount} ລາຍການ · qty{" "}
        {formatQty(props.direct.qty)})
      </div>
      <BalanceLocationItems
        warehouse={props.warehouse}
        rack={props.rack ?? ""}
        location={props.location ?? ""}
        pallet=""
        buttonLabel={`ໂຫຼດ ${props.direct.itemCount} ລາຍການ`}
      />
    </div>
  );
}

function TreeArrow({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md border border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 ${
        small ? "h-6 w-6 text-xs" : "h-7 w-7"
      }`}
    >
      ▸
    </span>
  );
}

function TreeQty({ value }: { value: number }) {
  return (
    <span
      className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
        value < 0
          ? "text-red-700 dark:text-red-400"
          : value === 0
            ? "text-zinc-400"
            : "text-zinc-900 dark:text-zinc-50"
      }`}
    >
      {formatQty(value)}
    </span>
  );
}

function QtyBadge({ qty }: { qty: number }) {
  if (qty < 0) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
        ຕິດລົບ
      </span>
    );
  }
  if (qty === 0) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        ຍອດ 0
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      ມີຄົງເຫຼືອ
    </span>
  );
}

