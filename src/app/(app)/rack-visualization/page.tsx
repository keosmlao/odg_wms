import { redirect } from "next/navigation";
import { AlertIcon } from "@/components/ui/Icons";
import { Notice } from "@/components/ui/Card";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";
import RackVisualization, {
  type RackMapItem,
  type RackMapStock,
  type RackMapWarehouse,
} from "./RackVisualization";

type WarehouseRow = {
  code: string;
  name: string | null;
};

type RackRow = {
  roworder: number;
  code: string | null;
  name: string | null;
  wh_code: string | null;
  is_active: number | null;
};

type LocationRow = {
  roworder: number;
  code: string | null;
  name: string | null;
  wh_code: string | null;
  rack_code: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  floor: number | null;
  is_active: number | null;
};

type StockRow = {
  wh_code: string;
  rack_code: string;
  location_code: string;
  item_count: number;
  qty: string;
  used_pallets: string;
  matched_qty: string;
  missing_ph_qty: string;
  missing_ph_items: number;
  used_volume_m3: string;
  all_dimensioned: boolean;
};

type ItemRow = {
  wh_code: string;
  rack_code: string;
  location_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  used_pallets: string;
  pallet_qty: string | null;
  stack_qty: string | null;
  width_cm: string | null;
  length_cm: string | null;
  height_cm: string | null;
  used_volume_m3: string | null;
  missing_ph: boolean;
};

