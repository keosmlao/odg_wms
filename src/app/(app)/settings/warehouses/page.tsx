import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { Warehouse } from "@/app/api/admin/warehouses/route";
import WarehousesClient from "./WarehousesClient";
import { Hero, Chip, KpiCard } from "@/components/ui/Card";
import {
  BuildingIcon,
  LayersIcon,
  MapPinIcon,
  CheckIcon,
} from "@/components/ui/Icons";

type RackRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  wh_code: string | null;
  is_active: number | null;
};

type LocationRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  wh_code: string | null;
  location_id: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  floor: number | null;
  is_active: number | null;
};

type RackNode = RackRow & {
  locations: LocationRow[];
};

type WarehouseNode = Warehouse & {
  racks: RackNode[];
};

type TableExistsRow = {
  exists: boolean;
};

export default async function WarehousesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const locationTable = await resolveLocationTable();

  const [warehouses, racks, locations] = await Promise.all([
    query<Warehouse>(
      `SELECT
         code, name_1, name_2, address, telephone, fax,
         branch_code, wh_manager, status, latitude, longitude
       FROM public.ic_warehouse
       ORDER BY code`,
    ),
    query<RackRow>(
      `SELECT roworder, code, name_1, wh_code, is_active
       FROM public.odg_wms_location
       ORDER BY wh_code, code, roworder`,
    ),
    query<LocationRow>(
      `SELECT
         roworder,
         code,
         name_1,
         wh_code,
         location_id,
         width::text,
         length::text,
         height::text,
         floor,
         is_active
       FROM public.${locationTable}
       ORDER BY wh_code, location_id, code, roworder`,
    ),
  ]);

  const tree = buildWarehouseTree(warehouses, racks, locations);
  const rackCount = racks.length;
  const locationCount = locations.length;
  const activeWarehouseCount = warehouses.filter((w) => w.status === 1).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <Hero
        title="ຈັດການສາງ / Rack / Location"
        description="ລວມໂຄງສ້າງຄັງສິນຄ້າເປັນ tree (ic_warehouse → odg_wms_location → location1)"
        icon={<LayersIcon className="h-6 w-6" />}
        tone="amber"
        chips={
          <>
            <Chip tone="primary">ຜູ້ຈັດການ</Chip>
            <Chip>
              <BuildingIcon className="h-3.5 w-3.5" />
              {warehouses.length} ສາງ ({activeWarehouseCount} ເປີດ)
            </Chip>
            <Chip>
              <LayersIcon className="h-3.5 w-3.5" />
              {rackCount} rack
            </Chip>
            <Chip>
              <MapPinIcon className="h-3.5 w-3.5" />
              {locationCount} location
            </Chip>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<BuildingIcon className="h-4 w-4" />}
          label="ສາງທັງໝົດ"
          value={warehouses.length}
          tone="amber"
          highlight
        />
        <KpiCard
          icon={<CheckIcon className="h-4 w-4" />}
          label="ສາງເປີດ"
          value={activeWarehouseCount}
          sub={`${warehouses.length - activeWarehouseCount} ປິດ`}
          tone="emerald"
          highlight
        />
        <KpiCard
          icon={<LayersIcon className="h-4 w-4" />}
          label="Rack"
          value={rackCount}
        />
        <KpiCard
          icon={<MapPinIcon className="h-4 w-4" />}
          label="Location"
          value={locationCount}
        />
      </section>

      <WarehouseTree warehouses={tree} />

      <section className="mt-8">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            ຂໍ້ມູນສາງ
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            ສ້າງ, ແກ້ໄຂ ແລະ ລຶບສາງສິນຄ້າ
          </p>
        </div>
        <WarehousesClient initialWarehouses={warehouses} />
      </section>
    </div>
  );
}

