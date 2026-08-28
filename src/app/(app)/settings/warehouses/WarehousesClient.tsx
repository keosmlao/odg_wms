"use client";

import { Fragment, useMemo, useState } from "react";
import type { Warehouse } from "@/app/api/admin/warehouses/route";
import type { SnFlag } from "@/lib/warehouseConfig";
import {
  WAREHOUSE_KINDS,
  WAREHOUSE_KIND_LABEL,
  type WarehouseKind,
} from "@/lib/warehouseKind";

// Client-safe menu metadata (no server import). Order matches the row chips.
const SN_MENUS: { key: SnFlag; label: string; full: string }[] = [
  { key: "receive", label: "ຮັບ", full: "ຮັບເຂົ້າ" },
  { key: "issue", label: "ຈ່າຍ", full: "ຈ່າຍອອກ (scan SN ຕອນຢືນຢັນ)" },
  { key: "issue_pick", label: "pick", full: "ຈ່າຍ: ບັງຄັບ SN ຕອນສ້າງໃບ pick (ປິດ = ໄປຍິງຕອນຢືນຢັນ)" },
  { key: "transfer", label: "ໂອນ", full: "ໂອນ (124)" },
  { key: "pallet", label: "pallet", full: "ຍ້າຍ pallet" },
  { key: "adjust", label: "ປັບ", full: "ປັບປຸງ" },
  { key: "return", label: "ຄືນ", full: "ຮັບຄືນຂາຍ" },
];

type FormState = {
  code: string;
  name_1: string;
  name_2: string;
  address: string;
  telephone: string;
  fax: string;
  branch_code: string;
  wh_manager: string;
  status: number;
  latitude: string;
  longitude: string;
  kind: WarehouseKind;
  /** ລະຫັດສາງແມ່ — ວ່າງ = ບໍ່ມີ (ໃຊ້ໄດ້ສະເພາະ kind = sub). */
  parent_code: string;
};

const EMPTY_FORM: FormState = {
  code: "",
  name_1: "",
  name_2: "",
  address: "",
  telephone: "",
  fax: "",
  branch_code: "",
  wh_manager: "",
  status: 1,
  latitude: "",
  longitude: "",
  kind: "main",
  parent_code: "",
};

function toForm(w: Warehouse): FormState {
  return {
    code: w.code,
    name_1: w.name_1 ?? "",
    name_2: w.name_2 ?? "",
    address: w.address ?? "",
    telephone: w.telephone ?? "",
    fax: w.fax ?? "",
    branch_code: w.branch_code ?? "",
    wh_manager: w.wh_manager ?? "",
    status: w.status ?? 1,
    latitude: w.latitude == null ? "" : String(w.latitude),
    longitude: w.longitude == null ? "" : String(w.longitude),
    kind: w.kind ?? "main",
    parent_code: w.parent_code ?? "",
  };
}

type Rack = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  is_active: number | null;
};
type Loc = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  location_id: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  floor: number | null;
  is_active: number | null;
};
/** ຂະໜາດຂັ້ນສາງ — ແຖວດຽວກັບຜັງໃນ /rack-visualization (odg_wms_layout_canvas). */
type Canvas = {
  width_cm: string | null;
  depth_cm: string | null;
  height_cm: string | null;
};
type Structure = {
  loading: boolean;
  error: string | null;
  racks: Rack[];
  locations: Loc[];
  canvas: Canvas | null;
};

// ລະຫັດ, ຊື່, ປະເພດ, ສາຂາ, ນາຍສາງ, ໂທ, ສະຖານະ, SN, ປຸ່ມ (+ checkbox ນອກ count)
const COL_COUNT = 10;

