"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, SearchIcon } from "@/components/ui/Icons";

export type WhOpt = { code: string; name: string | null };
export type RackOpt = { wh: string; code: string; name: string | null };
export type LocOpt = { wh: string; rack: string; code: string; name: string | null };

function optLabel(code: string, name: string | null) {
  return name ? `${code} · ${name}` : code;
}

export default function BalanceFilters({
  warehouses,
  racks,
  locations,
  initial,
  view,
  accessibleAll,
}: {
  warehouses: WhOpt[];
  racks: RackOpt[];
  locations: LocOpt[];
  initial: { wh: string; rack: string; location: string; q: string };
  view: string;
  accessibleAll: boolean;
}) {
  const router = useRouter();
  const [wh, setWh] = useState(initial.wh);
  const [rack, setRack] = useState(initial.rack);
  const [location, setLocation] = useState(initial.location);
  const [q, setQ] = useState(initial.q);

  // Cascade: racks belong to the chosen warehouse, locations to the chosen rack.
  const rackChoices = useMemo(
    () => (wh ? racks.filter((r) => r.wh === wh) : []),
    [racks, wh],
  );
  const locChoices = useMemo(
    () => (wh && rack ? locations.filter((l) => l.wh === wh && l.rack === rack) : []),
    [locations, wh, rack],
  );

  function buildQuery(): string {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (wh) sp.set("wh", wh);
    if (rack) sp.set("rack", rack);
    if (location) sp.set("location", location);
    if (view && view !== "tree") sp.set("view", view);
    return sp.toString();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = buildQuery();
    router.push(`/movements/balance${s ? `?${s}` : ""}`);
  }

  function clearAll() {
    setWh("");
    setRack("");
    setLocation("");
    setQ("");
    router.push(view === "tree" ? "/movements/balance" : `/movements/balance?view=${view}`);
  }

  const filtered = !!wh || !!rack || !!location || !!q.trim();

  // Export always mirrors the *live* selection in the form (not just the URL).
  const exportSp = new URLSearchParams();
  if (wh) exportSp.set("wh", wh);
  if (rack) exportSp.set("rack", rack);
  if (location) exportSp.set("location", location);
  if (q.trim()) exportSp.set("q", q.trim());
  const exportHref = `/api/movements/balance/export${exportSp.toString() ? `?${exportSp}` : ""}`;

  const selectCls =
    "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <form onSubmit={submit} className="mt-4 space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Warehouse */}
        <select
          value={wh}
          onChange={(e) => {
            setWh(e.target.value);
            setRack("");
            setLocation("");
          }}
          className={selectCls}
        >
          <option value="">{accessibleAll ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${warehouses.length})`}</option>
          {warehouses.map((w) => (
            <option key={w.code} value={w.code}>
              {optLabel(w.code, w.name)}
            </option>
          ))}
        </select>

        {/* Rack */}
        <select
          value={rack}
          disabled={!wh}
          onChange={(e) => {
            setRack(e.target.value);
            setLocation("");
          }}
          className={selectCls}
          title={!wh ? "ເລືອກສາງກ່ອນ" : undefined}
        >
          <option value="">{!wh ? "— ເລືອກສາງກ່ອນ —" : `ທຸກ Rack (${rackChoices.length})`}</option>
          {rackChoices.map((r) => (
            <option key={r.code} value={r.code}>
              {optLabel(r.code, r.name)}
            </option>
          ))}
        </select>

        {/* Location */}
        <select
          value={location}
          disabled={!rack}
          onChange={(e) => setLocation(e.target.value)}
          className={selectCls}
          title={!rack ? "ເລືອກ Rack ກ່ອນ" : undefined}
        >
          <option value="">{!rack ? "— ເລືອກ Rack ກ່ອນ —" : `ທຸກ Location (${locChoices.length})`}</option>
          {locChoices.map((l) => (
            <option key={l.code} value={l.code}>
              {optLabel(l.code, l.name)}
            </option>
          ))}
        </select>

        {/* Free-text search */}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ຄົ້ນຫາ ລະຫັດ/ຊື່ສິນຄ້າ ຫຼື pallet..."
            className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:shadow-lg"
        >
          ກອງ
        </button>
        {filtered && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          >
            ລ້າງ
          </button>
        )}
        <a
          href={exportHref}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-50 dark:bg-zinc-900 dark:text-emerald-400 dark:ring-emerald-900/50"
          title="ດຶງລາຍງານຄົງເຫຼືອອອກເປັນ Excel (ຕາມການກອງປັດຈຸບັນ)"
        >
          <ArrowDownIcon className="h-4 w-4" strokeWidth={2.5} />
          Excel
        </a>
      </div>
    </form>
  );
}
