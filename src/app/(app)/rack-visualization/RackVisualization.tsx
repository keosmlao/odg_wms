"use client";

import { Fragment, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  BuildingIcon,
  CheckIcon,
  LayersIcon,
  ListIcon,
  MapPinIcon,
  PackageIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import { Chip, Hero, KpiCard } from "@/components/ui/Card";
import type { Rack3DDatum } from "./Warehouse3D";

// WebGL scene must run client-only (no SSR) — it touches window/canvas at mount.
const Warehouse3D = dynamic(() => import("./Warehouse3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      ກຳລັງໂຫຼດ 3D…
    </div>
  ),
});

export type RackMapLocation = {
  id: number;
  code: string;
  name: string | null;
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
  floor: number | null;
  active: boolean;
};

export type RackMapRack = {
  id: number;
  code: string;
  name: string | null;
  active: boolean;
  locations: RackMapLocation[];
};

export type RackMapWarehouse = {
  code: string;
  name: string | null;
  racks: RackMapRack[];
};

export type RackMapStock = {
  warehouseCode: string;
  rackCode: string;
  locationCode: string;
  itemCount: number;
  qty: number;
  usedPallets: number;
  matchedQty: number;
  missingPhQty: number;
  missingPhItems: number;
  // Summed real volume (m³) of items that have W/L/H; only meaningful when
  // allDimensioned is true.
  usedVolumeM3: number;
  // Every in-stock item in the location has dimensions → volume comparison is
  // valid. Otherwise the location falls back to the pallet-count method.
  allDimensioned: boolean;
};

export type RackMapItem = {
  warehouseCode: string;
  rackCode: string;
  locationCode: string;
  itemCode: string;
  itemName: string | null;
  unitCode: string | null;
  qty: number;
  usedPallets: number;
  palletQty: number | null;
  stackQty: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
  usedVolumeM3: number | null;
  missingPh: boolean;
};

type StatusFilter = "all" | "occupied" | "empty" | "full" | "negative";
type ViewMode = "grid" | "3d" | "map" | "list";

// How a location's fill % is measured: by real item volume vs the location's
// volume, or (when item dimensions are missing) by pallet count vs 2 positions.
type FillMode = "volume" | "pallet";

type LocationView = RackMapLocation & {
  itemCount: number;
  qty: number;
  capacityPallets: number | null;
  usedPallets: number;
  matchedQty: number;
  missingPhQty: number;
  missingPhItems: number;
  utilizationPct: number | null;
  fillMode: FillMode;
  usedVolumeM3: number;
  capacityVolumeM3: number | null;
};

type RackItemView = {
  itemCode: string;
  itemName: string | null;
  unitCode: string | null;
  locationCode: string;
  qty: number;
  usedPallets: number;
  palletQty: number | null;
  stackQty: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
  usedVolumeM3: number | null;
  missingPh: boolean;
};

type RackView = Omit<RackMapRack, "locations"> & {
  locations: LocationView[];
  items: RackItemView[];
  directItemCount: number;
  directQty: number;
  itemCount: number;
  qty: number;
  occupiedLocations: number;
  negativeLocations: number;
  capacityPallets: number;
  usedPallets: number;
  missingPhQty: number;
  missingPhItems: number;
  fullLocations: number;
  hasStock: boolean;
  hasNegative: boolean;
};

function stockKey(warehouseCode: string, rackCode: string, locationCode: string) {
  return `${warehouseCode}::${rackCode}::${locationCode}`;
}

function formatQty(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPallets(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value > 0 && value < 0.1 ? 3 : 1,
    maximumFractionDigits: value < 1 ? 3 : 1,
  });
}

// Physical zone layout per warehouse. The DB has no zone column, so the
// rack→zone grouping for the floor-grid view is defined here (matches the
// printed warehouse map). Warehouses with no entry fall back to a plain matrix.
type ZoneConfig = {
  zoneLabel: string;
  // doors (ປະຕູສາງ) anchored above a rack column
  doors?: { label: string; atRackCode: string }[];
  // a group = a sub-zone; aisleAfter marks a walking gap after a rack
  groups: { label: string; rackCodes: string[]; aisleAfter?: string[] }[];
  side?: { label: string; rackCodes: string[] };
};

const ZONE_LAYOUTS: Record<string, ZoneConfig> = {
  "1201": {
    zoneLabel: "",
    doors: [
      { label: "ປະຕູສາງ", atRackCode: "120104" },
      { label: "ປະຕູສາງ", atRackCode: "120108" },
    ],
    groups: [
      {
        // Z01 = RACK A–G, aisles after C and E
        label: "Z01",
        rackCodes: [
          "120101",
          "120102",
          "120103",
          "120104",
          "120105",
          "120106",
          "120107",
        ],
        aisleAfter: ["120103", "120105"],
      },
      {
        // Z02 = RACK H–K, aisle after I
        label: "Z02",
        rackCodes: ["120108", "120109", "120110", "120111"],
        aisleAfter: ["120109"],
      },
    ],
    side: { label: "Z03", rackCodes: ["120112"] },
  },
};

// Calculate rack heat percentage & state
function rackHeat(rack: RackView) {
  const hasCapacity = rack.capacityPallets > 0;
  const volumePct = hasCapacity
    ? (rack.usedPallets / rack.capacityPallets) * 100
    : null;
  const occupancyPct =
    rack.locations.length > 0
      ? (rack.occupiedLocations / rack.locations.length) * 100
      : rack.hasStock
        ? 100
        : 0;
  const pct = volumePct ?? occupancyPct;
  return {
    negative: rack.hasNegative,
    empty: !rack.hasStock,
    estimated: !hasCapacity && rack.hasStock,
    pct,
  };
}

type HeatStyle = {
  tile: string;
  bar: string;
  glow: string;
  badge: string;
};

function heatStyle(heat: ReturnType<typeof rackHeat>): HeatStyle {
  if (heat.negative) {
    return {
      tile: "bg-red-500/10 text-red-700 ring-red-500/30 hover:bg-red-500/20 dark:bg-red-950/20 dark:text-red-400 dark:ring-red-900/50",
      bar: "bg-red-500 dark:bg-red-400",
      glow: "shadow-[0_0_15px_rgba(239,68,68,0.15)]",
      badge: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
    };
  }
  if (heat.empty) {
    return {
      tile: "bg-zinc-50/50 text-zinc-400 ring-zinc-200/50 hover:bg-zinc-50/80 dark:bg-zinc-900/30 dark:text-zinc-500 dark:ring-zinc-800/50",
      bar: "bg-zinc-200 dark:bg-zinc-800",
      glow: "hover:shadow-md",
      badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
    };
  }
  const p = heat.pct;
  if (p > 100) {
    return {
      tile: "bg-rose-500/15 text-rose-700 ring-rose-500/40 hover:bg-rose-500/25 dark:bg-rose-950/30 dark:text-rose-400 dark:ring-rose-900/70",
      bar: "bg-rose-600 dark:bg-rose-500 animate-pulse",
      glow: "shadow-[0_0_18px_rgba(244,63,94,0.25)]",
      badge: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
    };
  }
  if (p >= 90) {
    return {
      tile: "bg-red-500/10 text-red-700 ring-red-400/30 hover:bg-red-500/15 dark:bg-red-950/20 dark:text-red-300 dark:ring-red-900/50",
      bar: "bg-red-500 dark:bg-red-400",
      glow: "shadow-[0_0_12px_rgba(239,68,68,0.15)]",
      badge: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
    };
  }
  if (p >= 75) {
    return {
      tile: "bg-orange-500/10 text-orange-700 ring-orange-400/30 hover:bg-orange-500/15 dark:bg-orange-950/20 dark:text-orange-300 dark:ring-orange-900/50",
      bar: "bg-orange-500 dark:bg-orange-400",
      glow: "shadow-[0_0_10px_rgba(249,115,22,0.1)]",
      badge: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
    };
  }
  if (p >= 50) {
    return {
      tile: "bg-amber-500/10 text-amber-700 ring-amber-400/30 hover:bg-amber-500/15 dark:bg-amber-950/20 dark:text-amber-300 dark:ring-amber-900/50",
      bar: "bg-amber-500 dark:bg-amber-400",
      glow: "shadow-sm",
      badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    };
  }
  if (p >= 25) {
    return {
      tile: "bg-emerald-500/10 text-emerald-700 ring-emerald-400/30 hover:bg-emerald-500/15 dark:bg-emerald-950/20 dark:text-emerald-300 dark:ring-emerald-900/50",
      bar: "bg-emerald-500 dark:bg-emerald-400",
      glow: "shadow-sm",
      badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    };
  }
  return {
    tile: "bg-teal-500/10 text-teal-700 ring-teal-400/30 hover:bg-teal-500/15 dark:bg-teal-950/20 dark:text-teal-300 dark:ring-teal-900/50",
    bar: "bg-teal-500 dark:bg-teal-400",
    glow: "shadow-none",
    badge: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  };
}