export default function WarehousesClient({
  initialWarehouses,
}: {
  initialWarehouses: Warehouse[];
}) {
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [kindFilter, setKindFilter] = useState<"all" | WarehouseKind>("all");
  const [editing, setEditing] = useState<
    | { mode: "create" }
    | { mode: "edit"; warehouse: Warehouse }
    | null
  >(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (statusFilter === "active" && w.status !== 1) return false;
      if (statusFilter === "inactive" && w.status === 1) return false;
      if (kindFilter !== "all" && (w.kind ?? "main") !== kindFilter) return false;
      if (!q) return true;
      return (
        w.code.toLowerCase().includes(q) ||
        (w.name_1 ?? "").toLowerCase().includes(q) ||
        (w.name_2 ?? "").toLowerCase().includes(q) ||
        (w.address ?? "").toLowerCase().includes(q) ||
        // ຄົ້ນດ້ວຍລະຫັດສາງແມ່ ຈຶ່ງພິມ "1101" ແລ້ວເຫັນລູກຂອງມັນທັງໝົດ
        (w.parent_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [warehouses, search, statusFilter, kindFilter]);

  const counts = useMemo(() => {
    const active = warehouses.filter((w) => w.status === 1).length;
    const sub = warehouses.filter((w) => (w.kind ?? "main") === "sub").length;
    return {
      active,
      inactive: warehouses.length - active,
      sub,
      main: warehouses.length - sub,
    };
  }, [warehouses]);

  /** ຊື່ສາງຕາມລະຫັດ — ໃຊ້ສະແດງສາງແມ່ໃນຕາຕະລາງ. */
  const nameByCode = useMemo(
    () => new Map(warehouses.map((w) => [w.code, w.name_1 ?? ""])),
    [warehouses],
  );

  function handleSaved(updated: Warehouse, mode: "create" | "edit") {
    if (mode === "create") {
      setWarehouses((prev) =>
        [...prev, updated].sort((a, b) => a.code.localeCompare(b.code)),
      );
    } else {
      setWarehouses((prev) =>
        prev.map((w) => (w.code === updated.code ? updated : w)),
      );
    }
    setEditing(null);
  }

  function handleDeleted(code: string) {
    setWarehouses((prev) => prev.filter((w) => w.code !== code));
    setDeleting(null);
  }

  const [snSaving, setSnSaving] = useState<string | null>(null); // `${code}:${flag}`
  const [snError, setSnError] = useState<string | null>(null);

  // Flip one SN menu flag for one warehouse (optimistic).
  async function toggleSnFlag(code: string, flag: SnFlag, next: boolean) {
    const key = `${code}:${flag}`;
    setSnError(null);
    setSnSaving(key);
    setWarehouses((prev) =>
      prev.map((w) => (w.code === code ? { ...w, sn: { ...w.sn, [flag]: next } } : w)),
    );
    try {
      const res = await fetch(`/api/admin/warehouses/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag, value: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
    } catch (e) {
      setWarehouses((prev) =>
        prev.map((w) => (w.code === code ? { ...w, sn: { ...w.sn, [flag]: !next } } : w)),
      );
      setSnError(`${code}: ${e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ"}`);
    } finally {
      setSnSaving(null);
    }
  }

  // ── Lazy structure (racks + locations) per warehouse ──────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [structure, setStructure] = useState<Record<string, Structure>>({});

  async function toggleExpand(code: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
    if (structure[code]) return; // cached
    setStructure((s) => ({
      ...s,
      [code]: { loading: true, error: null, racks: [], locations: [], canvas: null },
    }));
    try {
      const res = await fetch(
        `/api/settings/warehouse-structure?wh=${encodeURIComponent(code)}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        racks?: Rack[];
        locations?: Loc[];
        canvas?: Canvas | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "ໂຫຼດໂຄງສ້າງບໍ່ສຳເລັດ");
      setStructure((s) => ({
        ...s,
        [code]: {
          loading: false,
          error: null,
          racks: data.racks ?? [],
          locations: data.locations ?? [],
          canvas: data.canvas ?? null,
        },
      }));
    } catch (e) {
      setStructure((s) => ({
        ...s,
        [code]: {
          loading: false,
          error: e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ",
          racks: [],
          locations: [],
          canvas: null,
        },
      }));
    }
  }

  // ── Multi-select + bulk per-menu SN toggle ────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMenu, setBulkMenu] = useState<SnFlag>("pallet");
  const allFilteredSelected = filtered.length > 0 && filtered.every((w) => selected.has(w.code));

  function toggleSelect(code: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) =>
      allFilteredSelected ? new Set() : new Set(filtered.map((w) => w.code)),
    );
  }

  // Set one SN menu flag for many warehouses at once (all, or the selection).
  async function bulkSetSn(target: "all" | "selected", value: boolean) {
    const codes = target === "all" ? warehouses.map((w) => w.code) : [...selected];
    if (codes.length === 0) return;
    const flag = bulkMenu;
    setSnError(null);
    setBulkSaving(true);
    const codeSet = new Set(codes);
    const prev = warehouses;
    setWarehouses((ws) =>
      ws.map((w) => (codeSet.has(w.code) ? { ...w, sn: { ...w.sn, [flag]: value } } : w)),
    );
    try {
      const res = await fetch(`/api/admin/warehouses`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target === "all" ? { all: true, flag, value } : { codes, flag, value },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      if (target === "selected") setSelected(new Set());
    } catch (e) {
      setWarehouses(prev); // revert
      setSnError(e instanceof Error ? e.message : "ຕັ້ງຄ່າ SN ບໍ່ສຳເລັດ");
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ຄົ້ນຫາລະຫັດ, ຊື່, ທີ່ຢູ່..."
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "active" | "inactive")
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="all">ທັງໝົດ ({warehouses.length})</option>
          <option value="active">ໃຊ້ງານ ({counts.active})</option>
          <option value="inactive">ປິດໃຊ້ງານ ({counts.inactive})</option>
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | WarehouseKind)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="all">ທຸກປະເພດ ({warehouses.length})</option>
          <option value="main">ສາງຫຼັກ ({counts.main})</option>
          <option value="sub">ສາງຍ່ອຍ ({counts.sub})</option>
        </select>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ສະແດງ {filtered.length} / {warehouses.length}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setEditing({ mode: "create" })}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + ເພີ່ມສາງ
          </button>
        </div>
      </div>

      {/* Bulk SN control — set one menu's SN flag for all warehouses or the selection. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          ຕັ້ງ SN ເມນູ:
        </span>
        <select
          value={bulkMenu}
          onChange={(e) => setBulkMenu(e.target.value as SnFlag)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {SN_MENUS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.full}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">ທັງໝົດ</span>
        <button
          type="button"
          disabled={bulkSaving}
          onClick={() => bulkSetSn("all", true)}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          ເປີດ
        </button>
        <button
          type="button"
          disabled={bulkSaving}
          onClick={() => bulkSetSn("all", false)}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          ປິດ
        </button>

        <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />

        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          ທີ່ເລືອກ ({selected.size})
        </span>
        <button
          type="button"
          disabled={bulkSaving || selected.size === 0}
          onClick={() => bulkSetSn("selected", true)}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          ເປີດ
        </button>
        <button
          type="button"
          disabled={bulkSaving || selected.size === 0}
          onClick={() => bulkSetSn("selected", false)}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          ປິດ
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11px] text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            ລ້າງ
          </button>
        )}
        {bulkSaving && (
          <span className="text-[11px] text-zinc-400">ກຳລັງບັນທຶກ...</span>
        )}
      </div>

      {snError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {snError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="ເລືອກທັງໝົດ"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
                  />
                </th>
                <th className="w-8 px-1 py-2" />
                <th className="px-4 py-2 font-medium">ລະຫັດ</th>
                <th className="px-4 py-2 font-medium">ຊື່ສາງ</th>
                <th className="px-4 py-2 font-medium" title="ສາງຫຼັກ = ຢືນດ້ວຍຕົນເອງ, ສາງຍ່ອຍ = ຂຶ້ນກັບສາງຫຼັກໜຶ່ງ">
                  ປະເພດ
                </th>
                <th className="px-4 py-2 font-medium">ສາຂາ</th>
                <th className="px-4 py-2 font-medium">ນາຍສາງ</th>
                <th className="px-4 py-2 font-medium">ໂທ</th>
                <th className="px-4 py-2 font-medium">ສະຖານະ</th>
                <th className="px-4 py-2 font-medium" title="ຕັ້ງ SN ເປີດ/ປິດ ຕໍ່ເມນູ (ຮັບ/ຈ່າຍ/ໂອນ/pallet/ປັບ/ຄືນ)">
                  SN ຕໍ່ເມນູ
                </th>
                <th className="px-4 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={COL_COUNT + 1}
                    className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                  >
                    ບໍ່ພົບສາງ
                  </td>
                </tr>
              )}
              {filtered.map((w) => {
                const isOpen = expanded.has(w.code);
                const st = structure[w.code];
                return (
                <Fragment key={w.code}>
                <tr className="border-t border-zinc-100 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`ເລືອກ ${w.code}`}
                      checked={selected.has(w.code)}
                      onChange={() => toggleSelect(w.code)}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
                    />
                  </td>
                  <td className="px-1 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(w.code)}
                      aria-expanded={isOpen}
                      aria-label="ຂະຫຍາຍ rack / location"
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{w.name_1 ?? "—"}</div>
                    {w.name_2 && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {w.name_2}
                      </div>
                    )}
                    {w.address && (
                      <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {w.address}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(w.kind ?? "main") === "sub" ? (
                      <>
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          ສາງຍ່ອຍ
                        </span>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          ↳ {w.parent_code ?? "—"}
                          {w.parent_code && nameByCode.get(w.parent_code)
                            ? ` ${nameByCode.get(w.parent_code)}`
                            : ""}
                        </div>
                      </>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        ສາງຫຼັກ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{w.branch_code ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{w.wh_manager ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{w.telephone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {w.status === 1 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        ໃຊ້ງານ
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        ປິດ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {SN_MENUS.map((m) => {
                        const on = w.sn[m.key] !== false;
                        const busy = snSaving === `${w.code}:${m.key}`;
                        return (
                          <button
                            key={m.key}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            disabled={busy}
                            onClick={() => toggleSnFlag(w.code, m.key, !on)}
                            title={`${m.full}: SN ${on ? "ເປີດ (ຄລິກເພື່ອປິດ)" : "ປິດ (ຄລິກເພື່ອເປີດ)"}`}
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 transition disabled:opacity-50 ${
                              on
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"
                                : "bg-zinc-100 text-zinc-400 ring-zinc-200 line-through hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700"
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing({ mode: "edit", warehouse: w })}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        ແກ້ໄຂ
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(w)}
                        className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        ລຶບ
                      </button>
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td
                      colSpan={COL_COUNT + 1}
                      className="bg-zinc-50/60 px-4 py-3 dark:bg-zinc-900/40"
                    >
                      <WarehouseStructure
                        whCode={w.code}
                        st={st}
                        update={(fn) =>
                          setStructure((prev) =>
                            prev[w.code] ? { ...prev, [w.code]: fn(prev[w.code]) } : prev,
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDrawer
          mode={editing.mode}
          warehouses={warehouses}
          initial={editing.mode === "edit" ? toForm(editing.warehouse) : EMPTY_FORM}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <DeleteConfirm
          warehouse={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}

function EditDrawer({
  mode,
  warehouses,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  /** ໃຊ້ເປັນຕົວເລືອກ "ສາງແມ່" — ສະເພາະສາງຫຼັກ ແລະ ບໍ່ແມ່ນຕົນເອງ. */
  warehouses: Warehouse[];
  initial: FormState;
  onClose: () => void;
  onSaved: (w: Warehouse, mode: "create" | "edit") => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /**
   * ສາງແມ່ທີ່ເລືອກໄດ້ — ສະເພາະ **ສາງຫຼັກ** ແລະ ບໍ່ແມ່ນຕົນເອງ (ຊັ້ນດຽວ, ບໍ່ວົນ).
   * ຖ້າແມ່ປັດຈຸບັນຫຼຸດອອກຈາກລາຍການ (ຂໍ້ມູນເກົ່າ) ຍັງໃສ່ໄວ້ ເພື່ອບໍ່ໃຫ້ຄ່າຫາຍງຽບໆ.
   */
  const parentChoices = useMemo(() => {
    const list: { code: string; name_1: string | null }[] = warehouses
      .filter((w) => w.code !== form.code && (w.kind ?? "main") === "main")
      .map((w) => ({ code: w.code, name_1: w.name_1 }));
    const cur = form.parent_code.trim();
    if (cur && !list.some((w) => w.code === cur)) {
      const found = warehouses.find((w) => w.code === cur);
      list.unshift({ code: cur, name_1: found?.name_1 ?? null });
    }
    return list;
  }, [warehouses, form.code, form.parent_code]);

  async function handleSave() {
    setSaving(true);
    setError(null);

    if (!form.code.trim()) {
      setError("ກະລຸນາປ້ອນລະຫັດສາງ");
      setSaving(false);
      return;
    }
    if (form.kind === "sub" && !form.parent_code.trim()) {
      setError("ສາງຍ່ອຍ ຕ້ອງເລືອກສາງແມ່");
      setSaving(false);
      return;
    }

    const url =
      mode === "create"
        ? "/api/admin/warehouses"
        : `/api/admin/warehouses/${encodeURIComponent(form.code)}`;
    const method = mode === "create" ? "POST" : "PUT";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name_1: form.name_1.trim() || null,
          name_2: form.name_2.trim() || null,
          address: form.address.trim() || null,
          telephone: form.telephone.trim() || null,
          fax: form.fax.trim() || null,
          branch_code: form.branch_code.trim() || null,
          wh_manager: form.wh_manager.trim() || null,
          status: form.status,
          latitude: form.latitude.trim() || null,
          longitude: form.longitude.trim() || null,
          kind: form.kind,
          parent_code: form.kind === "sub" ? form.parent_code.trim() || null : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        warehouse?: Warehouse;
      };
      if (!res.ok || !data.ok || !data.warehouse) {
        setError(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
        return;
      }
      onSaved(data.warehouse, mode);
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "create" ? "ເພີ່ມສາງໃໝ່" : `ແກ້ໄຂສາງ ${form.code}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <Label>ລະຫັດສາງ *</Label>
            <Input
              value={form.code}
              onChange={(v) => update("code", v)}
              disabled={mode === "edit"}
              placeholder="ເຊັ່ນ 1101"
            />
            {mode === "edit" && (
              <p className="mt-1 text-xs text-zinc-500">ບໍ່ສາມາດປ່ຽນລະຫັດໄດ້</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={form.kind === "sub" ? "" : "col-span-2"}>
              <Label>ປະເພດສາງ *</Label>
              <select
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as WarehouseKind;
                  update("kind", kind);
                  // ຍົກກັບເປັນສາງຫຼັກ = ບໍ່ມີແມ່ອີກ — ລ້າງໄວ້ ບໍ່ດັ່ງນັ້ນຄ່າເກົ່າຈະຖືກສົ່ງໄປ
                  if (kind === "main") update("parent_code", "");
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {WAREHOUSE_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            {form.kind === "sub" && (
              <div>
                <Label>ຂຶ້ນກັບສາງຫຼັກ *</Label>
                <select
                  value={form.parent_code}
                  onChange={(e) => update("parent_code", e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="">— ເລືອກສາງແມ່ —</option>
                  {parentChoices.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} {w.name_1 ?? ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="col-span-2 -mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {form.kind === "sub"
                ? WAREHOUSE_KINDS[1].hint
                : WAREHOUSE_KINDS[0].hint}
            </p>

            <div className="col-span-2">
              <Label>ຊື່ສາງ (ລາວ)</Label>
              <Input value={form.name_1} onChange={(v) => update("name_1", v)} />
            </div>
            <div className="col-span-2">
              <Label>ຊື່ສາງ (ອັງກິດ/ຊື່ສຳຮອງ)</Label>
              <Input value={form.name_2} onChange={(v) => update("name_2", v)} />
            </div>
            <div className="col-span-2">
              <Label>ທີ່ຢູ່</Label>
              <Input value={form.address} onChange={(v) => update("address", v)} />
            </div>
            <div>
              <Label>ໂທລະສັບ</Label>
              <Input
                value={form.telephone}
                onChange={(v) => update("telephone", v)}
              />
            </div>
            <div>
              <Label>ແຟັກ</Label>
              <Input value={form.fax} onChange={(v) => update("fax", v)} />
            </div>
            <div>
              <Label>ລະຫັດສາຂາ</Label>
              <Input
                value={form.branch_code}
                onChange={(v) => update("branch_code", v)}
              />
            </div>
            <div>
              <Label>ນາຍສາງ (employee_code)</Label>
              <Input
                value={form.wh_manager}
                onChange={(v) => update("wh_manager", v)}
              />
            </div>
            <div>
              <Label>Latitude</Label>
              <Input
                value={form.latitude}
                onChange={(v) => update("latitude", v)}
                placeholder="0.0"
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                value={form.longitude}
                onChange={(v) => update("longitude", v)}
                placeholder="0.0"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={form.status === 1}
              onChange={(e) => update("status", e.target.checked ? 1 : 0)}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
            />
            ໃຊ້ງານ
          </label>

          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
            ຕັ້ງຄ່າ SN ຕໍ່ເມນູ (ຮັບ / ຈ່າຍ / ໂອນ / pallet / ປັບ / ຄືນ) ໄດ້ຢູ່ຄໍລຳ “SN ຕໍ່ເມນູ” ໃນຕາຕະລາງລາຍການສາງ.
          </p>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  warehouse,
  onClose,
  onDeleted,
}: {
  warehouse: Warehouse;
  onClose: () => void;
  onDeleted: (code: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/warehouses/${encodeURIComponent(warehouse.code)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "ລຶບບໍ່ສຳເລັດ");
        return;
      }
      onDeleted(warehouse.code);
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          ຢືນຢັນການລຶບ
        </h3>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          ຕ້ອງການລຶບສາງ <span className="font-mono font-semibold">{warehouse.code}</span>
          {warehouse.name_1 && ` (${warehouse.name_1})`} ບໍ?
        </p>
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          ຖ້າມີຂໍ້ມູນອື່ນອ້າງອີງສາງນີ້ ການລຶບຈະຖືກປະຕິເສດ — ໃຫ້ປິດໃຊ້ງານແທນ.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? "ກຳລັງລຶບ..." : "ລຶບ"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lazily-loaded rack / location tree for one expanded warehouse.
// ຂະໜາດ (ຊມ.) ແກ້ໄດ້ຄົບ 3 ຂັ້ນ ໃນນີ້: ສາງ → rack → location (migration 037).
function WarehouseStructure({
  whCode,
  st,
  update,
}: {
  whCode: string;
  st: Structure | undefined;
  update: (fn: (s: Structure) => Structure) => void;
}) {
  if (!st || st.loading) {
    return <p className="py-1 text-xs text-zinc-500 dark:text-zinc-400">ກຳລັງໂຫຼດ rack / location...</p>;
  }
  if (st.error) {
    return <p className="py-1 text-xs text-red-600 dark:text-red-400">{st.error}</p>;
  }

  const locByRack = new Map<string, Loc[]>();
  for (const l of st.locations) {
    const k = l.location_id ?? "";
    const arr = locByRack.get(k) ?? [];
    arr.push(l);
    locByRack.set(k, arr);
  }
  const rackCodes = new Set(st.racks.map((r) => r.code));
  const orphan = st.locations.filter((l) => !rackCodes.has(l.location_id));

  return (
    <div className="space-y-2">
      {/* ຂັ້ນ 1 — ຂະໜາດອາຄານສາງ */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ຂະໜາດສາງ</span>
        <DimEditor
          level="warehouse"
          wh={whCode}
          width={st.canvas?.width_cm ?? null}
          length={st.canvas?.depth_cm ?? null}
          height={st.canvas?.height_cm ?? null}
          onSaved={(d) =>
            update((s) => ({
              ...s,
              canvas: { width_cm: d.width, depth_cm: d.length, height_cm: d.height },
            }))
          }
        />
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          ພື້ນສາງໃຊ້ແຖວດຽວກັບຜັງໃນໜ້າ rack-visualization
        </span>
      </div>

      {st.racks.length === 0 && st.locations.length === 0 ? (
        <p className="py-1 text-xs text-zinc-500 dark:text-zinc-400">ສາງນີ້ຍັງບໍ່ມີ rack / location</p>
      ) : (
        <>
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {st.racks.length} rack · {st.locations.length} location
          </div>
          {st.racks.map((r) => {
            const locs = locByRack.get(r.code ?? "") ?? [];
            return (
              <details key={r.roworder} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50">
                  <span className="text-zinc-400">▸</span>
                  <span className="font-mono text-xs font-semibold">{r.code ?? "-"}</span>
                  <span className="text-sm text-zinc-700 dark:text-zinc-200">{r.name_1 ?? "-"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      r.is_active === 1
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {r.is_active === 1 ? "ເປີດ" : "ປິດ"}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
                    <DimText w={r.width} l={r.length} h={r.height} />
                    <span>{locs.length} location</span>
                  </span>
                </summary>

                <div className="space-y-2 px-3 pb-3 pt-1">
                  {/* ຂັ້ນ 2 — ຂະໜາດ rack */}
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/40">
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ຂະໜາດ rack</span>
                    <DimEditor
                      level="rack"
                      wh={whCode}
                      roworder={r.roworder}
                      width={r.width}
                      length={r.length}
                      height={r.height}
                      onSaved={(d) =>
                        update((s) => ({
                          ...s,
                          racks: s.racks.map((x) =>
                            x.roworder === r.roworder
                              ? { ...x, width: d.width, length: d.length, height: d.height }
                              : x,
                          ),
                        }))
                      }
                    />
                  </div>

                  {locs.length > 0 && (
                    <BulkLocationDims wh={whCode} rack={r} locs={locs} update={update} />
                  )}

                  {/* ຂັ້ນ 3 — ຂະໜາດແຕ່ລະ location */}
                  {locs.length > 0 && (
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      {locs.map((l) => (
                        <div
                          key={l.roworder}
                          className="rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
                        >
                          <div className="flex items-baseline gap-1.5">
                            <span className="truncate font-mono text-[11px] font-semibold">{l.code ?? "-"}</span>
                            {l.floor != null && (
                              <span className="text-[10px] text-zinc-400">floor {l.floor}</span>
                            )}
                          </div>
                          {l.name_1 && (
                            <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{l.name_1}</div>
                          )}
                          <div className="mt-1">
                            <DimEditor
                              level="location"
                              wh={whCode}
                              roworder={l.roworder}
                              width={l.width}
                              length={l.length}
                              height={l.height}
                              onSaved={(d) =>
                                update((s) => ({
                                  ...s,
                                  locations: s.locations.map((x) =>
                                    x.roworder === l.roworder
                                      ? { ...x, width: d.width, length: d.length, height: d.height }
                                      : x,
                                  ),
                                }))
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
          {orphan.length > 0 && (
            <div className="text-[11px] text-zinc-400">+ {orphan.length} location ບໍ່ໄດ້ຜູກ rack</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ໃສ່ຂະໜາດດຽວກັນໃຫ້ທຸກ location ໃນ rack — ບ່ອນເກັບໃນ rack ດຽວກັນມັກເທົ່າກັນ
 * ຈຶ່ງບໍ່ຄວນໃຫ້ພິມເທື່ອລະຊ່ອງ. "ທັບທັງໝົດ" ຖາມຢືນຢັນກ່ອນ ເພາະລົບຄ່າທີ່ວັດມາແລ້ວ.
 */
function BulkLocationDims({
  wh,
  rack,
  locs,
  update,
}: {
  wh: string;
  rack: Rack;
  locs: Loc[];
  update: (fn: (s: Structure) => Structure) => void;
}) {
  const [w, setW] = useState("");
  const [l, setL] = useState("");
  const [h, setH] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  const incomplete = locs.filter((x) => !x.width || !x.length || !x.height).length;
  const ready = Number.parseFloat(w) > 0 && Number.parseFloat(l) > 0;

  async function apply(mode: "empty" | "all") {
    if (mode === "all" && !confirm(`ທັບຂະໜາດ ${locs.length} location ໃນ rack ${rack.code ?? "-"} ທັງໝົດ?\nຄ່າທີ່ວັດໄວ້ແລ້ວຈະຖືກແທນທີ່.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/warehouse-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "rack-locations",
          wh,
          roworder: rack.roworder,
          mode,
          width: w.trim(),
          length: l.trim(),
          height: h.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; updated?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      const next = { width: w.trim() || null, length: l.trim() || null, height: h.trim() || null };
      const codes = new Set(
        locs.filter((x) => mode === "all" || !x.width || !x.length || !x.height).map((x) => x.roworder),
      );
      update((s) => ({
        ...s,
        locations: s.locations.map((x) => (codes.has(x.roworder) ? { ...x, ...next } : x)),
      }));
      setMsg({ k: "ok", t: `ໃສ່ໃຫ້ ${data.updated ?? 0} location ແລ້ວ` });
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-zinc-300 px-2 py-1.5 dark:border-zinc-700">
      <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ໃສ່ໃຫ້ທຸກ location</span>
      <DimInput value={w} onChange={setW} label="ຄວາມກ້ວງ (ຊມ.)" placeholder="ກ້ວງ" onEnter={() => ready && apply("empty")} />
      <span className="text-[10px] text-zinc-400">×</span>
      <DimInput value={l} onChange={setL} label="ຄວາມເລິກ (ຊມ.)" placeholder="ເລິກ" onEnter={() => ready && apply("empty")} />
      <span className="text-[10px] text-zinc-400">×</span>
      <DimInput value={h} onChange={setH} label="ຄວາມສູງ (ຊມ.)" placeholder="ສູງ" onEnter={() => ready && apply("empty")} />
      <span className="text-[10px] text-zinc-400">ຊມ.</span>
      <button
        type="button"
        disabled={busy || !ready || incomplete === 0}
        onClick={() => apply("empty")}
        title="ໃສ່ສະເພາະ location ທີ່ຂະໜາດຍັງບໍ່ຄົບ"
        className="rounded-md border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        ສະເພາະທີ່ຍັງບໍ່ຄົບ ({incomplete})
      </button>
      <button
        type="button"
        disabled={busy || !ready || locs.length === 0}
        onClick={() => apply("all")}
        title="ທັບຂະໜາດທຸກ location ໃນ rack ນີ້"
        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        ທັບທັງໝົດ ({locs.length})
      </button>
      {busy && <span className="text-[10px] text-zinc-400">ກຳລັງບັນທຶກ...</span>}
      {msg && (
        <span className={`text-[10px] font-semibold ${msg.k === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
          {msg.t}
        </span>
      )}
    </div>
  );
}

/** ຂະໜາດແບບອ່ານຢ່າງດຽວ (ຫົວ rack) — ບໍ່ມີຄ່າເລີຍ = ບໍ່ສະແດງຫຍັງ. */
function DimText({ w, l, h }: { w: string | null; l: string | null; h: string | null }) {
  const size = [w, l, h].map(dimStr).filter(Boolean).join("×");
  if (!size) return null;
  return <span className="tabular-nums">{size} ຊມ.</span>;
}

/** numeric ຂອງ PG ("450.00") → ຂໍ້ຄວາມສັ້ນສຳລັບຊ່ອງປ້ອນ. */
function dimStr(v: string | null): string {
  if (v == null || v === "") return "";
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? String(n) : "";
}

type DimValues = { width: string | null; length: string | null; height: string | null };

/**
 * ຊ່ອງປ້ອນຂະໜາດ ກ້ວງ × ເລິກ × ສູງ (ຊມ.) ໃຊ້ຮ່ວມກັນທັງ 3 ຂັ້ນ.
 * ປຸ່ມບັນທຶກຂຶ້ນມາເມື່ອມີການປ່ຽນເທົ່ານັ້ນ — ກົດ Enter ກໍ່ບັນທຶກໄດ້.
 * ຄ່າຫວ່າງ = ລຶບຂະໜາດ (ກັບໄປ "ບໍ່ໄດ້ວັດ").
 */
function DimEditor({
  level,
  wh,
  roworder,
  width,
  length,
  height,
  onSaved,
}: {
  level: "warehouse" | "rack" | "location";
  wh: string;
  roworder?: number;
  width: string | null;
  length: string | null;
  height: string | null;
  onSaved: (d: DimValues) => void;
}) {
  const [w, setW] = useState(() => dimStr(width));
  const [l, setL] = useState(() => dimStr(length));
  const [h, setH] = useState(() => dimStr(height));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const dirty = w !== dimStr(width) || l !== dimStr(length) || h !== dimStr(height);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/settings/warehouse-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          wh,
          roworder,
          width: w.trim(),
          length: l.trim(),
          height: h.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      onSaved({ width: w.trim() || null, length: l.trim() || null, height: h.trim() || null });
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DimInput value={w} onChange={setW} label="ຄວາມກ້ວງ (ຊມ.)" placeholder="ກ້ວງ" onEnter={save} />
      <span className="text-[10px] text-zinc-400">×</span>
      <DimInput value={l} onChange={setL} label="ຄວາມເລິກ (ຊມ.)" placeholder="ເລິກ" onEnter={save} />
      <span className="text-[10px] text-zinc-400">×</span>
      <DimInput value={h} onChange={setH} label="ຄວາມສູງ (ຊມ.)" placeholder="ສູງ" onEnter={save} />
      <span className="text-[10px] text-zinc-400">ຊມ.</span>
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {saving ? "..." : "ບັນທຶກ"}
        </button>
      )}
      {ok && !dirty && <span className="text-[10px] font-semibold text-emerald-600">✓</span>}
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}

function DimInput({
  value,
  onChange,
  label,
  placeholder,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
  onEnter: () => void;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      title={label}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
    />
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-800"
    />
  );
}