async function resolveLocationTable() {
  const rows = await query<TableExistsRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'odg_location1'
     ) AS exists`,
  );

  return rows[0]?.exists ? "odg_location1" : "odg_wms_location1";
}

function buildWarehouseTree(
  warehouses: Warehouse[],
  racks: RackRow[],
  locations: LocationRow[],
): WarehouseNode[] {
  const locationsByRack = new Map<string, LocationRow[]>();
  for (const location of locations) {
    const key = rackKey(location.wh_code, location.location_id);
    const list = locationsByRack.get(key) ?? [];
    list.push(location);
    locationsByRack.set(key, list);
  }

  const racksByWarehouse = new Map<string, RackNode[]>();
  for (const rack of racks) {
    const warehouseCode = rack.wh_code || "NO-WH";
    const list = racksByWarehouse.get(warehouseCode) ?? [];
    list.push({
      ...rack,
      locations: locationsByRack.get(rackKey(rack.wh_code, rack.code)) ?? [],
    });
    racksByWarehouse.set(warehouseCode, list);
  }

  return warehouses.map((warehouse) => ({
    ...warehouse,
    racks: racksByWarehouse.get(warehouse.code) ?? [],
  }));
}

function rackKey(warehouseCode: string | null, rackCode: string | null) {
  return `${warehouseCode || ""}::${rackCode || ""}`;
}

function WarehouseTree({ warehouses }: { warehouses: WarehouseNode[] }) {
  if (warehouses.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        ບໍ່ພົບຂໍ້ມູນສາງ
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {warehouses.map((warehouse, index) => {
          const locationCount = warehouse.racks.reduce(
            (sum, rack) => sum + rack.locations.length,
            0,
          );

          return (
            <details key={warehouse.code} open={index < 3}>
              <summary className="flex cursor-pointer list-none items-center gap-3 bg-zinc-50 px-4 py-3 transition hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/70">
                <TreeArrow />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {warehouse.code}
                    </span>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {warehouse.name_1 || warehouse.name_2 || "ບໍ່ມີຊື່ສາງ"}
                    </span>
                    <StatusBadge active={warehouse.status === 1} />
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {warehouse.racks.length.toLocaleString("en-US")} rack ·{" "}
                    {locationCount.toLocaleString("en-US")} location
                  </div>
                </div>
              </summary>

              <div className="px-4 py-3">
                {warehouse.racks.length === 0 ? (
                  <EmptyBranch text="ສາງນີ້ຍັງບໍ່ມີ Rack" />
                ) : (
                  <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                    <div className="space-y-2">
                      {warehouse.racks.map((rack) => (
                        <RackBranch key={rack.roworder} rack={rack} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function RackBranch({ rack }: { rack: RackNode }) {
  return (
    <details className="relative rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-200 dark:bg-zinc-800" />
        <TreeArrow small />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
              {rack.code || "-"}
            </span>
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {rack.name_1 || "-"}
            </span>
            <StatusBadge active={rack.is_active === 1} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {rack.locations.length.toLocaleString("en-US")} location
          </div>
        </div>
      </summary>

      <div className="px-3 pb-3">
        {rack.locations.length === 0 ? (
          <EmptyBranch text="Rack ນີ້ຍັງບໍ່ມີ Location" />
        ) : (
          <div className="ml-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rack.locations.map((location) => (
                <div
                  key={location.roworder}
                  className="relative rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-200 dark:bg-zinc-800" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                        {location.code || "-"}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300">
                        {location.name_1 || "-"}
                      </div>
                      <LocationMeta location={location} />
                    </div>
                    <StatusBadge active={location.is_active === 1} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function LocationMeta({ location }: { location: LocationRow }) {
  const size = [location.width, location.length, location.height]
    .filter(Boolean)
    .join(" x ");

  if (!size && location.floor == null) return null;

  return (
    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {size && <span>{size}</span>}
      {size && location.floor != null && <span> · </span>}
      {location.floor != null && <span>floor {location.floor}</span>}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }
    >
      {active ? "ເປີດ" : "ປິດ"}
    </span>
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

function EmptyBranch({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {text}
    </div>
  );
}