export default function RackVisualization({
  warehouses,
  stock,
  items,
}: {
  warehouses: RackMapWarehouse[];
  stock: RackMapStock[];
  items: RackMapItem[];
}) {
  const firstWarehouseWithRacks =
    warehouses.find((warehouse) => warehouse.racks.length > 0)?.code ??
    warehouses[0]?.code ??
    "";
  const [warehouseCode, setWarehouseCode] = useState(firstWarehouseWithRacks);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // when a single cell (ຫ້ອງ) is clicked in 3D, pre-open it in the elevation
  const [focusLoc, setFocusLoc] = useState<string | null>(null);

  const selectedWarehouse =
    warehouses.find((warehouse) => warehouse.code === warehouseCode) ??
    warehouses[0];

  const stockByLocation = useMemo(() => {
    const map = new Map<string, RackMapStock>();
    for (const row of stock) {
      map.set(stockKey(row.warehouseCode, row.rackCode, row.locationCode), row);
    }
    return map;
  }, [stock]);

  const itemsByRack = useMemo(() => {
    const map = new Map<string, RackItemView[]>();
    for (const row of items) {
      const key = `${row.warehouseCode}::${row.rackCode}`;
      const list = map.get(key) ?? [];
      list.push({
        itemCode: row.itemCode,
        itemName: row.itemName,
        unitCode: row.unitCode,
        locationCode: row.locationCode,
        qty: row.qty,
        usedPallets: row.usedPallets,
        palletQty: row.palletQty,
        stackQty: row.stackQty,
        widthCm: row.widthCm,
        lengthCm: row.lengthCm,
        heightCm: row.heightCm,
        usedVolumeM3: row.usedVolumeM3,
        missingPh: row.missingPh,
      });
      map.set(key, list);
    }
    return map;
  }, [items]);

  const rackViews = useMemo<RackView[]>(() => {
    if (!selectedWarehouse) return [];

    return selectedWarehouse.racks.map((rack) => {
      const locations = rack.locations.map<LocationView>((location) => {
        const balance = stockByLocation.get(
          stockKey(selectedWarehouse.code, rack.code, location.code),
        );
        // Warehouse rule: every storage location holds 2 pallet positions.
        const capacityPallets = 2;
        const usedPallets = balance?.usedPallets ?? 0;

        // Location volume (m³) from its own W×L×H.
        const capacityVolumeM3 =
          location.widthCm && location.lengthCm && location.heightCm
            ? (location.widthCm * location.lengthCm * location.heightCm) / 1_000_000
            : null;
        const usedVolumeM3 = balance?.usedVolumeM3 ?? 0;

        // Prefer the real volume comparison; only when every item in the
        // location has dimensions. Otherwise read the location as pallets.
        const canVolume =
          (balance?.allDimensioned ?? false) &&
          capacityVolumeM3 != null &&
          capacityVolumeM3 > 0;
        const fillMode: FillMode = canVolume ? "volume" : "pallet";

        const utilizationPct = !balance
          ? null
          : canVolume
            ? (usedVolumeM3 / (capacityVolumeM3 as number)) * 100
            : (usedPallets / capacityPallets) * 100;

        return {
          ...location,
          itemCount: balance?.itemCount ?? 0,
          qty: balance?.qty ?? 0,
          capacityPallets,
          usedPallets,
          matchedQty: balance?.matchedQty ?? 0,
          missingPhQty: balance?.missingPhQty ?? 0,
          missingPhItems: balance?.missingPhItems ?? 0,
          utilizationPct,
          fillMode,
          usedVolumeM3,
          capacityVolumeM3,
        };
      });
      const direct = stockByLocation.get(
        stockKey(selectedWarehouse.code, rack.code, ""),
      );
      const directQty = direct?.qty ?? 0;
      const locationQty = locations.reduce((sum, location) => sum + location.qty, 0);
      const occupiedLocations = locations.filter((location) => location.qty !== 0).length;
      const negativeLocations = locations.filter((location) => location.qty < 0).length;
      const capacityPallets = locations.reduce(
        (sum, location) => sum + (location.capacityPallets ?? 0),
        0,
      );
      const usedPallets = locations.reduce(
        (sum, location) => sum + location.usedPallets,
        0,
      );

      return {
        ...rack,
        locations,
        items: itemsByRack.get(`${selectedWarehouse.code}::${rack.code}`) ?? [],
        directItemCount: direct?.itemCount ?? 0,
        directQty,
        itemCount:
          (direct?.itemCount ?? 0) +
          locations.reduce((sum, location) => sum + location.itemCount, 0),
        qty: directQty + locationQty,
        occupiedLocations,
        negativeLocations,
        capacityPallets,
        usedPallets,
        missingPhQty: locations.reduce(
          (sum, location) => sum + location.missingPhQty,
          0,
        ),
        missingPhItems: locations.reduce(
          (sum, location) => sum + location.missingPhItems,
          0,
        ),
        fullLocations: locations.filter(
          (location) =>
            location.utilizationPct != null && location.utilizationPct >= 100,
        ).length,
        hasStock: directQty !== 0 || occupiedLocations > 0,
        hasNegative: directQty < 0 || negativeLocations > 0,
      };
    });
  }, [selectedWarehouse, stockByLocation, itemsByRack]);

  const summary = useMemo(() => {
    const locations = rackViews.reduce((sum, rack) => sum + rack.locations.length, 0);
    const occupiedLocations = rackViews.reduce(
      (sum, rack) => sum + rack.occupiedLocations,
      0,
    );
    const occupiedRacks = rackViews.filter((rack) => rack.hasStock).length;
    const negative = rackViews.reduce(
      (sum, rack) => sum + rack.negativeLocations + (rack.directQty < 0 ? 1 : 0),
      0,
    );
    const capacityPallets = rackViews.reduce((sum, rack) => sum + rack.capacityPallets, 0);
    const usedPallets = rackViews.reduce(
      (sum, rack) => sum + rack.usedPallets,
      0,
    );
    const missingPhQty = rackViews.reduce(
      (sum, rack) => sum + rack.missingPhQty,
      0,
    );
    const missingPhItems = rackViews.reduce(
      (sum, rack) => sum + rack.missingPhItems,
      0,
    );
    return {
      racks: rackViews.length,
      occupiedRacks,
      emptyRacks: rackViews.length - occupiedRacks,
      locations,
      occupiedLocations,
      emptyLocations: locations - occupiedLocations,
      negative,
      occupancy: locations > 0 ? (occupiedLocations / locations) * 100 : 0,
      capacityPallets,
      usedPallets,
      remainingPallets: Math.max(0, capacityPallets - usedPallets),
      palletUtilization: capacityPallets > 0 ? (usedPallets / capacityPallets) * 100 : 0,
      missingPhQty,
      missingPhItems,
      fullLocations: rackViews.reduce((sum, rack) => sum + rack.fullLocations, 0),
    };
  }, [rackViews]);

  const filteredRacks = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return rackViews.filter((rack) => {
      if (status === "occupied" && !rack.hasStock) return false;
      if (status === "empty" && rack.hasStock) return false;
      if (status === "full" && rack.fullLocations === 0) return false;
      if (status === "negative" && !rack.hasNegative) return false;
      if (!q) return true;
      return (
        rack.code.toLocaleLowerCase().includes(q) ||
        (rack.name ?? "").toLocaleLowerCase().includes(q) ||
        rack.locations.some(
          (location) =>
            location.code.toLocaleLowerCase().includes(q) ||
            (location.name ?? "").toLocaleLowerCase().includes(q),
        )
      );
    });
  }, [rackViews, search, status]);

  // Group filtered racks by Aisle code (for visual warehouse layout view)
  const racksByAisle = useMemo(() => {
    const map = new Map<string, RackView[]>();
    for (const rack of filteredRacks) {
      let aisle = "ອື່ນໆ (Other)";
      if (rack.name) {
        // Strip RACK word and get letter (e.g. "RACK AA" -> "AA" -> "A")
        const cleanName = rack.name.replace(/RACK\s+/gi, "").trim();
        if (cleanName.length > 0) {
          const firstChar = cleanName.charAt(0).toUpperCase();
          if (firstChar >= "A" && firstChar <= "Z") {
            aisle = `ແຖວຊັ້ນວາງ Aisle ${firstChar}`;
          }
        }
      } else if (rack.code && rack.code.length >= 6) {
        // Fallback: take section code
        aisle = `ແຖວຊັ້ນວາງ Section ${rack.code.substring(4)}`;
      }
      const list = map.get(aisle) ?? [];
      list.push(rack);
      map.set(aisle, list);
    }
    // Sort aisles alphabetically
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRacks]);

  const selectedRack =
    rackViews.find((rack) => rack.code === selectedCode) ?? null;

  const zone = selectedWarehouse
    ? ZONE_LAYOUTS[selectedWarehouse.code] ?? null
    : null;

  const { cols3D, side3D, zoneLabel3D } = useMemo(() => {
    const mk = (
      rack: RackView,
      groupLabel: string | null,
      isBanner: boolean,
      nameOverride?: string,
    ): Rack3DDatum => {
      const maxFloor = rack.locations.reduce((m, l) => Math.max(m, l.floor ?? 0), 0);
      const floors = Array.from({ length: Math.max(maxFloor, 1) }, (_, i) => {
        const floor = i + 1;
        const locs = rack.locations.filter((l) => (l.floor ?? 0) === floor);
        const cells = locs.map((l) => ({
          code: l.code,
          pct: l.utilizationPct ?? 0,
          empty: l.qty === 0,
          negative: l.qty < 0,
        }));
        return { floor, cells };
      });
      return {
        id: rack.id,
        code: rack.code,
        name: nameOverride ?? rack.name,
        isBanner,
        groupLabel,
        floors,
        qty: rack.qty,
        occupiedLocations: rack.occupiedLocations,
        totalLocations: rack.locations.length,
      };
    };

    if (zone) {
      const byCode = new Map(rackViews.map((r) => [r.code, r]));
      const cols: Rack3DDatum[] = [];
      for (const g of zone.groups)
        for (const code of g.rackCodes) {
          const r = byCode.get(code);
          if (r) {
            const d = mk(r, g.label, false);
            d.aisleAfter = g.aisleAfter?.includes(code) ?? false;
            cols.push(d);
          }
        }
      const sr = zone.side ? byCode.get(zone.side.rackCodes[0]) : undefined;
      return {
        cols3D: cols,
        // Keep the real rack name (e.g. RACK Z); the zone (Z03) rides on
        // groupLabel so it shows as a separate zone tag, not as the rack name.
        side3D: sr ? mk(sr, zone.side?.label ?? null, true) : null,
        zoneLabel3D: zone.zoneLabel,
      };
    }

    const cols: Rack3DDatum[] = [];
    let banner: Rack3DDatum | null = null;
    for (const rack of filteredRacks) {
      if (/\bz$/i.test((rack.name ?? "").trim())) banner = mk(rack, null, true);
      else cols.push(mk(rack, null, false));
    }
    return { cols3D: cols, side3D: banner, zoneLabel3D: undefined };
  }, [zone, rackViews, filteredRacks]);

  return (
    <div className="w-full space-y-4">
      <Hero
        compact
        title="ແຜນຜັງ Rack ແລະ Location"
        description="ລະບົບພາບຈຳລອງຄັງສິນຄ້າແບບໂຕ້ຕອບ, ເບິ່ງພື້ນທີ່ຫວ່າງ ແລະ ການໃຊ້ບໍລິມາດຂອງຊັ້ນວາງ"
        icon={<LayersIcon className="h-5 w-5 text-emerald-500" />}
        tone="emerald"
        chips={
          <>
            <Chip tone="emerald">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              ມີສິນຄ້າ
            </Chip>
            <Chip>
              <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              ຫວ່າງ
            </Chip>
            <Chip tone="amber">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              ໃກ້ເຕັມ
            </Chip>
            <Chip tone="red">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              ຕິດລົບ / ເຕັມ
            </Chip>
          </>
        }
      />

      {/* KPI Section */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          compact
          icon={<MapPinIcon className="h-4.5 w-4.5 text-zinc-500" />}
          label="Location ທັງໝົດ"
          value={summary.locations}
          sub={`${summary.occupiedLocations} ບ່ອນມີສິນຄ້າ · ${summary.emptyLocations} ບ່ອນຫວ່າງ`}
        />
        <KpiCard
          compact
          icon={<LayersIcon className="h-4.5 w-4.5 text-blue-500" />}
          label="ບໍລິມາດລວມທັງໝົດ"
          value={`${formatPallets(summary.capacityPallets)} ພາເລດ`}
          sub="ຄວາມຈຸຕຳແໜ່ງພາເລດຈາກພື້ນທີ່ Location"
          tone="blue"
          highlight
        />
        <KpiCard
          compact
          icon={<PackageIcon className="h-4.5 w-4.5 text-emerald-500" />}
          label="ບໍລິມາດທີ່ນຳໃຊ້"
          value={`${formatPallets(summary.usedPallets)} ພາເລດ`}
          sub="ຄຳນວນຈາກ Qty ÷ pallet ໃນ odg_wms_ph_dimension"
          tone="emerald"
          highlight
        />
        <KpiCard
          compact
          icon={<BuildingIcon className="h-4.5 w-4.5 text-violet-500" />}
          label="ບໍລິມາດຄົງເຫຼືອຫວ່າງ"
          value={`${formatPallets(summary.remainingPallets)} ພາເລດ`}
          sub={`${summary.fullLocations} ຕຳແໜ່ງເຕັມ/ເກີນ`}
          tone="violet"
          highlight
        />
        <KpiCard
          compact
          icon={<BuildingIcon className="h-4.5 w-4.5" />}
          label="ອັດຕາໃຊ້ຄວາມຈຸ"
          value={`${summary.palletUtilization.toFixed(1)}%`}
          sub={
            summary.missingPhQty > 0
              ? `${formatQty(summary.missingPhQty)} ຊິ້ນຍັງບໍ່ມີ PH`
              : "ຂໍ້ມູນ PH ສິນຄ້າຄົບຖ້ວນ"
          }
          tone={summary.palletUtilization >= 100 ? "red" : summary.palletUtilization >= 80 ? "amber" : "emerald"}
          highlight
        />
      </section>

      {/* Filters and Control Board */}
      <section className="rounded-2xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/75">
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[220px] flex-1 sm:max-w-xs">
            <span className="mb-2 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              ເລືອກສາງສິນຄ້າ (Warehouse)
            </span>
            <select
              value={selectedWarehouse?.code ?? ""}
              onChange={(event) => {
                setWarehouseCode(event.target.value);
                setSelectedCode(null);
              }}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 shadow-sm outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.code} value={warehouse.code}>
                  {warehouse.code} — {warehouse.name || "ບໍ່ມີຊື່"} ({warehouse.racks.length} rack)
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-[220px] flex-1 sm:max-w-xs">
            <span className="mb-2 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              ຄົ້ນຫາ Rack ຫຼື Location
            </span>
            <span className="relative block">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ປ້ອນລະຫັດ/ຊື່..."
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-4 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </span>
          </label>

          <div className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-850">
            {([
              ["all", "ທັງໝົດ"],
              ["occupied", "ມີສິນຄ້າ"],
              ["empty", "ຫວ່າງ"],
              ["full", "ເຕັມ/ເກີນ"],
              ["negative", "ຕິດລົບ"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-150 ${
                  status === value
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            <span className="text-zinc-500">ອັດຕາການນຳໃຊ້ບໍລິມາດສາງ</span>
            <span className="font-mono text-zinc-800 dark:text-zinc-200">
              {formatPallets(summary.usedPallets)} / {formatPallets(summary.capacityPallets)} ພາເລດ ({summary.palletUtilization.toFixed(1)}%)
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 shadow-inner">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                summary.palletUtilization >= 100
                  ? "bg-gradient-to-r from-red-500 to-rose-600"
                  : summary.palletUtilization >= 80
                    ? "bg-gradient-to-r from-amber-400 to-orange-500"
                    : "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"
              }`}
              style={{ width: `${Math.min(100, summary.palletUtilization)}%` }}
            />
          </div>
          {summary.missingPhQty > 0 && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <span>⚠️ ໝາຍເຫດ:</span>
              <span>
                ມີສິນຄ້າ {formatQty(summary.missingPhQty)} ໜ່ວຍ (ໃນ {summary.missingPhItems} SKU positions) ທີ່ຈັບຄູ່ `odg_wms_ph_dimension` ບໍ່ໄດ້; ຈຳນວນພາເລດທີ່ໃຊ້ຈິງອາດສູງກວ່ານີ້.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* View Toggle Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold text-zinc-500">
          ພົບ {filteredRacks.length} rack {status !== "all" || search ? "(ຜ່ານການກັ່ນຕອງ)" : ""}
        </span>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-850">
          {([
            ["grid", "ຕາຕະລາງຊັ້ນ", <BuildingIcon key="g" className="h-4 w-4" />],
            ["3d", "3D", <LayersIcon key="d" className="h-4 w-4" />],
            ["map", "ແຜນຜັງ 2D", <MapPinIcon key="m" className="h-4 w-4" />],
            ["list", "ລາຍການລະອຽດ", <ListIcon key="l" className="h-4 w-4" />],
          ] as const).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                view === value
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {filteredRacks.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white/50 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
          <LayersIcon className="mx-auto h-12 w-12 text-zinc-300 dark:text-zinc-700 animate-pulse" />
          <h3 className="mt-4 text-base font-bold text-zinc-900 dark:text-zinc-100">
            ບໍ່ພົບຂໍ້ມູນ Rack ຕາມເງື່ອນໄຂນີ້
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            ກະລຸນາປ່ຽນແປງຄຳຄົ້ນຫາ, ສະຖານະ ຫຼື ເລືອກສາງສິນຄ້າອື່ນ
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-base font-bold text-zinc-800 dark:text-zinc-100">
                <BuildingIcon className="h-5 w-5 text-emerald-500" />
                ຕາຕະລາງຊັ້ນວາງ ສາງ {selectedWarehouse?.code}
                <span className="text-xs font-medium text-zinc-400">
                  · {summary.occupiedRacks} ມີສິນຄ້າ / {summary.emptyRacks} ຫວ່າງ
                </span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                  ລະດັບເຕັມ:
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-8 rounded-sm bg-gradient-to-r from-teal-400 via-amber-400 to-red-500" />
                  <span className="text-[11px] text-zinc-500">ໜ້ອຍ → ເຕັມ</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-zinc-200 dark:bg-zinc-700" />
                  <span className="text-[11px] text-zinc-500">ຫວ່າງ</span>
                </span>
              </div>
            </div>
            {selectedWarehouse && ZONE_LAYOUTS[selectedWarehouse.code] ? (
              <ZonedFloorGrid
                rackViews={rackViews}
                zone={ZONE_LAYOUTS[selectedWarehouse.code]}
                selectedCode={selectedCode}
                onSelect={(code) =>
                  setSelectedCode((prev) => (prev === code ? null : code))
                }
              />
            ) : (
              <WarehouseFloorGrid
                racks={filteredRacks}
                selectedCode={selectedCode}
                onSelect={(code) =>
                  setSelectedCode((prev) => (prev === code ? null : code))
                }
              />
            )}
            <p className="mt-4 text-[11px] font-medium text-zinc-400">
              💡 ຄລິກຊ່ອງ Floor ໃດ ເພື່ອກາງเບິ່ງລາຍລະອຽດ ແລະ ສິນຄ້າຂອງ rack ນັ້ນດ້ານລຸ່ມ
            </p>
          </section>

          {selectedRack && (
            <RackElevationView
              rack={selectedRack}
              onClose={() => setSelectedCode(null)}
            />
          )}
        </div>
      ) : view === "3d" ? (
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-base font-bold text-zinc-800 dark:text-zinc-100">
                <LayersIcon className="h-5 w-5 text-emerald-500" />
                ພາບ 3D ສາງ {selectedWarehouse?.code}
                <span className="text-xs font-medium text-zinc-400">
                  · {summary.occupiedRacks} ມີສິນຄ້າ / {summary.emptyRacks} ຫວ່າງ
                </span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                  ຄວາມສູງ = ລະດັບເຕັມ:
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-8 rounded-sm bg-gradient-to-r from-teal-400 via-amber-400 to-red-500" />
                  <span className="text-[11px] text-zinc-500">ໜ້ອຍ → ເຕັມ</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-zinc-300 dark:bg-zinc-700" />
                  <span className="text-[11px] text-zinc-500">ຫວ່າງ</span>
                </span>
              </div>
            </div>
            <div className="relative h-[60vh] min-h-[420px] w-full touch-none">
              <Warehouse3D
                racks={cols3D}
                side={side3D}
                zoneLabel={zoneLabel3D}
                doors={zone?.doors}
                selectedCode={selectedCode}
                selectedLoc={focusLoc}
                onSelectRack={(code) => {
                  setFocusLoc(null);
                  setSelectedCode(code);
                }}
                onSelectCell={(rack, loc) => {
                  setSelectedCode(rack);
                  setFocusLoc(loc);
                }}
              />
              {/* Popup: clicked-location size + items + volume, over the 3D scene */}
              {focusLoc &&
                selectedRack &&
                (() => {
                  const loc = selectedRack.locations.find((l) => l.code === focusLoc);
                  if (!loc) return null;
                  const locItems = selectedRack.items.filter(
                    (it) => it.locationCode === focusLoc,
                  );
                  return (
                    <Location3DPopup
                      loc={loc}
                      items={locItems}
                      onClose={() => setFocusLoc(null)}
                    />
                  );
                })()}
            </div>
            <p className="border-t border-zinc-100 px-5 py-3 text-[11px] font-medium text-zinc-400 dark:border-zinc-800">
              🖱️ ລາກ = ໝຸນ · scroll = ຊູມ · ຄລິກຂວາລາກ = ເລື່ອນ · ຄລິກແຕ່ລະຫ້ອງ ເພື່ອเບິ່ງ popup ສິນຄ້າ
            </p>
          </section>
        </div>
      ) : view === "map" ? (
        <div className="space-y-6">
          {/* Aisle-based 2D warehouse layout */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-base font-bold text-zinc-800 dark:text-zinc-100">
                <MapPinIcon className="h-5 w-5 text-emerald-500 animate-bounce" />
                ແຜນຜັງພື້ນທີ່ສາງ: {selectedWarehouse?.code}
                <span className="text-xs font-medium text-zinc-400">
                  · {summary.occupiedRacks} ມີສິນຄ້າ / {summary.emptyRacks} ຫວ່າງ
                </span>
              </h2>
              {/* Heatmap Legend */}
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider">ລະດັບຄວາມແໜ້ນ:</span>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-zinc-150 dark:bg-zinc-800" title="ຫວ່າງ" />
                  <span className="text-[11px] text-zinc-500">0%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-8 bg-gradient-to-r from-teal-400 to-emerald-400 rounded-sm" />
                  <span className="text-[11px] text-zinc-500">1-50%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-8 bg-gradient-to-r from-amber-400 to-orange-400 rounded-sm" />
                  <span className="text-[11px] text-zinc-500">50-90%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-4 bg-red-400 rounded-sm" />
                  <span className="text-[11px] text-zinc-500">&gt;90%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-red-500 animate-pulse" />
                  <span className="text-[11px] text-red-500">ເຕັມ/ຕິດລົບ</span>
                </div>
              </div>
            </div>

            {/* Elevation map (looks like the 3D, flattened) */}
            <RackElevationMap
              rackViews={rackViews}
              filteredRacks={filteredRacks}
              zone={zone}
              selectedCode={selectedCode}
              selectedLoc={focusLoc}
              onSelectRack={(code) => {
                setFocusLoc(null);
                setSelectedCode((prev) => (prev === code ? null : code));
              }}
              onCellClick={(rack, loc) => {
                setSelectedCode(rack);
                setFocusLoc(loc);
              }}
            />
            <p className="mt-5 text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
              <span>💡 ຄຳແນະນຳ:</span>
              <span>ຄລິກແຕ່ລະຫ້ອງ ເພື່ອเບິ່ງສິນຄ້າ+ບໍລິມາດ · ຄລິກຊື່ Rack ເພື່ອเບິ່ງ Elevation ເຕັມດ້ານລຸ່ມ.</span>
            </p>
          </section>

          {/* Interactive Rack Elevation View */}
          {selectedRack && (
            <RackElevationView
              key={`${selectedRack.code}-${focusLoc ?? ""}`}
              rack={selectedRack}
              initialLocCode={focusLoc}
              onClose={() => {
                setSelectedCode(null);
                setFocusLoc(null);
              }}
            />
          )}
        </div>
      ) : (
        <section className="grid items-start gap-6 lg:grid-cols-2">
          {filteredRacks.map((rack) => (
            <RackElevationView key={rack.id} rack={rack} />
          ))}
        </section>
      )}
    </div>
  );
}

function cellTone(loc: LocationView) {
  if (loc.qty < 0) return "bg-red-500";
  if (loc.qty === 0) return "bg-zinc-200 dark:bg-zinc-700";
  const p = loc.utilizationPct;
  if (p == null) return "bg-emerald-400";
  if (p > 100) return "bg-rose-600";
  if (p >= 90) return "bg-red-500";
  if (p >= 75) return "bg-orange-500";
  if (p >= 50) return "bg-amber-500";
  if (p >= 25) return "bg-emerald-500";
  return "bg-teal-500";
}

function cellStatusText(loc: LocationView) {
  if (loc.qty < 0) return "ຍອດຕິດລົບ";
  if (loc.qty === 0) return "ຫວ່າງ";
  if (loc.utilizationPct == null) return `ມີສິນຄ້າ · ${loc.itemCount} SKU`;
  return `${Math.round(loc.utilizationPct)}% · ${loc.itemCount} SKU`;
}

// Compact 2D shelf elevation (floors stacked, ຫ້ອງ as cells) — the flattened
// equivalent of one 3D rack tower.
function MiniRackElevation({
  rack,
  maxFloor,
  selectedLoc,
  selected,
  onCellClick,
  onSelectRack,
}: {
  rack: RackView;
  maxFloor: number;
  selectedLoc: string | null;
  selected: boolean;
  onCellClick: (rackCode: string, locCode: string) => void;
  onSelectRack: (code: string) => void;
}) {
  const rows = [];
  for (let f = maxFloor; f >= 1; f--) {
    rows.push({
      floor: f,
      cells: rack.locations
        .filter((l) => (l.floor ?? 0) === f)
        .sort((a, b) => a.code.localeCompare(b.code)),
    });
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`rounded-md border-2 bg-slate-100/60 p-1 shadow-sm dark:bg-zinc-900 ${
          selected
            ? "border-zinc-900 dark:border-white"
            : "border-slate-400/70 dark:border-slate-700"
        }`}
      >
        {rows.map((row) => (
          <div
            key={row.floor}
            className="mb-0.5 flex justify-center gap-0.5 border-b border-slate-300/40 pb-0.5 last:mb-0 last:border-b-0 last:pb-0 dark:border-slate-700/40"
          >
            {row.cells.length === 0 ? (
              <span className="text-[7px] leading-3 text-zinc-300">·</span>
            ) : (
              row.cells.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  title={`${loc.code}\n${cellStatusText(loc)}`}
                  onClick={() => onCellClick(rack.code, loc.code)}
                  className={`h-3.5 w-3.5 rounded-[2px] transition hover:scale-125 hover:ring-1 hover:ring-zinc-900 dark:hover:ring-white ${cellTone(
                    loc,
                  )} ${
                    selectedLoc === loc.code
                      ? "ring-2 ring-zinc-900 dark:ring-white"
                      : ""
                  }`}
                />
              ))
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onSelectRack(rack.code)}
        className={`max-w-24 truncate font-mono text-[10px] font-bold transition ${
          selected
            ? "text-zinc-900 underline dark:text-white"
            : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
        }`}
      >
        {rack.name || rack.code}
      </button>
    </div>
  );
}

function RackElevationMap({
  rackViews,
  filteredRacks,
  zone,
  selectedCode,
  selectedLoc,
  onSelectRack,
  onCellClick,
}: {
  rackViews: RackView[];
  filteredRacks: RackView[];
  zone: ZoneConfig | null;
  selectedCode: string | null;
  selectedLoc: string | null;
  onSelectRack: (code: string) => void;
  onCellClick: (rackCode: string, locCode: string) => void;
}) {
  const byCode = useMemo(
    () => new Map(rackViews.map((r) => [r.code, r])),
    [rackViews],
  );

  if (!zone) {
    const maxFloor = Math.max(
      1,
      ...filteredRacks.flatMap((r) => r.locations.map((l) => l.floor ?? 0)),
    );
    return (
      <div className="flex items-end gap-2 overflow-x-auto pb-3">
        {filteredRacks.map((rack) => (
          <div key={rack.id} className="flex flex-col items-center">
            <div className="h-[18px]" />
            <MiniRackElevation
              rack={rack}
              maxFloor={maxFloor}
              selectedLoc={selectedLoc}
              selected={selectedCode === rack.code}
              onCellClick={onCellClick}
              onSelectRack={onSelectRack}
            />
          </div>
        ))}
      </div>
    );
  }

  const groups = zone.groups
    .map((g) => ({
      label: g.label,
      aisleAfter: g.aisleAfter ?? [],
      racks: g.rackCodes
        .map((c) => byCode.get(c))
        .filter((r): r is RackView => Boolean(r)),
    }))
    .filter((g) => g.racks.length > 0);
  const sideRack = zone.side ? byCode.get(zone.side.rackCodes[0]) ?? null : null;
  const doorByCode = new Map((zone.doors ?? []).map((d) => [d.atRackCode, d.label]));
  const maxFloor = Math.max(
    1,
    ...[...groups.flatMap((g) => g.racks), ...(sideRack ? [sideRack] : [])].flatMap(
      (r) => r.locations.map((l) => l.floor ?? 0),
    ),
  );

  return (
    <div className="flex items-stretch gap-3 overflow-x-auto pb-3">
      {groups.map((g) => {
        const slots: ({ type: "rack"; rack: RackView } | { type: "aisle" })[] = [];
        g.racks.forEach((rack) => {
          slots.push({ type: "rack", rack });
          if (g.aisleAfter.includes(rack.code)) slots.push({ type: "aisle" });
        });
        const template = slots
          .map((s) => (s.type === "aisle" ? "14px" : "auto"))
          .join(" ");
        return (
          <div
            key={g.label}
            className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-950/20"
          >
            <div
              className="grid items-end gap-x-1.5 gap-y-1.5"
              style={{ gridTemplateColumns: template }}
            >
              {/* Door row — ABOVE the zone label */}
              {slots.map((s, i) =>
                s.type === "rack" && doorByCode.has(s.rack.code) ? (
                  <div
                    key={`door-${i}`}
                    style={{ gridColumn: i + 1, gridRow: 1 }}
                    className="flex flex-col items-center"
                  >
                    <span className="whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                      🚪 {doorByCode.get(s.rack.code)}
                    </span>
                    <span className="h-2 w-px bg-sky-500/60" />
                  </div>
                ) : null,
              )}

              {/* Zone label (below doors) */}
              <div
                style={{ gridColumn: "1 / -1", gridRow: 2 }}
                className="rounded-md bg-zinc-100 px-2 py-1 text-center text-xs font-bold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
              >
                {g.label}
              </div>

              {/* Rack elevations + aisle dividers */}
              {slots.map((s, i) =>
                s.type === "aisle" ? (
                  <div
                    key={`aisle-${i}`}
                    title="ຊ່ອງຍ່າງ"
                    style={{ gridColumn: i + 1, gridRow: 3 }}
                    className="mx-auto h-full border-l-2 border-dashed border-zinc-300 dark:border-zinc-700"
                  />
                ) : (
                  <div key={s.rack.id} style={{ gridColumn: i + 1, gridRow: 3 }}>
                    <MiniRackElevation
                      rack={s.rack}
                      maxFloor={maxFloor}
                      selectedLoc={selectedLoc}
                      selected={selectedCode === s.rack.code}
                      onCellClick={onCellClick}
                      onSelectRack={onSelectRack}
                    />
                  </div>
                ),
              )}
            </div>
          </div>
        );
      })}

      {sideRack && zone.side && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 dark:border-zinc-800 dark:bg-zinc-950/20">
          <div className="rounded-md bg-zinc-100 px-2 py-1 text-center text-xs font-bold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
            {zone.side.label}
          </div>
          <div className="flex items-end">
            <div className="flex flex-col items-center">
              <div className="h-[18px]" />
              <MiniRackElevation
                rack={sideRack}
                maxFloor={maxFloor}
                selectedLoc={selectedLoc}
                selected={selectedCode === sideRack.code}
                onCellClick={onCellClick}
                onSelectRack={onSelectRack}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function floorCellStyle(pct: number, empty: boolean, negative: boolean) {
  if (negative)
    return "bg-red-500/15 text-red-700 ring-red-500/40 dark:bg-red-950/40 dark:text-red-300";
  if (empty)
    return "bg-zinc-50 text-zinc-400 ring-zinc-200/70 dark:bg-zinc-900/40 dark:text-zinc-500 dark:ring-zinc-800";
  if (pct > 100)
    return "bg-rose-500/20 text-rose-700 ring-rose-500/50 dark:bg-rose-950/50 dark:text-rose-300";
  if (pct >= 90)
    return "bg-red-500/15 text-red-700 ring-red-400/40 dark:bg-red-950/40 dark:text-red-300";
  if (pct >= 75)
    return "bg-orange-500/15 text-orange-700 ring-orange-400/40 dark:bg-orange-950/40 dark:text-orange-300";
  if (pct >= 50)
    return "bg-amber-500/15 text-amber-700 ring-amber-400/40 dark:bg-amber-950/40 dark:text-amber-300";
  if (pct >= 25)
    return "bg-emerald-500/15 text-emerald-700 ring-emerald-400/40 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "bg-teal-500/15 text-teal-700 ring-teal-400/40 dark:bg-teal-950/40 dark:text-teal-300";
}

function floorAgg(rack: RackView, floor: number) {
  const locs = rack.locations.filter((l) => (l.floor ?? 0) === floor);
  const total = locs.length;
  const occupied = locs.filter((l) => l.qty !== 0).length;
  const capacity = locs.reduce((s, l) => s + (l.capacityPallets ?? 0), 0);
  const used = locs.reduce((s, l) => s + l.usedPallets, 0);
  const pct =
    capacity > 0
      ? (used / capacity) * 100
      : total > 0
        ? (occupied / total) * 100
        : 0;
  return { total, occupied, pct, empty: occupied === 0, negative: locs.some((l) => l.qty < 0) };
}

// Zoned floor grid: ZONE Z → Z01/Z02 sub-zones over rack columns, AZ03 as a
// merged side block. Layout comes from ZONE_LAYOUTS (not the DB).
function ZonedFloorGrid({
  rackViews,
  zone,
  selectedCode,
  onSelect,
}: {
  rackViews: RackView[];
  zone: ZoneConfig;
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const byCode = useMemo(
    () => new Map(rackViews.map((r) => [r.code, r])),
    [rackViews],
  );

  const groups = zone.groups
    .map((g) => ({
      label: g.label,
      racks: g.rackCodes
        .map((c) => byCode.get(c))
        .filter((r): r is RackView => Boolean(r)),
    }))
    .filter((g) => g.racks.length > 0);

  const racks = groups.flatMap((g) => g.racks);
  const cols = racks.length;
  const sideRack = zone.side ? byCode.get(zone.side.rackCodes[0]) ?? null : null;
  const aisleSet = new Set(zone.groups.flatMap((g) => g.aisleAfter ?? []));
  const doorMap = new Map((zone.doors ?? []).map((d) => [d.atRackCode, d.label]));
  const aisleCls = (code: string) =>
    aisleSet.has(code) ? "mr-2 border-r-4 border-dashed border-zinc-300 dark:border-zinc-700" : "";

  const maxFloor = Math.max(
    1,
    ...[...racks, ...(sideRack ? [sideRack] : [])].flatMap((r) =>
      r.locations.map((l) => l.floor ?? 0),
    ),
  );
  const floors = Array.from({ length: maxFloor }, (_, i) => i + 1);
  const headerRow = 3;
  const firstFloorRow = 4;

  if (cols === 0) {
    return <p className="text-sm text-zinc-500">ບໍ່ມີ rack ໃຫ້ສະແດງ</p>;
  }

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
      <div
        className="grid min-w-max flex-1 gap-1.5"
        style={{ gridTemplateColumns: `60px repeat(${cols}, minmax(76px, 1fr))` }}
      >
        {/* Zone label (umbrella) */}
        {zone.zoneLabel && (
          <div
            style={{ gridColumn: `2 / ${2 + cols}`, gridRow: 1 }}
            className="flex items-center justify-center rounded-lg bg-zinc-800 py-1.5 text-sm font-bold tracking-wider text-white dark:bg-zinc-700"
          >
            {zone.zoneLabel}
          </div>
        )}

        {/* Sub-zone labels */}
        {(() => {
          let start = 2;
          return groups.map((g) => {
            const span = g.racks.length;
            const el = (
              <div
                key={g.label}
                style={{ gridColumn: `${start} / ${start + span}`, gridRow: 2 }}
                className="flex items-center justify-center rounded-md bg-zinc-100 py-1 text-xs font-bold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
              >
                {g.label}
              </div>
            );
            start += span;
            return el;
          });
        })()}

        {/* Doors (ປະຕູສາງ) */}
        {racks.map((rack, i) =>
          doorMap.has(rack.code) ? (
            <div
              key={`door-${rack.id}`}
              style={{ gridColumn: 2 + i, gridRow: 1 }}
              className="flex items-end justify-center"
            >
              <span className="whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                🚪 {doorMap.get(rack.code)}
              </span>
            </div>
          ) : null,
        )}

        {/* Corner */}
        <div
          style={{ gridColumn: 1, gridRow: headerRow }}
          className="flex items-center justify-center rounded-md bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:bg-zinc-800"
        >
          Floor
        </div>

        {/* Rack headers */}
        {racks.map((rack, i) => (
          <button
            key={rack.id}
            type="button"
            onClick={() => onSelect(rack.code)}
            style={{ gridColumn: 2 + i, gridRow: headerRow }}
            title={rack.code}
            className={`truncate rounded-md px-1 py-1.5 text-center text-xs font-bold ring-1 ring-inset transition ${aisleCls(
              rack.code,
            )} ${
              selectedCode === rack.code
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900"
                : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            {rack.name || rack.code}
          </button>
        ))}

        {/* Floor rows */}
        {floors.map((floor, fi) => (
          <Fragment key={floor}>
            <div
              style={{ gridColumn: 1, gridRow: firstFloorRow + fi }}
              className="flex items-center justify-center rounded-md bg-zinc-50 text-[11px] font-bold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300"
            >
              Floor {floor}
            </div>
            {racks.map((rack, i) => {
              const a = floorAgg(rack, floor);
              const selected = selectedCode === rack.code;
              return (
                <button
                  key={rack.id}
                  type="button"
                  onClick={() => onSelect(rack.code)}
                  style={{ gridColumn: 2 + i, gridRow: firstFloorRow + fi }}
                  title={`${rack.name || rack.code} · Floor ${floor}\n${a.occupied}/${a.total} ຊ່ອງມີສິນຄ້າ${a.empty ? "" : ` · ${a.pct.toFixed(0)}%`}`}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-md px-1 py-1 text-center ring-1 ring-inset transition hover:-translate-y-0.5 hover:shadow ${aisleCls(
                    rack.code,
                  )} ${
                    a.total === 0
                      ? "bg-zinc-50/40 text-zinc-300 ring-zinc-100 dark:bg-zinc-900/20 dark:text-zinc-700 dark:ring-zinc-800/50"
                      : floorCellStyle(a.pct, a.empty, a.negative)
                  } ${
                    selected
                      ? "outline outline-2 outline-offset-1 outline-zinc-900 dark:outline-white"
                      : ""
                  }`}
                >
                  {a.total === 0 ? (
                    <span className="text-[10px] opacity-50">—</span>
                  ) : (
                    <>
                      <span className="font-mono text-xs font-bold leading-none">
                        {a.empty ? "ຫວ່າງ" : `${Math.round(a.pct)}%`}
                      </span>
                      <span className="mt-0.5 text-[9px] font-medium opacity-70">
                        {a.occupied}/{a.total}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* AZ03 — merged side block */}
      {sideRack && zone.side && (
        <button
          type="button"
          onClick={() => onSelect(sideRack.code)}
          title={sideRack.name || sideRack.code}
          className={`flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 text-center ring-1 ring-inset transition hover:shadow ${
            selectedCode === sideRack.code
              ? "outline outline-2 outline-offset-1 outline-zinc-900 dark:outline-white "
              : ""
          }${floorCellStyle(
            sideRack.capacityPallets > 0
              ? (sideRack.usedPallets / sideRack.capacityPallets) * 100
              : sideRack.hasStock
                ? 100
                : 0,
            !sideRack.hasStock,
            sideRack.hasNegative,
          )}`}
        >
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider opacity-70 dark:bg-white/10">
            {zone.side.label}
          </span>
          <span className="font-mono text-sm font-bold">{sideRack.name || sideRack.code}</span>
          <span className="text-[10px] font-medium opacity-70">
            {sideRack.occupiedLocations}/{sideRack.locations.length} ຊ່ອງ
          </span>
        </button>
      )}
    </div>
  );
}

// Spreadsheet-style rack × floor matrix (one column per rack, one row per
// floor level). A rack whose name ends in "Z" is shown as a full-width banner
// on top, matching the physical 1201 layout.
function WarehouseFloorGrid({
  racks,
  selectedCode,
  onSelect,
}: {
  racks: RackView[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const { columns, banner, floors } = useMemo(() => {
    const isBanner = (rack: RackView) => /\bz$/i.test((rack.name ?? "").trim());
    const bannerRack = racks.find(isBanner) ?? null;
    const cols = racks.filter((rack) => rack !== bannerRack);
    let maxFloor = 1;
    for (const rack of racks)
      for (const location of rack.locations)
        if (location.floor && location.floor > maxFloor) maxFloor = location.floor;
    return {
      columns: cols,
      banner: bannerRack,
      floors: Array.from({ length: maxFloor }, (_, i) => i + 1),
    };
  }, [racks]);

  const aggFor = (rack: RackView, floor: number) => {
    const locs = rack.locations.filter((l) => (l.floor ?? 0) === floor);
    const total = locs.length;
    const occupied = locs.filter((l) => l.qty !== 0).length;
    const capacity = locs.reduce((s, l) => s + (l.capacityPallets ?? 0), 0);
    const used = locs.reduce((s, l) => s + l.usedPallets, 0);
    const negative = locs.some((l) => l.qty < 0);
    const pct =
      capacity > 0
        ? (used / capacity) * 100
        : total > 0
          ? (occupied / total) * 100
          : 0;
    return { total, occupied, pct, empty: occupied === 0, negative };
  };

  if (columns.length === 0) {
    return <p className="text-sm text-zinc-500">ບໍ່ມີ rack ໃຫ້ສະແດງ</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-full gap-1.5"
        style={{
          gridTemplateColumns: `64px repeat(${columns.length}, minmax(82px, 1fr))`,
        }}
      >
        {banner && (
          <button
            type="button"
            onClick={() => onSelect(banner.code)}
            style={{ gridColumn: "1 / -1" }}
            className={`mb-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold ring-1 ring-inset transition hover:shadow-md ${
              selectedCode === banner.code
                ? "outline outline-2 outline-offset-1 outline-zinc-900 dark:outline-white "
                : ""
            }${floorCellStyle(
              banner.capacityPallets > 0
                ? (banner.usedPallets / banner.capacityPallets) * 100
                : banner.hasStock
                  ? 100
                  : 0,
              !banner.hasStock,
              banner.hasNegative,
            )}`}
          >
            {banner.name || banner.code}
            <span className="text-[10px] font-medium opacity-70">
              {banner.occupiedLocations}/{banner.locations.length} ຊ່ອງ
            </span>
          </button>
        )}

        {/* Header row */}
        <div className="sticky left-0 z-10 flex items-center justify-center rounded-md bg-zinc-100 px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:bg-zinc-800">
          Floor
        </div>
        {columns.map((rack) => (
          <button
            key={rack.id}
            type="button"
            onClick={() => onSelect(rack.code)}
            title={rack.code}
            className={`truncate rounded-md px-1 py-2 text-center text-xs font-bold ring-1 ring-inset transition ${
              selectedCode === rack.code
                ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900"
                : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            {rack.name || rack.code}
          </button>
        ))}

        {/* Floor rows */}
        {floors.map((floor) => (
          <Fragment key={floor}>
            <div className="sticky left-0 z-10 flex items-center justify-center rounded-md bg-zinc-50 px-1 text-[11px] font-bold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              Floor {floor}
            </div>
            {columns.map((rack) => {
              const a = aggFor(rack, floor);
              const selected = selectedCode === rack.code;
              return (
                <button
                  key={rack.id}
                  type="button"
                  onClick={() => onSelect(rack.code)}
                  title={`${rack.name || rack.code} · Floor ${floor}\n${a.occupied}/${a.total} ຊ່ອງມີສິນຄ້າ${a.empty ? "" : ` · ${a.pct.toFixed(0)}%`}`}
                  className={`flex min-h-13 flex-col items-center justify-center rounded-md px-1 py-1.5 text-center ring-1 ring-inset transition hover:-translate-y-0.5 hover:shadow ${
                    a.total === 0
                      ? "bg-zinc-50/40 text-zinc-300 ring-zinc-100 dark:bg-zinc-900/20 dark:text-zinc-700 dark:ring-zinc-800/50"
                      : floorCellStyle(a.pct, a.empty, a.negative)
                  } ${
                    selected
                      ? "outline outline-2 outline-offset-1 outline-zinc-900 dark:outline-white"
                      : ""
                  }`}
                >
                  {a.total === 0 ? (
                    <span className="text-[10px] opacity-50">—</span>
                  ) : (
                    <>
                      <span className="font-mono text-xs font-bold leading-none">
                        {a.empty ? "ຫວ່າງ" : `${Math.round(a.pct)}%`}
                      </span>
                      <span className="mt-0.5 text-[9px] font-medium opacity-70">
                        {a.occupied}/{a.total}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// 2D Floor map tile redesign with premium visuals
function FloorTile({
  rack,
  selected,
  onSelect,
}: {
  rack: RackView;
  selected: boolean;
  onSelect: () => void;
}) {
  const heat = rackHeat(rack);
  const style = heatStyle(heat);

  const statusLabel = heat.negative
    ? "ຍອດຕິດລົບ"
    : heat.empty
      ? "ຫວ່າງ"
      : `${heat.pct.toFixed(0)}%${heat.estimated ? " (ປະມານ)" : ""}`;

  const bigLabel = heat.empty ? "ຫວ່າງ" : `${Math.round(heat.pct)}%`;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${rack.code}${rack.name ? ` — ${rack.name}` : ""}\nສະຖານະ: ${statusLabel}\n${rack.occupiedLocations}/${rack.locations.length} locations active\nພາເລດ: ${formatPallets(rack.usedPallets)} / ${formatPallets(rack.capacityPallets)}\nQty: ${formatQty(rack.qty)}`}
      className={`group relative flex aspect-[1.1] flex-col justify-between rounded-2xl p-3 text-left ring-1 ring-inset transition-all duration-300 ease-out ${style.tile} ${style.glow} ${
        selected
          ? "scale-[1.03] ring-2 ring-zinc-950 dark:ring-zinc-50 shadow-lg bg-white/90 dark:bg-zinc-900/90 z-10"
          : "hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      {/* Selected Indicator Checkmark */}
      {selected && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5.5 w-5.5 items-center justify-center rounded-full bg-zinc-950 text-white shadow-md ring-2 ring-white dark:bg-white dark:text-zinc-950 dark:ring-zinc-900">
          <CheckIcon className="h-3 w-3" />
        </span>
      )}

      {/* Header Info */}
      <div className="flex items-start justify-between gap-1 w-full">
        <span className="truncate font-mono text-[11px] font-bold tracking-tight uppercase">
          {rack.code}
        </span>
        <div className="flex items-center gap-1">
          {heat.estimated && !heat.empty && (
            <span
              title="ຈຳນວນພາເລດປະມານ — ມີ SKU ທີ່ຈັບຄູ່ PH ບໍ່ໄດ້"
              className="text-[9px] font-black text-amber-500"
            >
              ~
            </span>
          )}
          {!rack.active && (
            <span className="rounded bg-zinc-200/80 px-1 text-[8px] font-extrabold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              ປິດ
            </span>
          )}
        </div>
      </div>

      {/* Large visual value */}
      <div className="my-1.5">
        <div className="font-mono text-xl font-black tracking-tight tabular-nums leading-none">
          {bigLabel}
        </div>
      </div>

      {/* Footer Info & mini progress bar */}
      <div className="w-full space-y-1.5">
        <div className="text-[9px] font-bold opacity-80 leading-none">
          {rack.locations.length > 0
            ? `${rack.occupiedLocations}/${rack.locations.length} ບ່ອນ`
            : `qty: ${formatQty(rack.qty)}`}
        </div>

        {!heat.empty && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200/50 dark:bg-zinc-850">
            <div
              className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
              style={{ width: `${Math.min(100, Math.max(5, heat.pct))}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

// Focused panel for a single clicked cell (ຫ້ອງ) — shows only that location's
// items, not the whole rack elevation.
function SingleCellPanel({
  rack,
  locationCode,
  onClose,
}: {
  rack: RackView;
  locationCode: string;
  onClose: () => void;
}) {
  const [itemSearch, setItemSearch] = useState("");
  const loc = rack.locations.find((l) => l.code === locationCode) ?? null;
  const allItems = rack.items.filter((i) => i.locationCode === locationCode);
  const items = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (i) =>
        i.itemCode.toLowerCase().includes(q) ||
        (i.itemName ?? "").toLowerCase().includes(q),
    );
  }, [allItems, itemSearch]);
  const usedTotal = allItems.reduce((s, i) => s + i.usedPallets, 0);

  return (
    <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-md dark:border-emerald-950/70 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-150 bg-emerald-50/40 px-6 py-4 dark:border-zinc-850 dark:bg-emerald-950/10">
        <div className="flex items-center gap-2">
          <MapPinIcon className="h-5 w-5 text-emerald-500" />
          <div>
            <h2 className="font-mono text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-50">
              {locationCode}
            </h2>
            <p className="text-[11px] font-bold text-zinc-400">
              {rack.name || rack.code}
              {loc?.name ? ` · ${loc.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-base font-black text-zinc-900 dark:text-zinc-50">
              {loc?.utilizationPct == null
                ? "—"
                : `${loc.utilizationPct.toFixed(0)}%`}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              {loc?.capacityPallets
                ? `${formatPallets(usedTotal)} / ${formatPallets(loc.capacityPallets)} ພາເລດ`
                : "ໃຊ້ຄວາມຈຸ"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            title="ປິດ"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="space-y-4 p-6">
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="ຄົ້ນຫາ SKU ໃນຫ້ອງ..."
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-xs text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          ລາຍການສິນຄ້າ ({items.length})
        </span>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            {allItems.length === 0 ? "ຫ້ອງນີ້ບໍ່ມີສິນຄ້າ" : "ບໍ່ພົບຕາມຄຳຄົ້ນຫາ"}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, idx) => {
              const sharePct =
                usedTotal > 0 ? (item.usedPallets / usedTotal) * 100 : 0;
              return (
                <div
                  key={`${item.itemCode}-${idx}`}
                  className={`rounded-xl border bg-white p-3 transition hover:shadow-md dark:bg-zinc-900 ${
                    item.qty < 0
                      ? "border-red-200 dark:border-red-950/80"
                      : "border-zinc-150 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        {item.itemCode}
                      </div>
                      {item.itemName && (
                        <div
                          className="mt-0.5 max-w-[170px] truncate text-[10px] text-zinc-500"
                          title={item.itemName}
                        >
                          {item.itemName}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`font-mono text-xs font-black ${
                          item.qty < 0
                            ? "text-red-500"
                            : "text-zinc-900 dark:text-zinc-50"
                        }`}
                      >
                        {formatQty(item.qty)}
                      </span>
                      {item.unitCode && (
                        <span className="ml-1 text-[9px] font-semibold text-zinc-400">
                          {item.unitCode}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2 text-[9px] font-semibold text-zinc-400 dark:border-zinc-800">
                    <span>
                      {item.palletQty
                        ? `${formatQty(item.palletQty)} ${item.unitCode || "ໜ່ວຍ"}/ພາເລດ${item.stackQty ? ` · stack ${formatQty(item.stackQty)}` : ""}`
                        : "ຈັບຄູ່ PH ບໍ່ໄດ້"}
                    </span>
                    <span>
                      {item.missingPh ? (
                        <span className="text-amber-500">ບໍ່ມີ PH</span>
                      ) : (
                        <span>
                          {formatPallets(item.usedPallets)} ພາເລດ ({sharePct.toFixed(0)}%)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// Visual 2D Rack Elevation view component (displays the rack's shelf levels)
function RackElevationView({
  rack,
  onClose,
  initialLocCode = null,
}: {
  rack: RackView;
  onClose?: () => void;
  initialLocCode?: string | null;
}) {
  const [selectedLocCode, setSelectedLocCode] = useState<string | null>(
    initialLocCode,
  );
  const [itemSearch, setItemSearch] = useState("");

  const palletUtilization =
    rack.capacityPallets > 0 ? (rack.usedPallets / rack.capacityPallets) * 100 : 0;

  const tone = rack.hasNegative
    ? "red"
    : rack.hasStock
      ? "emerald"
      : "empty";

  // Group locations of selected rack by Floor level
  const levels = useMemo(() => {
    const floorMap = new Map<number, LocationView[]>();
    const unspecified: LocationView[] = [];

    for (const loc of rack.locations) {
      let floorVal = loc.floor;

      // If floor field is missing, try to parse it from name format: e.g. "A0201" -> level 2
      if (floorVal === null && loc.name) {
        const match = loc.name.match(/^[A-Za-z](\d{2})\d{2}$/);
        if (match) {
          floorVal = parseInt(match[1], 10);
        }
      }

      if (floorVal !== null && !isNaN(floorVal)) {
        const list = floorMap.get(floorVal) ?? [];
        list.push(loc);
        floorMap.set(floorVal, list);
      } else {
        unspecified.push(loc);
      }
    }

    // Sort locations in each level horizontally by code
    for (const [floorVal, list] of floorMap.entries()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    unspecified.sort((a, b) => a.code.localeCompare(b.code));

    // Stack levels highest to lowest (e.g. Floor 6 at top, Floor 1 at bottom)
    const sortedLevels = Array.from(floorMap.keys())
      .sort((a, b) => b - a)
      .map((floorNum) => ({
        floor: floorNum,
        name: `Floor ${floorNum} (ຊັ້ນ ${floorNum})`,
        locations: floorMap.get(floorNum) || [],
      }));

    if (unspecified.length > 0) {
      sortedLevels.push({
        floor: -1,
        name: "ຊັ້ນທົ່ວໄປ (Unspecified / Bulk Area)",
        locations: unspecified,
      });
    }

    return sortedLevels;
  }, [rack.locations]);

  // Find items inside currently open location
  const openItems = useMemo(() => {
    if (!selectedLocCode) return [];
    return rack.items.filter((item) => item.locationCode === selectedLocCode);
  }, [rack.items, selectedLocCode]);

  // Filter items in location by search box
  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return openItems;
    return openItems.filter(
      (item) =>
        item.itemCode.toLowerCase().includes(q) ||
        (item.itemName ?? "").toLowerCase().includes(q)
    );
  }, [openItems, itemSearch]);

  const activeLocDetails = rack.locations.find((l) => l.code === selectedLocCode) || null;
  const visibleLevels = useMemo(() => {
    if (!selectedLocCode) return levels;
    return levels
      .map((level) => ({
        ...level,
        locations: level.locations.filter(
          (location) => location.code === selectedLocCode,
        ),
      }))
      .filter((level) => level.locations.length > 0);
  }, [levels, selectedLocCode]);

  const remainingPallets = Math.max(
    0,
    rack.capacityPallets - rack.usedPallets,
  );
  const statusText =
    tone === "red" ? "ຍອດຕິດລົບ" : tone === "emerald" ? "ມີສິນຄ້າ" : "ຫວ່າງ";
  const accent =
    tone === "red"
      ? {
          pill: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
          icon: "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400",
          glow: "from-red-500/10",
          bar: "bg-gradient-to-r from-red-500 to-rose-600",
        }
      : tone === "emerald"
        ? {
            pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
            icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
            glow: "from-emerald-500/10",
            bar:
              palletUtilization >= 100
                ? "bg-gradient-to-r from-red-500 to-rose-600"
                : palletUtilization >= 80
                  ? "bg-gradient-to-r from-amber-400 to-orange-500"
                  : "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500",
          }
        : {
            pill: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
            icon: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
            glow: "from-zinc-400/10",
            bar: "bg-zinc-300 dark:bg-zinc-700",
          };

  return (
    <article className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header bar */}
      <header className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden px-6 py-5">
        <div
          className={`pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent opacity-60 ${accent.glow}`}
        />
        <div className="relative flex items-center gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl shadow-sm ${accent.icon}`}
          >
            🗄️
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">
                {rack.code}
              </h2>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${accent.pill}`}>
                {statusText}
              </span>
              {!rack.active && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                  ປິດໃຊ້ງານ
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {rack.name || "ບໍ່ມີຊື່ Rack"}
            </p>
          </div>
        </div>

        <div className="relative flex items-center gap-5">
          <div className="text-right">
            <div className="font-mono text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50">
              {formatQty(rack.qty)}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              ຈຳນວນລວມ · {rack.itemCount} SKU slots
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white/80 text-zinc-400 shadow-sm transition hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
              title="ປິດ"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* Stats strip + utilization bar */}
      <div className="border-y border-zinc-100 bg-zinc-50/70 px-6 py-4 dark:border-zinc-800/70 dark:bg-zinc-950/30">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="ຄວາມຈຸ Rack" value={`${formatPallets(rack.capacityPallets)} ພາເລດ`} />
          <MiniStat label="ໃຊ້ແລ້ວ" value={`${formatPallets(rack.usedPallets)} ພາເລດ`} tone="emerald" />
          <MiniStat label="ຍັງຫວ່າງ" value={`${formatPallets(remainingPallets)} ພາເລດ`} tone="blue" />
          <MiniStat
            label="ໃຊ້ຄວາມຈຸ"
            value={`${palletUtilization.toFixed(1)}%`}
            tone={palletUtilization >= 100 ? "red" : palletUtilization >= 80 ? "amber" : "emerald"}
          />
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-zinc-400">
            <span className="uppercase tracking-wider">ການນຳໃຊ້ບໍລິມາດ Rack</span>
            <span className="font-mono text-zinc-600 dark:text-zinc-300">
              {formatPallets(rack.usedPallets)} / {formatPallets(rack.capacityPallets)} ພາເລດ · {palletUtilization.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 shadow-inner dark:bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${accent.bar}`}
              style={{ width: `${Math.min(100, palletUtilization)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {/* Direct stock warn */}
        {rack.directQty !== 0 && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 shadow-sm dark:bg-amber-950/20 dark:text-amber-300">
            <span className="flex items-center gap-1 font-semibold">
              📦 ສິນຄ້າເກັບຢູ່ລະດັບ Rack (ຍັງບໍ່ໄດ້ຈັດລົງ Location ລະອຽດ)
            </span>
            <span className="font-mono font-bold">{formatQty(rack.directQty)} ໜ່ວຍ</span>
          </div>
        )}

        {rack.locations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 px-6 py-12 text-center text-xs text-zinc-500 dark:border-zinc-800">
            Rack ນີ້ຍັງບໍ່ມີ Location ຕຳແໜ່ງເກັບໃນຖານຂໍ້ມູນ (master tables)
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* LEFT: shelf elevation — full shelf stays visible, selected cell highlighted, others dimmed */}
            <div className={`${selectedLocCode ? "lg:col-span-7" : "lg:col-span-12"} space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  ໂຄງສ້າງຊັ້ນວາງ (Rack Elevation)
                </span>
                <span className="text-[10px] font-semibold text-zinc-400">
                  {selectedLocCode
                    ? `ເລືອກ ${selectedLocCode}`
                    : "ກົດ Location ໃດ ເພື່ອเບິ່ງสินค้า"}
                </span>
              </div>

              <div className="space-y-3 rounded-2xl border border-zinc-200/70 bg-gradient-to-b from-zinc-50 to-white p-4 shadow-inner dark:border-zinc-800 dark:from-zinc-950/40 dark:to-zinc-900/20">
                {levels.map((level) => {
                  const occ = level.locations.filter((l) => l.qty !== 0).length;
                  return (
                    <div key={level.floor} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wide text-white dark:bg-zinc-700">
                          {level.floor === -1 ? "BULK" : `ຊັ້ນ ${level.floor}`}
                        </span>
                        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                        <span className="font-mono text-[9px] font-bold text-zinc-400">
                          {occ}/{level.locations.length}
                        </span>
                      </div>

                      <div
                        className={
                          selectedLocCode
                            ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
                            : "grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9"
                        }
                      >
                        {level.locations.map((loc) => (
                          <LocationShelfSlot
                            key={loc.id}
                            location={loc}
                            selected={selectedLocCode === loc.code}
                            dimmed={selectedLocCode !== null && selectedLocCode !== loc.code}
                            onSelect={() =>
                              setSelectedLocCode((prev) =>
                                prev === loc.code ? null : loc.code,
                              )
                            }
                          />
                        ))}
                      </div>

                      {/* shelf beam */}
                      <div className="h-1.5 rounded-full bg-gradient-to-r from-zinc-300 via-zinc-200 to-zinc-300 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-700" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT: selected-location detail */}
            {selectedLocCode && activeLocDetails && (
              <div className="space-y-4 rounded-2xl border border-zinc-200 bg-zinc-50/40 p-4 shadow-inner dark:border-zinc-800 dark:bg-zinc-950/20 lg:col-span-5">
                <div className="flex items-center justify-between border-b border-zinc-200/60 pb-3 dark:border-zinc-800">
                  <div className="min-w-0">
                    <h3 className="truncate font-mono text-sm font-black text-zinc-900 dark:text-zinc-50">
                      📍 {selectedLocCode}
                    </h3>
                    {activeLocDetails.name && (
                      <p className="text-[11px] font-bold text-zinc-400">
                        ຊື່: {activeLocDetails.name}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLocCode(null);
                      setItemSearch("");
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-xs font-bold text-zinc-500 shadow-sm transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-zinc-150 bg-white p-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      ຄວາມຈຸ Location
                    </span>
                    <span className="font-mono text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                      {activeLocDetails.capacityPallets == null
                        ? "ບໍ່ມີຂະໜາດ"
                        : `${formatPallets(activeLocDetails.capacityPallets)} ພາເລດ`}
                    </span>
                  </div>
                  <div className="rounded-xl border border-zinc-150 bg-white p-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      ໃຊ້ຄວາມຈຸ
                    </span>
                    <span className="font-mono text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                      {activeLocDetails.utilizationPct == null
                        ? "—"
                        : `${activeLocDetails.utilizationPct.toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder="ຄົ້ນຫາ SKU ໃນ location..."
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-xs text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>

                <div className="space-y-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                    ລາຍການສິນຄ້າ ({filteredItems.length})
                  </span>

                  {filteredItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-xs text-zinc-400 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                      {openItems.length === 0 ? "ບໍ່ມີສິນຄ້າເກັບໄວ້" : "ບໍ່ພົບຕາມຄຳຄົ້ນຫາ"}
                    </div>
                  ) : (
                    <div className="custom-scrollbar max-h-[340px] space-y-2 overflow-y-auto pr-1">
                      {filteredItems.map((item, idx) => {
                        const sharePct =
                          activeLocDetails.usedPallets > 0
                            ? (item.usedPallets / activeLocDetails.usedPallets) * 100
                            : 0;
                        return (
                          <div
                            key={`${item.itemCode}-${idx}`}
                            className={`rounded-xl border bg-white p-3 transition-all duration-200 hover:border-emerald-500/50 hover:shadow-md dark:bg-zinc-900 ${
                              item.qty < 0
                                ? "border-red-200 dark:border-red-950/80"
                                : "border-zinc-150 dark:border-zinc-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
                                  {item.itemCode}
                                </div>
                                {item.itemName && (
                                  <div
                                    className="mt-0.5 max-w-[180px] truncate text-[10px] text-zinc-500"
                                    title={item.itemName}
                                  >
                                    {item.itemName}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <span
                                  className={`font-mono text-xs font-black ${
                                    item.qty < 0 ? "text-red-500" : "text-zinc-900 dark:text-zinc-50"
                                  }`}
                                >
                                  {formatQty(item.qty)}
                                </span>
                                {item.unitCode && (
                                  <span className="ml-1 text-[9px] font-semibold text-zinc-400">
                                    {item.unitCode}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2 text-[9px] font-semibold text-zinc-400 dark:border-zinc-800">
                              <span>
                                {item.palletQty
                                  ? `${formatQty(item.palletQty)} ${item.unitCode || "ໜ່ວຍ"}/ພາເລດ${item.stackQty ? ` · stack ${formatQty(item.stackQty)}` : ""}`
                                  : "ຈັບຄູ່ PH ບໍ່ໄດ້"}
                              </span>
                              <span>
                                {item.missingPh ? (
                                  <span className="text-amber-500">ບໍ່ມີ PH</span>
                                ) : (
                                  <span>
                                    {formatPallets(item.usedPallets)} ພາເລດ ({sharePct.toFixed(0)}%)
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="flex flex-wrap justify-between gap-3 text-xs font-semibold text-zinc-400">
            <span>
              {rack.occupiedLocations}/{rack.locations.length} locations active
            </span>
            {rack.missingPhQty > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                ⚠️ ມີ {formatQty(rack.missingPhQty)} ໜ່ວຍທີ່ຈັບຄູ່ PH ບໍ່ໄດ້
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// 2D elevation shelf location cell redesign with liquid fill animation
function LocationShelfSlot({
  location,
  selected,
  dimmed = false,
  onSelect,
}: {
  location: LocationView;
  selected: boolean;
  dimmed?: boolean;
  onSelect: () => void;
}) {
  const negative = location.qty < 0;
  const occupied = location.qty !== 0;
  const full =
    location.utilizationPct != null && location.utilizationPct >= 100;
  const nearlyFull =
    location.utilizationPct != null &&
    location.utilizationPct >= 80 &&
    location.utilizationPct < 100;

  const capacityLabel =
    location.capacityPallets == null
      ? "ຂາດຂະໜາດ"
      : `${formatPallets(location.capacityPallets)} ພາເລດ`;

  const utilizationLabel =
    location.utilizationPct == null
      ? "—"
      : `${location.utilizationPct.toFixed(0)}%`;

  // Define HSL visual variables according to status
  let themeClass = "";
  let fillBg = "";
  let indicatorDot = "";

  if (negative) {
    themeClass = "border-red-400 bg-red-500/5 text-red-950 dark:border-red-900/60 dark:text-red-400";
    fillBg = "bg-red-500/20 dark:bg-red-500/25";
    indicatorDot = "bg-red-500 animate-ping";
  } else if (full) {
    themeClass = "border-rose-400 bg-rose-500/5 text-rose-950 dark:border-rose-900/60 dark:text-rose-400";
    fillBg = "bg-rose-500/20 dark:bg-rose-500/25";
    indicatorDot = "bg-rose-500 animate-pulse";
  } else if (nearlyFull) {
    themeClass = "border-amber-400 bg-amber-500/5 text-amber-950 dark:border-amber-900/60 dark:text-amber-400";
    fillBg = "bg-amber-500/20 dark:bg-amber-500/25";
    indicatorDot = "bg-amber-500";
  } else if (occupied) {
    themeClass = "border-emerald-400 bg-emerald-500/5 text-emerald-950 dark:border-emerald-900/60 dark:text-emerald-400";
    fillBg = "bg-emerald-500/20 dark:bg-emerald-500/25";
    indicatorDot = "bg-emerald-500";
  } else {
    themeClass = "border-zinc-200 bg-zinc-50/5 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/20 dark:text-zinc-500";
    fillBg = "bg-zinc-100 dark:bg-zinc-900";
    indicatorDot = "bg-zinc-300 dark:bg-zinc-700";
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${location.code}${location.name ? ` — ${location.name}` : ""}\nຂະໜາດ: ${location.widthCm ?? "?"}×${location.lengthCm ?? "?"}×${location.heightCm ?? "?"} cm\nຄວາມຈຸ: ${capacityLabel}\nໃຊ້ແລ້ວ: ${formatPallets(location.usedPallets)} ພາເລດ (${utilizationLabel})\nQty: ${formatQty(location.qty)} · ${location.itemCount} SKU`}
      className={`group relative flex h-24 flex-col justify-between rounded-xl border p-2.5 text-left transition-all duration-300 ease-out focus:outline-none ${themeClass} ${
        selected
          ? "scale-[1.06] z-10 border-zinc-900 shadow-lg ring-2 ring-zinc-900/10 dark:border-white dark:ring-white/10"
          : dimmed
            ? "opacity-35 grayscale saturate-50 blur-[0.4px] hover:opacity-80 hover:grayscale-0 hover:blur-0"
            : "hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-sm"
      }`}
    >
      {/* Visual liquid volume fill indicator inside shelf cell */}
      {occupied && !negative && (
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-b-xl transition-all duration-700 ease-out -z-10 ${fillBg}`}
          style={{
            height: `${Math.min(100, Math.max(8, location.utilizationPct ?? 0))}%`,
          }}
        />
      )}

      {/* Grid cell Header */}
      <div className="flex items-start justify-between gap-1 w-full relative z-10">
        <span className="font-mono text-[10px] font-extrabold tracking-tight truncate leading-none">
          {location.name || location.code.split("-").pop() || location.code}
        </span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${indicatorDot}`} />
      </div>

      {/* Grid cell details */}
      <div className="space-y-0.5 relative z-10 leading-none">
        <div className="text-[8px] font-bold opacity-60 uppercase tracking-wider">
          ໃຊ້ຄວາມຈຸ
        </div>
        <div className="font-mono text-xs font-black tracking-tight">
          {utilizationLabel}
        </div>
      </div>

      {/* Mini footer */}
      <div className="flex items-center justify-between text-[8px] font-bold opacity-75 w-full relative z-10 leading-none">
        <span>{formatPallets(location.usedPallets)} ພາເລດ</span>
        <span>{occupied ? `${location.itemCount} SKU` : "ຫວ່າງ"}</span>
      </div>

      {/* PH matching warning */}
      {location.missingPhQty > 0 && (
        <span className="absolute left-1 top-1 bg-amber-500 text-white rounded-[3px] text-[6px] px-0.5 font-bold animate-pulse">
          DIMS?
        </span>
      )}
    </button>
  );
}

// Floating card shown over the 3D canvas when a location (ຫ້ອງ) is clicked.
// Shows the location's physical size, capacity/used volume, and its item list.
function Location3DPopup({
  loc,
  items,
  onClose,
}: {
  loc: LocationView;
  items: RackItemView[];
  onClose: () => void;
}) {
  const sizeLabel =
    loc.widthCm || loc.lengthCm || loc.heightCm
      ? `${loc.widthCm ?? "?"} × ${loc.lengthCm ?? "?"} × ${loc.heightCm ?? "?"} cm`
      : "ບໍ່ມີຂະໜາດ";
  const negative = loc.qty < 0;

  // The location is measured either by real volume (m³) or, when item
  // dimensions are missing, by pallet positions.
  const isVolume = loc.fillMode === "volume";
  const fmtM3 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const capValue = isVolume
    ? loc.capacityVolumeM3 != null
      ? fmtM3(loc.capacityVolumeM3)
      : "—"
    : loc.capacityPallets != null
      ? formatPallets(loc.capacityPallets)
      : "—";
  const usedValue = isVolume ? fmtM3(loc.usedVolumeM3) : formatPallets(loc.usedPallets);
  const unit = isVolume ? "m³" : "ພາເລດ";

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-[20rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-100 bg-gradient-to-r from-sky-500/10 to-transparent px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📍</span>
            <h3 className="truncate font-mono text-sm font-black text-zinc-900 dark:text-zinc-50">
              {loc.code}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                negative
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : loc.qty > 0
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {negative ? "ຕິດລົບ" : loc.qty > 0 ? "ມີສິນຄ້າ" : "ຫວ່າງ"}
            </span>
          </div>
          {loc.name && (
            <p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-400">{loc.name}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-xs font-bold text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      {/* Size + volume stats */}
      <div className="grid grid-cols-3 gap-px bg-zinc-100 dark:bg-zinc-800">
        <div className="bg-white px-2 py-2 dark:bg-slate-900">
          <div className="text-[8px] font-bold uppercase tracking-wider text-zinc-400">ຂະໜາດ</div>
          <div className="mt-0.5 text-[10px] font-bold leading-tight text-zinc-800 dark:text-zinc-100">
            {sizeLabel}
          </div>
        </div>
        <div className="bg-white px-2 py-2 dark:bg-slate-900">
          <div className="text-[8px] font-bold uppercase tracking-wider text-zinc-400">
            ຄວາມຈຸ ({isVolume ? "volume" : "pallet"})
          </div>
          <div className="mt-0.5 font-mono text-[11px] font-black text-zinc-800 dark:text-zinc-100">
            {capValue}
            <span className="ml-0.5 text-[8px] font-semibold text-zinc-400">{unit}</span>
          </div>
        </div>
        <div className="bg-white px-2 py-2 dark:bg-slate-900">
          <div className="text-[8px] font-bold uppercase tracking-wider text-zinc-400">ໃຊ້ແລ້ວ</div>
          <div className="mt-0.5 font-mono text-[11px] font-black text-zinc-800 dark:text-zinc-100">
            {usedValue}
            <span className="ml-0.5 text-[8px] font-semibold text-zinc-400">
              {unit}
              {loc.utilizationPct != null ? ` (${loc.utilizationPct.toFixed(0)}%)` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Item list */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          ລາຍການສິນຄ້າ
        </span>
        <span className="font-mono text-[10px] font-bold text-zinc-500">{items.length}</span>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-zinc-400">ບໍ່ມີສິນຄ້າເກັບໄວ້</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((item, idx) => (
              <div
                key={`${item.itemCode}-${idx}`}
                className={`rounded-lg border px-2.5 py-2 ${
                  item.qty < 0
                    ? "border-red-200 bg-red-50/50 dark:border-red-950/80 dark:bg-red-950/10"
                    : "border-zinc-150 bg-white dark:border-zinc-800 dark:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-bold text-zinc-900 dark:text-zinc-50">
                      {item.itemCode}
                    </div>
                    {item.itemName && (
                      <div className="mt-0.5 truncate text-[9px] text-zinc-500" title={item.itemName}>
                        {item.itemName}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={`font-mono text-[11px] font-black ${
                        item.qty < 0 ? "text-red-500" : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {formatQty(item.qty)}
                    </span>
                    {item.unitCode && (
                      <span className="ml-0.5 text-[8px] font-semibold text-zinc-400">
                        {item.unitCode}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between border-t border-zinc-100 pt-1 text-[8px] font-semibold text-zinc-400 dark:border-zinc-800">
                  <span>
                    {item.widthCm && item.lengthCm && item.heightCm
                      ? `${item.widthCm}×${item.lengthCm}×${item.heightCm} cm`
                      : item.palletQty
                        ? `${formatQty(item.palletQty)}/ພາເລດ${item.stackQty ? ` · stack ${formatQty(item.stackQty)}` : ""}`
                        : "ບໍ່ມີຂະໜາດ/PH"}
                  </span>
                  <span>
                    {item.usedVolumeM3 != null ? (
                      <span>{fmtM3(item.usedVolumeM3)} m³</span>
                    ) : item.missingPh ? (
                      <span className="text-amber-500">ບໍ່ມີຂະໜາດ</span>
                    ) : (
                      <span>{formatPallets(item.usedPallets)} ພາເລດ</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "emerald" | "blue" | "amber" | "red";
}) {
  const colors = {
    neutral: "bg-zinc-100 border border-zinc-200/50 text-zinc-900 dark:bg-zinc-950 dark:border-zinc-850 dark:text-zinc-100",
    emerald: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-300",
    blue: "bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-blue-300",
    amber: "bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-300",
    red: "bg-red-500/10 border border-red-500/20 text-red-850 dark:bg-red-950/20 dark:border-red-900/30 dark:text-red-400",
  };
  return (
    <div className={`rounded-xl px-3 py-2.5 transition duration-150 ${colors[tone]} shadow-sm`}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-450 dark:text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-black tracking-tight">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </div>
    </div>
  );
}