export default async function RackVisualizationPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
      />
    );
  }

  const args: unknown[] = [];
  const warehouseWhere = Array.isArray(accessible)
    ? `WHERE code = ANY($${args.push(accessible)})`
    : "";
  const masterWhere = Array.isArray(accessible)
    ? `WHERE wh_code = ANY($1)`
    : "";
  const stockWhere = Array.isArray(accessible)
    ? `AND t.wh_code = ANY($1)`
    : "";
  const scopedArgs = Array.isArray(accessible) ? [accessible] : [];

  const [warehouseRows, rackRows, locationRows, stockRows, itemRows] =
    await Promise.all([
    query<WarehouseRow>(
      `SELECT code, name_1 AS name
       FROM public.ic_warehouse
       ${warehouseWhere}
       ORDER BY code`,
      args,
    ),
    query<RackRow>(
      `SELECT roworder, code, name_1 AS name, wh_code, is_active
       FROM public.odg_wms_location
       ${masterWhere}
       ORDER BY wh_code, code, roworder`,
      scopedArgs,
    ),
    query<LocationRow>(
      `SELECT
         roworder,
         code,
         name_1 AS name,
         wh_code,
         location_id AS rack_code,
         width::text,
         length::text,
         height::text,
         floor,
         is_active
       FROM public.odg_wms_location1
       ${masterWhere}
       ORDER BY wh_code, location_id, floor NULLS LAST, code, roworder`,
      scopedArgs,
    ),
    query<StockRow>(
      `WITH item_balance AS (
         SELECT
           t.wh_code,
           COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') AS rack_code,
           COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
           t.item_code,
           COALESCE(NULLIF(TRIM(t.unit_code), ''), '') AS unit_code,
           SUM(t.qty * t.calc_flag)::numeric AS qty
         FROM public.odg_wms_trans_detail t
         -- Net ALL movements. status = 1 marks confirmed issues (ຈ່າຍອອກແລ້ວ,
         -- always calc_flag = -1); excluding them would count receipts but not
         -- issues and inflate the on-hand balance.
         WHERE t.wh_code IS NOT NULL
           AND t.wh_code <> ''
           ${stockWhere}
         GROUP BY
           t.wh_code,
           rack_code,
           location_code,
           t.item_code,
           COALESCE(NULLIF(TRIM(t.unit_code), ''), '')
         HAVING SUM(t.qty * t.calc_flag) <> 0
       ),
       classified AS (
         SELECT b.*, ph.pallet, ph.stack, pd.w AS pd_w, pd.l AS pd_l, pd.h AS pd_h
         FROM item_balance b
         LEFT JOIN public.ic_inventory i ON i.code = b.item_code
         ${phDimensionLateralJoin("i")}
         LEFT JOIN LATERAL (
           SELECT NULLIF(width::text, '')::numeric AS w,
                  NULLIF(length::text, '')::numeric AS l,
                  NULLIF(height::text, '')::numeric AS h
           FROM public.odg_wms_product_dimension pdx
           WHERE pdx.ic_code = b.item_code
           ORDER BY roworder
           LIMIT 1
         ) pd ON true
       )
       SELECT
         b.wh_code,
         b.rack_code,
         b.location_code,
         count(*)::int AS item_count,
         SUM(b.qty)::text AS qty,
         COALESCE(SUM(
           CASE
             WHEN b.qty > 0 AND b.pallet > 0
             THEN b.qty / b.pallet
             ELSE 0
           END
         ), 0)::text AS used_pallets,
         COALESCE(SUM(
           CASE
             WHEN b.qty > 0 AND b.pallet > 0
             THEN b.qty ELSE 0
           END
         ), 0)::text AS matched_qty,
         COALESCE(SUM(
           CASE
             WHEN b.qty > 0 AND b.pallet IS NULL
             THEN b.qty ELSE 0
           END
         ), 0)::text AS missing_ph_qty,
         count(*) FILTER (
           WHERE b.qty > 0
             AND b.pallet IS NULL
         )::int AS missing_ph_items,
         -- Sum of each item's real volume (W*L*H in cm -> m3) * qty, for items
         -- that have product dimensions.
         COALESCE(SUM(
           CASE
             WHEN b.qty > 0 AND b.pd_w > 0 AND b.pd_l > 0 AND b.pd_h > 0
             THEN (b.pd_w * b.pd_l * b.pd_h) / 1000000.0 * b.qty
             ELSE 0
           END
         ), 0)::text AS used_volume_m3,
         -- True only when every in-stock item in the location has dimensions, so
         -- a real volume comparison is possible; otherwise fall back to pallets.
         (count(*) FILTER (WHERE b.qty > 0 AND (b.pd_w IS NULL OR b.pd_w <= 0)) = 0
            AND count(*) FILTER (WHERE b.qty > 0 AND b.pd_w > 0) > 0) AS all_dimensioned
       FROM classified b
       GROUP BY b.wh_code, b.rack_code, b.location_code
       ORDER BY b.wh_code, b.rack_code, b.location_code`,
      scopedArgs,
    ),
    query<ItemRow>(
      `WITH item_balance AS (
         SELECT
           t.wh_code,
           COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') AS rack_code,
           COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
           t.item_code,
           MAX(t.item_name) AS item_name,
           COALESCE(NULLIF(TRIM(t.unit_code), ''), '') AS unit_code,
           SUM(t.qty * t.calc_flag)::numeric AS qty
         FROM public.odg_wms_trans_detail t
         -- Net ALL movements. status = 1 marks confirmed issues (ຈ່າຍອອກແລ້ວ,
         -- always calc_flag = -1); excluding them would count receipts but not
         -- issues and inflate the on-hand balance.
         WHERE t.wh_code IS NOT NULL
           AND t.wh_code <> ''
           ${stockWhere}
         GROUP BY
           t.wh_code,
           rack_code,
           location_code,
           t.item_code,
           COALESCE(NULLIF(TRIM(t.unit_code), ''), '')
         HAVING SUM(t.qty * t.calc_flag) <> 0
       ),
       classified AS (
         SELECT b.*, ph.pallet, ph.stack, pd.w AS pd_w, pd.l AS pd_l, pd.h AS pd_h
         FROM item_balance b
         LEFT JOIN public.ic_inventory i ON i.code = b.item_code
         ${phDimensionLateralJoin("i")}
         LEFT JOIN LATERAL (
           SELECT NULLIF(width::text, '')::numeric AS w,
                  NULLIF(length::text, '')::numeric AS l,
                  NULLIF(height::text, '')::numeric AS h
           FROM public.odg_wms_product_dimension pdx
           WHERE pdx.ic_code = b.item_code
           ORDER BY roworder
           LIMIT 1
         ) pd ON true
       )
       SELECT
         b.wh_code,
         b.rack_code,
         b.location_code,
         b.item_code,
         b.item_name,
         b.unit_code,
         b.qty::text AS qty,
         (CASE
            WHEN b.qty > 0 AND b.pallet > 0
            THEN b.qty / b.pallet
            ELSE 0
          END)::text AS used_pallets,
         b.pallet::text AS pallet_qty,
         b.stack::text AS stack_qty,
         b.pd_w::text AS width_cm,
         b.pd_l::text AS length_cm,
         b.pd_h::text AS height_cm,
         CASE
           WHEN b.pd_w > 0 AND b.pd_l > 0 AND b.pd_h > 0 AND b.qty > 0
           THEN ((b.pd_w * b.pd_l * b.pd_h) / 1000000.0 * b.qty)::text
           ELSE NULL
         END AS used_volume_m3,
         (b.pallet IS NULL) AS missing_ph
       FROM classified b
       ORDER BY b.wh_code, b.rack_code, b.location_code, b.qty DESC`,
      scopedArgs,
    ),
  ]);

  const locationsByRack = new Map<string, LocationRow[]>();
  for (const location of locationRows) {
    if (!location.wh_code || !location.rack_code || !location.code) continue;
    const key = `${location.wh_code}::${location.rack_code}`;
    const list = locationsByRack.get(key) ?? [];
    list.push(location);
    locationsByRack.set(key, list);
  }

  const racksByWarehouse = new Map<string, RackMapWarehouse["racks"]>();
  const rackByKey = new Map<string, RackMapWarehouse["racks"][number]>();
  for (const rack of rackRows) {
    if (!rack.wh_code || !rack.code) continue;
    const list = racksByWarehouse.get(rack.wh_code) ?? [];
    const rackNode: RackMapWarehouse["racks"][number] = {
      id: rack.roworder,
      code: rack.code,
      name: rack.name,
      active: rack.is_active === 1,
      locations: (locationsByRack.get(`${rack.wh_code}::${rack.code}`) ?? []).map(
        (location) => ({
          id: location.roworder,
          code: location.code!,
          name: location.name,
          widthCm: Number(location.width) || null,
          lengthCm: Number(location.length) || null,
          heightCm: Number(location.height) || null,
          floor: location.floor,
          active: location.is_active === 1,
        }),
      ),
    };
    list.push(rackNode);
    racksByWarehouse.set(rack.wh_code, list);
    rackByKey.set(`${rack.wh_code}::${rack.code}`, rackNode);
  }

  // Keep live stock visible even when its rack/location was never added to the
  // master tables. These nodes are flagged by their display name so operators
  // can both see the stock and repair the master data.
  let syntheticId = -1;
  for (const balance of stockRows) {
    if (!balance.rack_code) continue;
    const key = `${balance.wh_code}::${balance.rack_code}`;
    let rack = rackByKey.get(key);
    if (!rack) {
      rack = {
        id: syntheticId--,
        code: balance.rack_code,
        name: "ບໍ່ພົບ Rack ໃນ master",
        active: true,
        locations: [],
      };
      const list = racksByWarehouse.get(balance.wh_code) ?? [];
      list.push(rack);
      racksByWarehouse.set(balance.wh_code, list);
      rackByKey.set(key, rack);
    }

    if (
      balance.location_code &&
      !rack.locations.some((location) => location.code === balance.location_code)
    ) {
      rack.locations.push({
        id: syntheticId--,
        code: balance.location_code,
        name: "ບໍ່ພົບ Location ໃນ master",
        widthCm: null,
        lengthCm: null,
        heightCm: null,
        floor: null,
        active: true,
      });
    }
  }

  const warehouses: RackMapWarehouse[] = warehouseRows.map((warehouse) => ({
    code: warehouse.code,
    name: warehouse.name,
    racks: (racksByWarehouse.get(warehouse.code) ?? []).sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
  }));

  const stock: RackMapStock[] = stockRows.map((row) => ({
    warehouseCode: row.wh_code,
    rackCode: row.rack_code,
    locationCode: row.location_code,
    itemCount: row.item_count,
    qty: Number(row.qty),
    usedPallets: Number(row.used_pallets),
    matchedQty: Number(row.matched_qty),
    missingPhQty: Number(row.missing_ph_qty),
    missingPhItems: row.missing_ph_items,
    usedVolumeM3: Number(row.used_volume_m3) || 0,
    allDimensioned: row.all_dimensioned,
  }));

  const items: RackMapItem[] = itemRows.map((row) => ({
    warehouseCode: row.wh_code,
    rackCode: row.rack_code,
    locationCode: row.location_code,
    itemCode: row.item_code,
    itemName: row.item_name,
    unitCode: row.unit_code,
    qty: Number(row.qty),
    usedPallets: Number(row.used_pallets),
    palletQty: Number(row.pallet_qty) || null,
    stackQty: Number(row.stack_qty) || null,
    widthCm: Number(row.width_cm) || null,
    lengthCm: Number(row.length_cm) || null,
    heightCm: Number(row.height_cm) || null,
    usedVolumeM3: row.used_volume_m3 == null ? null : Number(row.used_volume_m3),
    missingPh: row.missing_ph,
  }));

  return (
    <RackVisualization warehouses={warehouses} stock={stock} items={items} />
  );
}
