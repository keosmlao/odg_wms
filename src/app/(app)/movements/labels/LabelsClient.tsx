"use client";

import { useEffect, useMemo, useState } from "react";
import Barcode from "@/components/Barcode";
import { SearchIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };
type Pallet = { code: string; name: string | null; location: string | null; rack: string | null };
type Bin = { code: string; name: string | null; rack_code: string | null };
type Kind = "pallet" | "bin";

type Label = { code: string; line1: string; line2: string };

export default function LabelsClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [kind, setKind] = useState<Kind>("pallet");
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!wh) { setPallets([]); setBins([]); setSelected(new Set()); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(wh)}`);
        const data = (await res.json()) as { pallets?: Pallet[]; locations?: Bin[] };
        if (!cancelled) { setPallets(data.pallets ?? []); setBins(data.locations ?? []); setSelected(new Set()); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wh]);

  useEffect(() => { setSelected(new Set()); }, [kind]);

  const labels = useMemo<Label[]>(() => {
    const ql = q.trim().toLowerCase();
    const src: Label[] = kind === "pallet"
      ? pallets.map((p) => ({ code: p.code, line1: p.name ?? "Pallet", line2: [p.rack, p.location].filter(Boolean).join(" / ") || "(ສาง)" }))
      : bins.map((b) => ({ code: b.code, line1: b.name ?? "Location", line2: b.rack_code ? `Rack ${b.rack_code}` : "" }));
    return ql ? src.filter((l) => l.code.toLowerCase().includes(ql) || l.line1.toLowerCase().includes(ql)) : src;
  }, [kind, pallets, bins, q]);

  const allSelected = labels.length > 0 && labels.every((l) => selected.has(l.code));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(labels.map((l) => l.code)));
  }
  function toggle(code: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  }

  const toPrint = useMemo(() => labels.filter((l) => selected.has(l.code)), [labels, selected]);
  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-violet-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດ label</label>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {([["pallet", "Pallet"], ["bin", "Location"]] as [Kind, string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${kind === k ? "bg-white text-violet-600 shadow-sm dark:bg-zinc-950 dark:text-violet-400" : "text-zinc-500"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຄົ້ນຫາ</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ລະຫັດ / ຊື່..." className={`${inputCls} w-full pl-8`} />
            </div>
          </div>
          <button type="button" onClick={toggleAll} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
            {allSelected ? "ຍົກເລີກໝົດ" : "ເລືອກໝົດ"}
          </button>
          <button type="button" onClick={() => window.print()} disabled={toPrint.length === 0} className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
            🖨 ພິມ {toPrint.length > 0 ? `(${toPrint.length})` : ""}
          </button>
        </div>
        {loading && <p className="mt-2 text-xs text-zinc-400">ກຳລັງໂຫຼດ...</p>}
        {!loading && wh && <p className="mt-2 text-[11px] text-zinc-500">{labels.length} {kind === "pallet" ? "pallet" : "location"} · ເລືອກ {selected.size} ໃບເພື່ອພິມ</p>}
      </section>

      {/* On-screen grid (selectable). Hidden when printing. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:hidden">
        {labels.map((l) => {
          const on = selected.has(l.code);
          return (
            <button key={l.code} type="button" onClick={() => toggle(l.code)}
              className={`rounded-xl border-2 bg-white p-3 text-left transition dark:bg-zinc-900 ${on ? "border-violet-500 ring-2 ring-violet-200 dark:ring-violet-900/50" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-100">{l.code}</span>
                <span className={`flex h-4 w-4 items-center justify-center rounded text-[10px] ${on ? "bg-violet-500 text-white" : "bg-zinc-100 text-transparent dark:bg-zinc-800"}`}>✓</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-zinc-500" title={l.line1}>{l.line1}</div>
              <div className="mt-2"><Barcode value={l.code} height={36} /></div>
              <div className="mt-1 text-[10px] text-zinc-400">{l.line2}</div>
            </button>
          );
        })}
        {!loading && labels.length === 0 && wh && <div className="col-span-full py-10 text-center text-sm text-zinc-400">ບໍ່ພົບ</div>}
        {!wh && <div className="col-span-full py-10 text-center text-sm text-zinc-400">ເລືອກສາງເພື່ອเริ่ม</div>}
      </div>

      {/* Print sheet — only visible when printing (print-sheet isolates it from app chrome). */}
      <div className="print-sheet hidden print:grid print:grid-cols-3 print:gap-2">
        {toPrint.map((l) => (
          <div key={l.code} className="break-inside-avoid rounded border border-black p-2 text-black">
            <div className="text-center font-mono text-base font-bold">{l.code}</div>
            <div className="truncate text-center text-[10px]">{l.line1}</div>
            <Barcode value={l.code} height={48} />
            <div className="text-center text-[9px]">{l.line2}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
