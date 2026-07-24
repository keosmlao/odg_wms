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

async function resolveLocationTable() {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'odg_location1'
     ) AS exists`,
  );
  return rows[0]?.exists ? "odg_location1" : "odg_wms_location1";
}

export default async function WarehousesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const locationTable = await resolveLocationTable();

  // Warehouse list (34 rows) + cheap COUNT totals only — the ~3.5k locations
  // are loaded lazily per warehouse from /api/settings/warehouse-structure.
  const [warehouses, rackCountRow, locationCountRow] = await Promise.all([
    query<Warehouse>(
      `SELECT
         code, name_1, name_2, address, telephone, fax,
         branch_code, wh_manager, status, latitude, longitude
       FROM public.ic_warehouse
       ORDER BY code`,
    ),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM public.odg_wms_location`),
    query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${locationTable}`),
  ]);

  // Per-menu SN flags default true. Guarded so the page still renders before
  // migrations 019/020 create the config table & columns.
  const defaultSn = { receive: true, issue: true, issue_pick: true, transfer: true, pallet: true, adjust: true, return: true };
  for (const w of warehouses) w.sn = { ...defaultSn };
  try {
    const cfg = await query<{
      wh_code: string;
      sn_receive: boolean; sn_issue: boolean; sn_issue_pick: boolean; sn_transfer: boolean;
      sn_pallet: boolean; sn_adjust: boolean; sn_return: boolean;
    }>(
      `SELECT wh_code, sn_receive, sn_issue, sn_issue_pick, sn_transfer, sn_pallet, sn_adjust, sn_return
       FROM public.odg_wms_warehouse_config`,
    );
    const byCode = new Map(cfg.map((c) => [c.wh_code, c]));
    for (const w of warehouses) {
      const c = byCode.get(w.code);
      if (c) w.sn = {
        receive: c.sn_receive, issue: c.sn_issue, issue_pick: c.sn_issue_pick, transfer: c.sn_transfer,
        pallet: c.sn_pallet, adjust: c.sn_adjust, return: c.sn_return,
      };
    }
  } catch {
    // columns not present yet — keep defaults
  }

  const rackCount = Number.parseInt(rackCountRow[0]?.n ?? "0", 10) || 0;
  const locationCount = Number.parseInt(locationCountRow[0]?.n ?? "0", 10) || 0;
  const activeWarehouseCount = warehouses.filter((w) => w.status === 1).length;

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຈັດການສາງ / Rack / Location"
        description="ຈັດການສາງ, ຕັ້ງຄ່າ SN ຕໍ່ສາງ, ຂະຫຍາຍເບິ່ງ rack / location ຕາມຕ້ອງການ"
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
              {rackCount.toLocaleString("en-US")} rack
            </Chip>
            <Chip>
              <MapPinIcon className="h-3.5 w-3.5" />
              {locationCount.toLocaleString("en-US")} location
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

      <WarehousesClient initialWarehouses={warehouses} />
    </div>
  );
}
