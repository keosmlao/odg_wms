"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertIcon, CheckIcon, LayersIcon, PackageIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };
type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };

type Item = { item_code: string; item_name: string | null; unit_code: string | null; rack: string; location: string; qty: string };
type Detail = { pallet: { code: string; rack: string | null; location: string | null; name: string | null }; found: boolean; items: Item[]; serial_count: number };

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function loc(rack: string | null, location: string | null) {
  return [rack, location].filter(Boolean).join(" / ") || "(ສາງ)";
}

export default function PalletMoveClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [palletCode, setPalletCode] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // destination (can differ from source — cross-warehouse move)
  const [toWh, setToWh] = useState("");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [toRack, setToRack] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }

  // Source warehouse → load its pallets; default destination = same warehouse.
  useEffect(() => {
    setPallets([]); setPalletCode(""); setDetail(null);
    setToWh(whCode); setToRack(""); setToLoc("");
    if (!whCode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(whCode)}`);
        const data = (await res.json()) as { pallets?: PalletOption[] };
        if (!cancelled) setPallets(data.pallets ?? []);
      } catch {
        if (!cancelled) showToast("err", "ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ");
      }
    })();
    return () => { cancelled = true; };
  }, [whCode]);

  // Destination warehouse → load its racks/locations.
  useEffect(() => {
    setRacks([]); setLocations([]); setToRack(""); setToLoc("");
    if (!toWh) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(toWh)}`);
        const data = (await res.json()) as { racks?: RackOption[]; locations?: LocationOption[] };
        if (cancelled) return;
        setRacks(data.racks ?? []);
        setLocations(data.locations ?? []);
      } catch {
        if (!cancelled) showToast("err", "ໂຫຼດ location ປາຍທາງບໍ່ສຳເລັດ");
      }
    })();
    return () => { cancelled = true; };
  }, [toWh]);

  async function loadDetail(code: string) {
    setPalletCode(code);
    setDetail(null);
    setToRack(""); setToLoc("");
    if (!code) return;
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/movements/pallet-move?wh=${encodeURIComponent(whCode)}&pallet=${encodeURIComponent(code)}`);
      const data = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setDetail(data);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoadingDetail(false);
    }
  }

  const availableLocations = useMemo(() => (toRack ? locations.filter((l) => l.rack_code === toRack) : locations), [locations, toRack]);
  const totalQty = useMemo(() => (detail?.items ?? []).reduce((n, i) => n + (Number.parseFloat(i.qty) || 0), 0), [detail]);

  async function submit() {
    if (!detail || !palletCode) return;
    if (toWh === whCode && !toRack && !toLoc) { showToast("err", "ກະລຸນາເລືອກປາຍທາງ (ສาง / rack / location)"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/pallet-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: whCode, pallet: palletCode, to_wh: toWh, to_rack: toRack, to_location: toLoc }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; doc_no?: string; items?: number; serials?: number; serials_kept?: number; to?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const snNote = data.serials_kept ? `${data.serials_kept} SN ຄົງບ່ອນເກົ່າ` : `${data.serials} SN`;
      showToast("ok", `ຍ້າຍ pallet ${palletCode} → ${data.to} · ${data.doc_no} (${data.items} ສິນຄ້າ · ${snNote})`);
      await loadDetail(palletCode); // refresh
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      {/* select pallet */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>ສາງ *</label>
            <select value={whCode} onChange={(e) => setWhCode(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (<option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pallet *</label>
            <select value={palletCode} onChange={(e) => loadDetail(e.target.value)} disabled={!whCode} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກ pallet —</option>
              {pallets.map((p) => (<option key={p.code} value={p.code}>{p.code}{p.location ? ` @ ${p.location}` : ""}</option>))}
            </select>
          </div>
        </div>
      </section>

      {loadingDetail && <p className="text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ pallet...</p>}

      {detail && (
        <>
          {/* current */}
          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><LayersIcon className="h-5 w-5" /></span>
                <div>
                  <div className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-50">📦 {detail.pallet.code}</div>
                  <div className="text-xs text-zinc-500">ຢູ່ປັດຈຸບัน: <span className="font-mono text-blue-600 dark:text-blue-400">{loc(detail.pallet.rack, detail.pallet.location)}</span>{!detail.found && <span className="ml-1 text-rose-500">· ບໍ່ມີໃນ pallet master</span>}</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div><div className="text-[10px] uppercase text-zinc-400">ສິນຄ້າ</div><div className="font-mono text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{detail.items.length}</div></div>
                <div><div className="text-[10px] uppercase text-zinc-400">ຈຳນວນ</div><div className="font-mono text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt(totalQty)}</div></div>
                <div><div className="text-[10px] uppercase text-zinc-400">SN</div><div className="font-mono text-xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{detail.serial_count}</div></div>
              </div>
            </div>

            {detail.items.length === 0 && detail.serial_count === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">Pallet ນີ້ບໍ່ມີສິນຄ້າ/serial</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2">ສິນຄ້າ</th><th className="px-4 py-2">ບ່ອນ</th><th className="px-4 py-2 text-right">ຈຳນວນ</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {detail.items.map((i, idx) => (
                      <tr key={`${i.item_code}-${idx}`}>
                        <td className="px-4 py-2"><div className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{i.item_code}</div><div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={i.item_name ?? ""}>{i.item_name ?? "—"}</div></td>
                        <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{loc(i.rack, i.location)}</td>
                        <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(i.qty)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{i.unit_code}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* destination + move */}
          {(detail.items.length > 0 || detail.serial_count > 0) && (
            <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">ຍ້າຍໄປບ່ອນໃໝ່</h3>
              <p className="mb-3 text-[11px] text-zinc-400">ເລືອກ ສาง (ຂ້າມສາງໄດ້) · Rack ແລະ Location ເປັນທາງเลือก — ປ່ອຍວ່າງ = ວາງລະດັບ rack/ສาง</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>ສາງ ປາຍທາງ *</label>
                  <select value={toWh} onChange={(e) => setToWh(e.target.value)} className={`${inputCls} w-full`}>
                    {warehouses.map((w) => (<option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}{w.code === whCode ? " (ນີ້)" : ""}</option>))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Rack ປາຍທາງ</label>
                  <select value={toRack} onChange={(e) => { setToRack(e.target.value); setToLoc(""); }} className={`${inputCls} w-full`}>
                    <option value="">— ບໍ່ລະບຸ (ລະດັບ ສາງ) —</option>
                    {racks.map((r) => (<option key={r.code} value={r.code}>{r.code}{r.name ? ` · ${r.name}` : ""}</option>))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Location ປາຍທາງ</label>
                  <select value={toLoc} onChange={(e) => setToLoc(e.target.value)} disabled={!toRack} className={`${inputCls} w-full`}>
                    <option value="">{toRack ? "— ບໍ່ລະບຸ (ລະດັບ rack) —" : "ເລືອກ rack ກ່ອນ"}</option>
                    {availableLocations.map((l) => (<option key={l.code} value={l.code}>{l.code}{l.name ? ` · ${l.name}` : ""}</option>))}
                  </select>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">{whCode} · {loc(detail.pallet.rack, detail.pallet.location)} → <b className="font-mono text-blue-600 dark:text-blue-400">{toWh}{toRack || toLoc ? ` · ${loc(toRack, toLoc)}` : " (ສາງ)"}</b>{toWh !== whCode && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ຂ້າມສາງ</span>}</span>
                <button type="button" onClick={submit} disabled={submitting || (toWh === whCode && !toRack && !toLoc)} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:shadow-lg disabled:opacity-50">
                  <LayersIcon className="h-4 w-4" />
                  {submitting ? "ກຳລັງຍ້າຍ..." : "ຍ້າຍ Pallet"}
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {!detail && !loadingDetail && whCode && (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
          <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-xs font-semibold text-zinc-500">ເລືອກ pallet ເພື່ອเริ่ม</p>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
            {toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
