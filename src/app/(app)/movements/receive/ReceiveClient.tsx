"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  PackageIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import type { ROption } from "@/components/ui/RSelect";
import { BackLink, type DestType, ItemCard, PutawayPicker, ReceiveHeaderCard, StickyFooter } from "./_receiveUI";

export type WarehouseOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };

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
  destType: DestType; // per-line putaway (used in "line" mode)
  location: string;
  pallet: string;
};

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
  const [whCode, setWhCode] = useState(initialWh || (warehouses.length === 1 ? warehouses[0].code : ""));
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [putMode, setPutMode] = useState<"all" | "line">("all");
  const [destType, setDestType] = useState<DestType>("location");
  const [locationCode, setLocationCode] = useState("");
  const [palletCode, setPalletCode] = useState("");
  const [sameLocs, setSameLocs] = useState<{ location: string; item_code: string; qty: string }[]>([]);
  const [emptyLocs, setEmptyLocs] = useState<string[]>([]);

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

  // Load locations/pallets when warehouse changes
  useEffect(() => {
    setLocations([]); setPallets([]); setLocationCode(""); setPalletCode("");
    if (!whCode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(whCode)}`);
        const data = (await res.json()) as { locations?: LocationOption[]; pallets?: PalletOption[] };
        if (cancelled) return;
        setLocations(data.locations ?? []);
        setPallets(data.pallets ?? []);
      } catch {
        /* optional */
      }
    })();
    return () => { cancelled = true; };
  }, [whCode]);

  const locByCode = useMemo(() => new Map(locations.map((l) => [l.code, l])), [locations]);
  const palByCode = useMemo(() => new Map(pallets.map((p) => [p.code, p])), [pallets]);
  const nameOf = (code: string) => locByCode.get(code)?.name || code;
  const locOptions: ROption[] = useMemo(() => locations.map((l) => ({ value: l.code, label: l.name || l.code, sub: l.rack_code || undefined })), [locations]);
  const palOptions: ROption[] = useMemo(() => pallets.map((p) => ({ value: p.code, label: p.name || p.code, sub: p.location ? (locByCode.get(p.location)?.name || p.location) : undefined })), [pallets, locByCode]);
  // Aggregate same-item locations across all lines for the suggester.
  const sameByLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sameLocs) m.set(s.location, (m.get(s.location) ?? 0) + (Number.parseFloat(s.qty) || 0));
    return Array.from(m, ([location, qty]) => ({ location, qty: String(qty) })).sort((a, b) => Number(b.qty) - Number(a.qty));
  }, [sameLocs]);
  // Resolve the chosen destination to {rack, location, pallet} for the API.
  function destination() {
    if (destType === "pallet") {
      const p = palByCode.get(palletCode);
      return { rack: p?.rack ?? "", location: p?.location ?? "", pallet: palletCode };
    }
    return { rack: locByCode.get(locationCode)?.rack_code ?? "", location: locationCode, pallet: "" };
  }
  const hasDest = destType === "pallet" ? !!palletCode : !!locationCode;

  // Load putaway suggestions for the selected doc's items.
  useEffect(() => {
    if (!po || !whCode) { setSameLocs([]); setEmptyLocs([]); return; }
    const items = Array.from(new Set(lines.map((l) => l.item_code))).join(",");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receive/putaway?wh=${encodeURIComponent(whCode)}&items=${encodeURIComponent(items)}`);
        const data = (await res.json()) as { sameLocs?: { location: string; item_code: string; qty: string }[]; emptyLocs?: string[] };
        if (cancelled) return;
        setSameLocs(Array.isArray(data.sameLocs) ? data.sameLocs : []);
        setEmptyLocs(Array.isArray(data.emptyLocs) ? data.emptyLocs : []);
      } catch {
        /* suggestions are optional */
      }
    })();
    return () => { cancelled = true; };
  }, [po, whCode, lines]);

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
          destType: "location" as DestType,
          location: "",
          pallet: "",
        };
      }),
    );
  }

  function setQty(itemCode: string, value: string) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, qty: value } : l)));
  }
  function setLineDest(itemCode: string, patch: Partial<WorkLine>) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, ...patch } : l)));
  }
  // Resolve a per-line destination to {rack, location, pallet}.
  function lineDestination(l: WorkLine) {
    if (l.destType === "pallet") {
      const p = palByCode.get(l.pallet);
      return { rack: p?.rack ?? "", location: p?.location ?? "", pallet: l.pallet };
    }
    return { rack: locByCode.get(l.location)?.rack_code ?? "", location: l.location, pallet: "" };
  }
  const lineHasDest = (l: WorkLine) => (l.destType === "pallet" ? !!l.pallet : !!l.location);
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
  const totalWant = useMemo(() => lines.reduce((s, l) => s + l.remaining, 0), [lines]);
  const totalGot = useMemo(() => lines.reduce((s, l) => s + (parsedQty(l.qty) ?? 0), 0), [lines]);

  async function submit() {
    if (!po || receiveLines.length === 0) { showToast("err", "ບໍ່ມີລາຍການໃຫ້ຮັບ"); return; }
    if (putMode === "all" && !hasDest) { showToast("err", "ກະລຸນາເລືອກ location ຫຼື pallet"); return; }
    if (putMode === "line") {
      const miss = receiveLines.find((l) => !lineHasDest(l));
      if (miss) { showToast("err", `${miss.item_code}: ເລືອກ location / pallet`); return; }
    }
    // client-side guard: qty <= remaining
    for (const l of receiveLines) {
      const q = parsedQty(l.qty)!;
      if (q > l.remaining + 1e-6) { showToast("err", `${l.item_code}: ຮັບເກີນຄ້າງ (${fmt(l.remaining)})`); return; }
    }
    const gDest = destination();
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
          lines: receiveLines.map((l) => {
            const d = putMode === "line" ? lineDestination(l) : gDest;
            return {
              item_code: l.item_code,
              item_name: l.item_name,
              unit_code: l.unit_code,
              qty: parsedQty(l.qty),
              rack: d.rack,
              location: d.location,
              pallet: d.pallet,
            };
          }),
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
  const docLabel = DOC_TYPES.find((d) => d.value === docType)?.label ?? "";
  const destReady = putMode === "all" ? hasDest : receiveLines.every((l) => lineHasDest(l));

  // ── Detail (scan-card) — a PO/return doc is selected ──
  if (po) {
    return (
      <div className="space-y-4 pb-24">
        <BackLink onClick={() => { setPo(null); setLines([]); }} />

        <ReceiveHeaderCard
          docNo={po.po_no}
          verb="ຮັບ"
          got={Math.round(totalGot)}
          want={Math.round(totalWant)}
          badges={<>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{po.cust_name ?? po.cust_code ?? "—"}</span>
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{docLabel}</span>
          </>}
        >
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold text-slate-500">📍 ບ່ອນຈັດເກັບ:</label>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
              {([["all", "ທັງໝົດ"], ["line", "ທີ່ລະລາຍການ"]] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setPutMode(m)} className={`rounded px-3 py-1 transition ${putMode === m ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
          </div>
          {putMode === "all"
            ? <PutawayPicker
                dest={destType} onDest={(t) => { setDestType(t); setLocationCode(""); setPalletCode(""); }}
                locValue={locationCode} onLoc={setLocationCode} locOptions={locOptions}
                palValue={palletCode} onPal={setPalletCode} palOptions={palOptions}
                same={sameByLoc} empty={emptyLocs} nameOf={nameOf}
              />
            : <p className="text-[11px] text-slate-400">ເລືອກ location / pallet ແຍກໃນແຕ່ລະລາຍການດ້ານລຸ່ມ</p>}
        </ReceiveHeaderCard>

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-bold text-slate-600">ລາຍການສິນຄ້າ ({lines.length})</span>
          <button type="button" onClick={fillAll} className="text-xs font-semibold text-emerald-600 hover:underline">ຮັບໝົດທຸກລາຍການ</button>
        </div>

        <div className="space-y-3">
          {lines.map((l) => {
            const q = parsedQty(l.qty);
            const got = q ?? 0;
            const over = q !== null && q > l.remaining + 1e-6;
            return (
              <ItemCard key={l.item_code} code={l.item_code} name={l.item_name} want={l.remaining} unit={l.unit_code} got={got}>
                <div className="w-full space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">ຮັບ ຈິງ</label>
                    <input
                      type="number" inputMode="decimal" min={0} max={l.remaining} value={l.qty}
                      onChange={(e) => setQty(l.item_code, e.target.value)}
                      className={`w-24 rounded-lg border px-3 py-1.5 text-center font-mono text-sm font-bold ${over ? "border-red-400 bg-red-50 text-red-600" : "border-slate-300"}`}
                    />
                    <button type="button" onClick={() => setQty(l.item_code, String(l.remaining))} className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100">ໝົດ</button>
                    <span className="text-[11px] text-slate-400">{l.unit_code ?? ""}</span>
                    {over && <span className="text-xs font-bold text-red-500">ເກີນຄ້າງ</span>}
                  </div>
                  {putMode === "line" && (
                    <div className="border-t border-slate-100 pt-2.5">
                      <div className="mb-1.5 text-[11px] font-bold text-slate-500">📍 ບ່ອນຈັດເກັບ</div>
                      <PutawayPicker
                        dest={l.destType} onDest={(t) => setLineDest(l.item_code, { destType: t, location: "", pallet: "" })}
                        locValue={l.location} onLoc={(v) => setLineDest(l.item_code, { location: v })} locOptions={locOptions}
                        palValue={l.pallet} onPal={(v) => setLineDest(l.item_code, { pallet: v })} palOptions={palOptions}
                        same={sameLocs.filter((s) => s.item_code === l.item_code).map((s) => ({ location: s.location, qty: s.qty }))}
                        empty={emptyLocs} nameOf={nameOf}
                      />
                    </div>
                  )}
                </div>
              </ItemCard>
            );
          })}
        </div>

        <div>
          <label className={labelCls}>ໝາຍເຫດ (ທາງເລືອກ)</label>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດເພີ່ມເຕີມ..." className={inputCls} />
        </div>

        <StickyFooter
          leftText={`ລວມ ຮັບ ${Math.round(totalGot)}/${Math.round(totalWant)}`}
          onSubmit={submit}
          disabled={submitting || receiveLines.length === 0 || !destReady}
          submitting={submitting}
          label={!destReady ? "ເລືອກ location ກ່ອນ" : "ຢືນຢັນ ຮັບເຂົ້າ WMS"}
        />

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

  // ── List — pick a doc to receive ──
  return (
    <div className="space-y-5">
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
              <p className="mt-2 text-xs font-semibold text-zinc-500">{loadingPending ? "ກຳລັງໂຫຼດ..." : 'ກົດ "ໂຫຼດເອກະສານຄ້າງຮັບ" ເພື່ອเริ่ม'}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">ພົບ {pos.length} ໃບ{docLabel}ຄ້າງຮັບ</span>
                <button type="button" onClick={() => loadPending(true)} disabled={loadingPending} className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400">
                  ↻ ໂຫຼດສด (ล่าสุดจาก ERP)
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
