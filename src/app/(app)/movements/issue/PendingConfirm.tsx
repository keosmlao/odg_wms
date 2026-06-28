"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { MOVE_REASONS } from "@/lib/moveReasons";
import type { WarehouseOption } from "./SourceIssue";

type DraftDoc = {
  doc_no: string; doc_date: string | null; doc_time: string | null; warehouse_code: string | null;
  ref_doc_no: string | null; customer_code: string | null; remark: string | null; line_count: number; serial_count: number; total_qty: string;
};
type DraftLine = { item_code: string; item_name: string | null; unit_code: string | null; qty: string; rack: string; location: string; pallet: string; serials: string[]; available: string[] };

function ddmm(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return day ? `${day}-${m}-${y}` : d;
}

export default function PendingConfirm({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<{ header: DraftDoc; lines: DraftLine[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [linesByDoc, setLinesByDoc] = useState<Record<string, DraftLine[]>>({});
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({}); // item → short reason
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 2800); }

  async function loadDocs() {
    if (!wh) { setDocs([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/movements/issue/draft?wh=${encodeURIComponent(wh)}`);
      const data = (await res.json()) as { docs?: DraftDoc[] };
      setDocs(data.docs ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadDocs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wh]);

  async function toggleExpand(doc_no: string) {
    if (expanded === doc_no) { setExpanded(null); return; }
    setExpanded(doc_no);
    if (!linesByDoc[doc_no]) {
      try {
        const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`);
        const data = (await res.json()) as { lines?: DraftLine[] };
        setLinesByDoc((p) => ({ ...p, [doc_no]: data.lines ?? [] }));
      } catch { /* ignore */ }
    }
  }

  async function openDoc(doc_no: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`);
      const data = (await res.json()) as { header?: DraftDoc; lines?: DraftLine[]; error?: string };
      if (!res.ok || !data.header) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      setActive({ header: data.header, lines: data.lines ?? [] });
      setScanned(new Set());
      setReasons({});
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  // Map each in-stock serial → its item, and the planned qty + expected ISN per item.
  const serialOwner = useMemo(() => {
    const m = new Map<string, string>();
    if (active) for (const l of active.lines) for (const a of l.available) m.set(a.toUpperCase(), l.item_code);
    return m;
  }, [active]);
  const neededByItem = useMemo(() => {
    const m = new Map<string, number>();
    if (active) for (const l of active.lines) m.set(l.item_code, (m.get(l.item_code) ?? 0) + (Number.parseInt(l.qty, 10) || 0));
    return m;
  }, [active]);
  // Only items that are serial-tracked (have a pending serial plan) need scanning.
  const serialItems = useMemo(() => new Set(active ? active.lines.filter((l) => l.serials.length > 0).map((l) => l.item_code) : []), [active]);
  const scannedCount = (item: string) => [...scanned].filter((s) => serialOwner.get(s) === item).length;
  const totalNeeded = useMemo(() => [...serialItems].reduce((s, i) => s + (neededByItem.get(i) ?? 0), 0), [serialItems, neededByItem]);
  const allDone = totalNeeded > 0 && [...serialItems].every((i) => scannedCount(i) === (neededByItem.get(i) ?? 0));
  const noSerials = totalNeeded === 0;
  const totalScanned = [...serialItems].reduce((s, i) => s + scannedCount(i), 0);
  const shortItems = useMemo(() => [...serialItems].filter((i) => scannedCount(i) < (neededByItem.get(i) ?? 0)), [serialItems, scanned, neededByItem]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortAllHaveReason = shortItems.every((i) => reasons[i]);
  // Confirm allowed when: fully scanned, OR every short item has a reason and there is something to issue.
  const canConfirm = !busy && shortAllHaveReason && (allDone || noSerials || totalScanned > 0);

  function handleScan() {
    if (!active) return;
    const t = scan.trim().toUpperCase();
    if (!t) return;
    const owner = serialOwner.get(t);
    if (!owner) showToast("err", `ISN ${scan} ບໍ່ມีในstock / ບໍ່ແມ່ນຂອງໃບนี้`);
    else if (scanned.has(t)) showToast("err", `${scan} ຍິງແລ້ວ`);
    else if (scannedCount(owner) >= (neededByItem.get(owner) ?? 0)) showToast("err", `${owner}: ຍິງครບ ${neededByItem.get(owner)} ແລ້ວ`);
    else {
      const isSub = !active.lines.some((l) => l.item_code === owner && l.serials.some((s) => s.toUpperCase() === t));
      setScanned((p) => new Set(p).add(t));
      showToast("ok", isSub ? `✓ ${scan} (ຕัวแทน)` : `✓ ${scan}`);
    }
    setScan("");
    setTimeout(() => scanRef.current?.focus(), 20);
  }

  async function confirm() {
    if (!active) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(active.header.doc_no)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanned: [...scanned], notes: shortItems.map((i) => ({ item_code: i, reason_code: reasons[i] })) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; issue_code?: string; erp_doc?: string | null; partial?: boolean };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ຈ່າຍສຳເລັດ ${data.issue_code}${data.partial ? " · ส่วนที่เหลือยังค้างใน pending" : ""}`);
      setActive(null);
      await loadDocs();
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  async function removeLine(item: string) {
    if (!active) return;
    if (!window.confirm(`ລົບ ${item} ອອກຈາກໃບ pick?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(active.header.doc_no)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove_item: item }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; emptied?: boolean };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ລົບ ${item} ແລ້ວ`);
      if (data.emptied) { setActive(null); await loadDocs(); }
      else await openDoc(active.header.doc_no);
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  async function cancelDraft(doc_no: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", "ຍົກເລີກ pending ແລ້ວ");
      setActive(null);
      await loadDocs();
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      {!active && (
        <>
          <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </section>
          <section className="space-y-2">
            {loading ? <div className="py-10 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
            : !wh ? <div className="py-10 text-center text-sm text-zinc-400">ເລືອກສາງເພື່ອเริ่ม</div>
            : docs.length === 0 ? <div className="py-10 text-center text-sm text-zinc-400">ບໍ່ມີໃບ pick ລໍຖ້າຢືນຢັນ</div>
            : docs.map((d) => (
              <div key={d.doc_no} className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 transition hover:ring-red-300 dark:bg-zinc-900 dark:ring-zinc-800">
                <div className="flex w-full items-center gap-3 p-3.5">
                  <button type="button" onClick={() => toggleExpand(d.doc_no)} className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer">
                    <span className={`shrink-0 text-zinc-400 transition-transform ${expanded === d.doc_no ? "rotate-90" : ""}`}>›</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">{d.doc_no}</span>{d.ref_doc_no && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">ref {d.ref_doc_no}</span>}<span className="text-[11px] text-zinc-400">{ddmm(d.doc_date)} {d.doc_time}</span></span>
                      <span className="block truncate text-xs text-zinc-500">{d.customer_code ?? "—"}{d.remark ? ` · 🚜 ${d.remark}` : ""}</span>
                    </span>
                  </button>
                  <div className="text-right text-[11px] text-zinc-500"><div className="font-mono text-sm font-bold text-red-600 dark:text-red-400">ຄ້າງ {Number.parseFloat(d.total_qty) || 0}</div><div>{d.line_count} ລາຍການ{d.serial_count > 0 ? ` · ${d.serial_count} ISN` : ""}</div></div>
                  <a href={`/print/pick/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener" title="ພິມໃບ pick" className="shrink-0 rounded-lg p-2 text-zinc-400 ring-1 ring-zinc-200 hover:bg-slate-50 hover:text-slate-700 dark:ring-zinc-800">🖨</a>
                  <button type="button" onClick={() => openDoc(d.doc_no)} className="shrink-0 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:shadow active:scale-95 cursor-pointer">ຢືນຢັນຈ່າຍ →</button>
                </div>
                {expanded === d.doc_no && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    {!linesByDoc[d.doc_no] ? (
                      <div className="py-3 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2">ສິນຄ້າ</th><th className="px-4 py-2">ບ່ອນເກັບ</th><th className="px-4 py-2 text-right">ຄ້າງຈ່າຍ</th></tr></thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {linesByDoc[d.doc_no].map((l, i) => (
                            <tr key={`${l.item_code}-${i}`}>
                              <td className="px-4 py-2"><span className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400">{l.item_code}</span><div className="max-w-md truncate text-[13px] text-zinc-700 dark:text-zinc-300">{l.item_name}</div></td>
                              <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{[l.rack, l.location, l.pallet].filter(Boolean).join(" / ") || "—"}</td>
                              <td className="px-4 py-2 text-right font-mono font-bold tabular-nums text-red-600 dark:text-red-400">{l.qty} <span className="text-[10px] text-zinc-400">{l.unit_code}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {active && (() => {
        const pct = totalNeeded > 0 ? Math.min(100, Math.round((totalScanned / totalNeeded) * 100)) : 0;
        return (
        <section className="space-y-4 pb-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setActive(null)} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">← ກັບ</button>
            <div className="flex items-center gap-2">
              <a href={`/print/pick/${encodeURIComponent(active.header.doc_no)}?auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">🖨 ພິມໃບ pick</a>
              <button type="button" disabled={busy} onClick={() => cancelDraft(active.header.doc_no)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-rose-400 dark:ring-rose-900/50">ຍົກເລີກ pick</button>
            </div>
          </div>

          {/* header — doc + progress */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 bg-gradient-to-r from-red-50/70 to-transparent px-5 py-4 dark:border-zinc-800 dark:from-red-950/20">
              <div className="min-w-0">
                <div className="font-mono text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-50">{active.header.doc_no}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  {active.header.ref_doc_no && <span className="rounded-md bg-red-50 px-2 py-0.5 font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">ref {active.header.ref_doc_no}</span>}
                  {active.header.customer_code && <span>👤 {active.header.customer_code}</span>}
                  {active.header.remark && <span>🚜 {active.header.remark}</span>}
                </div>
              </div>
              {totalNeeded > 0 && (
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">ຍິງ SN ແລ້ວ</div>
                  <div className="font-mono text-3xl font-black leading-none text-red-600 dark:text-red-400">{totalScanned}<span className="text-lg text-zinc-300">/{totalNeeded}</span></div>
                  <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${pct}%` }} /></div>
                </div>
              )}
            </div>
          </div>

          {/* big scan */}
          {totalNeeded > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50/40 p-3.5 dark:border-red-900/40 dark:bg-red-950/15">
              <label className="mb-1 block text-[11px] font-bold text-red-700 dark:text-red-300">🔫 ຍິງ SN ຕົວຈິງ ທີ່ຈ່າຍ ແລ້ວ Enter</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input ref={scanRef} type="text" autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } }} placeholder="scan SN / ISN …" className="w-full rounded-lg border border-red-300 bg-white py-2.5 pl-9 pr-3 text-sm font-mono outline-none focus:ring-2 focus:ring-red-500/30 dark:bg-zinc-950 dark:border-red-900/50" />
                </div>
                <button type="button" onClick={handleScan} className="rounded-lg bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700">ຍິງ</button>
              </div>
            </div>
          )}

          {/* items */}
          <div className="space-y-3">
            {[...active.lines]
              .sort((a, b) => [a.rack, a.location, a.pallet].filter(Boolean).join("/").localeCompare([b.rack, b.location, b.pallet].filter(Boolean).join("/")))
              .map((l, i) => {
                const need = Number.parseInt(l.qty, 10) || 0;
                const isSer = serialItems.has(l.item_code);
                const got = isSer ? scannedCount(l.item_code) : need;
                const lp = need > 0 ? Math.min(100, Math.round((got / need) * 100)) : 0;
                const short = isSer && got < (neededByItem.get(l.item_code) ?? 0);
                return (
                  <div key={i} className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-zinc-900 ${got >= need && need > 0 ? "border-emerald-300 dark:border-emerald-900/50" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="flex items-start justify-between gap-2 p-4">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-zinc-400">{l.item_code}{isSer && <span className="ml-1.5 rounded bg-violet-100 px-1 text-[9px] font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">SN</span>}</div>
                        <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{l.item_name}</div>
                        <div className="font-mono text-[10px] text-zinc-400">{[l.rack, l.location, l.pallet].filter(Boolean).join(" / ") || "—"}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right"><div className="font-mono text-lg font-black text-red-600 dark:text-red-400">−{l.qty}</div><div className="text-[10px] text-zinc-400">{l.unit_code}</div></div>
                        <button type="button" disabled={busy} onClick={() => removeLine(l.item_code)} title="ລົບ ออกจากใบ pick" className="rounded p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-rose-950/30">🗑</button>
                      </div>
                    </div>
                    {isSer && (
                      <>
                        <div className="px-4"><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={`h-full rounded-full transition-all ${got >= need && need > 0 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${lp}%` }} /></div></div>
                        <div className="p-4 pt-3">
                          <div className="mb-1 text-[10px] font-bold text-zinc-500">ຍິງ {got} / {need}</div>
                          <div className="flex flex-wrap gap-1">
                            {l.serials.map((sn) => {
                              const ok = scanned.has(sn.toUpperCase());
                              return <span key={sn} className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ${ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50" : "bg-zinc-50 text-zinc-400 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700"}`}>{ok ? "✓ " : "○ "}{sn}</span>;
                            })}
                            {[...scanned].filter((sc) => serialOwner.get(sc) === l.item_code && !l.serials.some((x) => x.toUpperCase() === sc)).map((sc) => (
                              <span key={sc} className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">⚠ {sc} ตัวแทน</span>
                            ))}
                          </div>
                          {short && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[11px] font-bold text-amber-600">ขาด {(neededByItem.get(l.item_code) ?? 0) - got} →</span>
                              <select value={reasons[l.item_code] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [l.item_code]: e.target.value }))}
                                className="rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-xs text-zinc-700 dark:bg-amber-950/20 dark:text-amber-200">
                                <option value="">ເຫດຜລ (ຖ້າຈ່າຍບໍ່ຄົບ)…</option>
                                {MOVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {/* sticky footer */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64 dark:border-zinc-800 dark:bg-zinc-950/95">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
              <span className="text-sm font-bold text-zinc-600 dark:text-zinc-300">{totalNeeded > 0 ? `${totalScanned}/${totalNeeded} ຍິງແລ້ວ` : " พร้อมจ่าย"}{shortItems.length > 0 ? " · ຈ່າຍບໍ່ຄົບ" : ""}</span>
              <button type="button" onClick={confirm} disabled={!canConfirm} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-600 px-7 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
                <CheckIcon className="h-4 w-4" />{busy ? "ກຳລັງຈ່າຍ..." : shortItems.length > 0 ? "ຢືນຢັນຈ່າຍ (ບໍ່ຄົບ)" : "ຢືນຢັນຈ່າຍ"}
              </button>
            </div>
          </div>
        </section>
        );
      })()}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.k === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.k === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.t}</div>
        </div>
      )}
    </div>
  );
}
