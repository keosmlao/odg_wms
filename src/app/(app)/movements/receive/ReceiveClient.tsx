"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  MapPinIcon,
  PackageIcon,
  SearchIcon,
} from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };
type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };

type PendingLine = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  send_date: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  erp_balance: string;
  wms_received: string;
  remaining: string;
};

type PoGroup = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  doc_date: string | null;
  send_date: string | null;
  lines: PendingLine[];
  totalRemaining: number;
};

type WorkLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  received: number;
  remaining: number;
  qty: string;
};

const STEPS = [
  { n: 1, label: "ເລືອກໃບສັ່ງຊື້" },
  { n: 2, label: "ຮັບເຂົ້າ location" },
  { n: 3, label: "ຢືນຢັນ" },
] as const;

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function parsedQty(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// PO receipts go through the count-sheet flow; this wizard handles the rest.
const DOC_TYPES = [
  { value: "transfer", label: "ໃບໂອນ" },
  { value: "sales_return", label: "ຮັບคืนขาย" },
  { value: "issue_return", label: "ຮັບคืนเบิก" },
] as const;

export default function ReceiveClient({ warehouses, initialSearch = "", initialType = "", initialWh = "" }: { warehouses: WarehouseOption[]; initialSearch?: string; initialType?: string; initialWh?: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [whCode, setWhCode] = useState(initialWh || (warehouses.length === 1 ? warehouses[0].code : ""));
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [rackCode, setRackCode] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [pallet, setPallet] = useState("");

  const [docType, setDocType] = useState(
    DOC_TYPES.some((d) => d.value === initialType) ? initialType : "transfer",
  );
  const [search, setSearch] = useState(initialSearch);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pos, setPos] = useState<PoGroup[]>([]);

  const [po, setPo] = useState<PoGroup | null>(null);
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }

  // Load racks/locations when warehouse changes
  useEffect(() => {
    setRacks([]); setLocations([]); setRackCode(""); setLocationCode(""); setPallet("");
    if (!whCode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(whCode)}`);
        const data = (await res.json()) as { racks?: RackOption[]; locations?: LocationOption[] };
        if (cancelled) return;
        setRacks(data.racks ?? []);
        setLocations(data.locations ?? []);
      } catch {
        /* optional */
      }
    })();
    return () => { cancelled = true; };
  }, [whCode]);

  const availableLocations = useMemo(
    () => (rackCode ? locations.filter((l) => l.rack_code === rackCode) : locations),
    [locations, rackCode],
  );
  useEffect(() => {
    if (locationCode && rackCode && !availableLocations.find((l) => l.code === locationCode)) setLocationCode("");
  }, [rackCode, locationCode, availableLocations]);

  // Auto-load once when arriving from "ໄປຮັບ" (pending list) with a PO prefilled
  // and a warehouse already resolved (single-warehouse users). Mount-only.
  useEffect(() => {
    if (initialSearch && whCode) loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPending(fresh = false) {
    if (!whCode) { showToast("err", "ກະລຸນາເລືອກສາງ"); return; }
    setLoadingPending(true);
    try {
      const params = new URLSearchParams({ wh: whCode, type: docType });
      if (search.trim()) params.set("q", search.trim());
      if (fresh) params.set("fresh", "1");
      const res = await fetch(`/api/receive/pending?${params}`);
      const data = (await res.json()) as { lines?: PendingLine[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      const byPo = new Map<string, PoGroup>();
      for (const l of data.lines ?? []) {
        let g = byPo.get(l.po_no);
        if (!g) {
          g = { po_no: l.po_no, cust_code: l.cust_code, cust_name: l.cust_name, doc_date: l.doc_date, send_date: l.send_date, lines: [], totalRemaining: 0 };
          byPo.set(l.po_no, g);
        }
        g.lines.push(l);
        g.totalRemaining += Number.parseFloat(l.remaining) || 0;
      }
      setPos(Array.from(byPo.values()));
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
    } finally {
      setLoadingPending(false);
    }
  }

  function selectPo(g: PoGroup) {
    setPo(g);
    setLines(
      g.lines.map((l) => {
        const remaining = Number.parseFloat(l.remaining) || 0;
        return {
          item_code: l.item_code,
          item_name: l.item_name,
          unit_code: l.unit_code,
          ordered: Number.parseFloat(l.ordered) || 0,
          received: (Number.parseFloat(l.ordered) || 0) - (Number.parseFloat(l.erp_balance) || 0),
          remaining,
          qty: String(remaining),
        };
      }),
    );
    setStep(2);
  }

  function setQty(itemCode: string, value: string) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, qty: value } : l)));
  }
  function fillAll() {
    setLines((prev) => prev.map((l) => ({ ...l, qty: String(l.remaining) })));
  }

  const receiveLines = useMemo(
    () => lines.filter((l) => {
      const q = parsedQty(l.qty);
      return q !== null && q > 0;
    }),
    [lines],
  );

  async function submit() {
    if (!po || receiveLines.length === 0) { showToast("err", "ບໍ່ມີລາຍການໃຫ້ຮັບ"); return; }
    // client-side guard: qty <= remaining
    for (const l of receiveLines) {
      const q = parsedQty(l.qty)!;
      if (q > l.remaining + 1e-6) { showToast("err", `${l.item_code}: ຮັບເກີນຄ້າງ (${fmt(l.remaining)})`); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          po_no: po.po_no,
          doc_type: docType,
          supplier_code: po.cust_code,
          remark,
          lines: receiveLines.map((l) => ({
            item_code: l.item_code,
            item_name: l.item_name,
            unit_code: l.unit_code,
            qty: parsedQty(l.qty),
            rack: rackCode,
            location: locationCode,
            pallet,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; receive_code?: string; received?: number; gen_isn?: { items: number; qty: number } | null; serial_existing_items?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const genMsg = data.gen_isn ? ` · gen ISN ${data.gen_isn.qty} ໜ່ວຍ` : "";
      const snMsg = data.serial_existing_items ? ` · ⚠ ${data.serial_existing_items} ລາຍການມີ serial — ກວດ/ສະແກນຕົວທີ່ມີ` : "";
      showToast("ok", `ຮັບສຳເລັດ ${data.receive_code} · ${data.received} ລາຍການ${genMsg}${snMsg}`);
      setRemark("");
      setPo(null);
      setLines([]);
      setStep(1);
      await loadPending();
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
  const primaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800";

  const destLabel = [whCode || "—", rackCode, locationCode, pallet ? `plt:${pallet}` : ""].filter(Boolean).join(" / ");

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {/* STEP 1 — pick PO */}
      {step === 1 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          {/* document-type selector */}
          <div className="mb-4 flex flex-wrap gap-2">
            {DOC_TYPES.map((dt) => (
              <button
                key={dt.value}
                type="button"
                onClick={() => { setDocType(dt.value); setPos([]); setPo(null); }}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  docType === dt.value
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {dt.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[260px_1fr_auto]">
            <div>
              <label className={labelCls}>ສາງ *</label>
              <select value={whCode} onChange={(e) => setWhCode(e.target.value)} className={inputCls}>
                <option value="">— ເລືອກສາງ —</option>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>ຄົ້ນຫາ (PO / ສິນຄ້າ / ຜູ້ສະໜອງ)</label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadPending()} placeholder="ສະແກນ / ພິມ..." className={`${inputCls} pl-9`} />
              </div>
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => loadPending()} disabled={!whCode || loadingPending} className={primaryBtn}>
                {loadingPending ? "ກຳລັງໂຫຼດ..." : "ໂຫຼດເອກະສານຄ້າງຮັບ"}
              </button>
            </div>
          </div>

          <div className="mt-5">
            {pos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
                <PackageIcon className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
                <p className="mt-2 text-xs font-semibold text-zinc-500">{loadingPending ? "ກຳລັງໂຫຼດ..." : 'ກົດ "ໂຫຼດ PO ຄ້າງຮັບ" ເພື່ອเริ่ม'}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">ພົບ {pos.length} ໃບ{DOC_TYPES.find((d) => d.value === docType)?.label}ຄ້າງຮັບ</span>
                  <button type="button" onClick={() => loadPending(true)} disabled={loadingPending} className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400">
                    ↻ ໂຫຼດสด (ล่าสุดจาก ERP)
                  </button>
                </div>
                {pos.map((g) => (
                  <button key={g.po_no} type="button" onClick={() => selectPo(g)} className="flex w-full items-center gap-4 rounded-xl bg-white p-4 text-left ring-1 ring-zinc-200 transition hover:ring-emerald-400 dark:bg-zinc-900 dark:ring-zinc-800">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <ArrowDownIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-50">{g.po_no}</div>
                      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">{g.cust_name ?? g.cust_code ?? "—"}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-400">ສັ່ງ {g.doc_date ?? "—"} · {g.lines.length} ລາຍການ</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] uppercase text-zinc-400">ຄ້າງຮັບ</div>
                      <div className="font-mono text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(g.totalRemaining)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* STEP 2 — receive into location */}
      {step === 2 && po && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/40">
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              <span className="font-mono font-bold">{po.po_no}</span> · {po.cust_name ?? po.cust_code ?? "—"}
            </div>
          </div>

          {/* destination location */}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}><MapPinIcon className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />Rack</label>
              <select value={rackCode} onChange={(e) => setRackCode(e.target.value)} className={inputCls}>
                <option value="">— ທຸກ rack —</option>
                {racks.map((r) => <option key={r.code} value={r.code}>{r.code}{r.name ? ` · ${r.name}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Location *</label>
              <select value={locationCode} onChange={(e) => setLocationCode(e.target.value)} className={inputCls}>
                <option value="">— ເລືອກ location —</option>
                {availableLocations.map((l) => <option key={l.code} value={l.code}>{l.code}{l.name ? ` · ${l.name}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Pallet (ທາງເລືອກ)</label>
              <input value={pallet} onChange={(e) => setPallet(e.target.value)} placeholder="ວ່າງ = ບໍ່ມີ" className={inputCls} />
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">ລາຍການສິນຄ້າ</span>
            <button type="button" onClick={fillAll} className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">ຮັບໝົດທຸກລາຍການ</button>
          </div>
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2.5">ສິນຄ້າ</th>
                  <th className="px-4 py-2.5 text-right">ສັ່ງ</th>
                  <th className="px-4 py-2.5 text-right">ຮັບແລ້ວ</th>
                  <th className="px-4 py-2.5 text-right">ຄ້າງ</th>
                  <th className="px-4 py-2.5 text-center">ຮັບຄັ້ງນີ້</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((l) => {
                  const q = parsedQty(l.qty);
                  const over = q !== null && q > l.remaining + 1e-6;
                  return (
                    <tr key={l.item_code} className="align-middle">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}</div>
                        <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(l.ordered)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(l.received)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmt(l.remaining)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="number" inputMode="decimal" value={l.qty}
                            onChange={(e) => setQty(l.item_code, e.target.value)}
                            className={`w-24 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 focus:outline-none focus:ring-2 dark:bg-zinc-950 ${over ? "ring-red-400 focus:ring-red-500" : "ring-zinc-200 focus:ring-emerald-500 dark:ring-zinc-800"}`}
                          />
                          <button type="button" onClick={() => setQty(l.item_code, String(l.remaining))} className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300">ໝົດ</button>
                          <span className="w-8 text-[10px] text-zinc-400">{l.unit_code ?? ""}</span>
                        </div>
                        {over && <div className="mt-0.5 text-center text-[10px] text-red-500">ເກີນຄ້າງ</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setStep(1)} className={ghostBtn}>← ກັບ</button>
            <button type="button" onClick={() => setStep(3)} disabled={receiveLines.length === 0 || !locationCode} className={primaryBtn}>
              ກວດ + ຢືນຢັນ → {!locationCode && "(ເລືອກ location)"}
            </button>
          </div>
        </section>
      )}

      {/* STEP 3 — confirm */}
      {step === 3 && po && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <CheckIcon className="h-4 w-4 text-emerald-500" /> ຢືນຢັນການຮັບ
          </h3>
          <p className="mb-4 text-xs text-zinc-500">PO <span className="font-mono">{po.po_no}</span> · ເຂົ້າ <span className="font-mono">{destLabel}</span></p>

          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-3 py-2">ສິນຄ້າ</th>
                  <th className="px-3 py-2 text-right">ຮັບ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {receiveLines.map((l) => (
                  <tr key={l.item_code}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}</div>
                      <div className="truncate text-xs text-zinc-700 dark:text-zinc-300">{l.item_name ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{fmt(parsedQty(l.qty) ?? 0)} <span className="text-[10px] text-zinc-400">{l.unit_code ?? ""}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <label className={labelCls}>ໝາຍເຫດ (ທາງເລືອກ)</label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດເພີ່ມເຕີມ..." className={inputCls} />
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setStep(2)} className={ghostBtn}>← ກັບໄປແກ້ໄຂ</button>
            <button type="button" onClick={submit} disabled={submitting || receiveLines.length === 0} className={primaryBtn}>
              <CheckIcon className="h-4 w-4" />
              {submitting ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກການຮັບ ${receiveLines.length} ລາຍການ`}
            </button>
          </div>
        </section>
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

function Stepper({ step }: { step: number }) {
  return (
    <nav className="shadow-card rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <ol className="flex items-center">
        {STEPS.map((s, idx) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <li key={s.n} className="flex flex-1 items-center last:flex-none">
              <div className="flex items-center gap-2 px-2 py-1">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/30" : done ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"}`}>
                  {done ? "✓" : s.n}
                </span>
                <span className={`hidden text-sm font-semibold sm:inline ${active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"}`}>{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && <span className={`mx-1.5 h-0.5 flex-1 rounded-full sm:mx-3 ${step > s.n ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
