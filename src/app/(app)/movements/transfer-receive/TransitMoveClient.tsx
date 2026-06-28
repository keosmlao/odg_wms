"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MOVE_REASONS } from "@/lib/moveReasons";
import type { ROption } from "@/components/ui/RSelect";
import { PutawayPicker } from "@/app/(app)/movements/receive/_receiveUI";

type DocRow = {
  doc_no: string; doc_date: string | null; wh_from: string | null; wh_to: string | null;
  wh_from_name: string | null; wh_to_name: string | null; items: number; in_transit: string;
};
type Header = { wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null };
type DetailLine = {
  item_code: string; item_name: string | null; unit_code: string | null;
  in_transit: string; received?: string; returned?: string; serialized: boolean;
};
type SerialRow = { item_code: string; sn: string | null; isn: string | null; id: string };

export type TransitMoveMode = "receive" | "return";

const T = {
  receive: { verb: "ຮັບ", landing: "ສາງปลายทาง", doneCol: "ຮັບແລ້ວ", btn: "ຢືນຢັນ ຮັບໂອນ", empty: "ບໍ່ມີໃບຂໍໂອນຄ້າງຮັບ" },
  return: { verb: "ຮັບคืน", landing: "ສาງต้นทาง", doneCol: "ຮັບຄืນແລ້ວ", btn: "ຢືນຢັນ ຮັບຄืน", empty: "ບໍ່ມີໃบຂໍໂอนค้างรับคืน" },
} as const;

export default function TransitMoveClient({ endpoint, mode }: { endpoint: string; mode: TransitMoveMode }) {
  const t = T[mode];
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [view, setView] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState<{ doc_no: string; doc_date: string | null; doc_ref: string | null; wh_name: string | null; items: number; qty: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<DetailLine[]>([]);
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [locList, setLocList] = useState<{ code: string; name: string | null }[]>([]);
  const [sameLocs, setSameLocs] = useState<{ location: string; item_code: string; qty: string }[]>([]);
  const [emptyLocs, setEmptyLocs] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, Set<string>>>({}); // item_code → serial ids
  const [reasons, setReasons] = useState<Record<string, string>>({}); // item_code → reason_code (short)
  const [locTo, setLocTo] = useState("");
  const [putMode, setPutMode] = useState<"all" | "line">("all");
  const [locByLine, setLocByLine] = useState<Record<string, string>>({}); // item_code → location (line mode)
  const [scan, setScan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [lastDoc, setLastDoc] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null); // item_code whose ISN modal is open
  const [modalScan, setModalScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const modalScanRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      const j = await r.json();
      setDocs(Array.isArray(j.docs) ? j.docs : []);
    } catch { setDocs([]); }
    setLoading(false);
  }, [endpoint]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${endpoint}?history=1`, { cache: "no-store" });
      const j = await r.json();
      setHistory(Array.isArray(j.history) ? j.history : []);
    } catch { setHistory([]); }
  }, [endpoint]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (view === "history") void loadHistory(); }, [view, loadHistory]);
  const searchParams = useSearchParams();
  const autoOpened = useRef(false);

  const openDoc = useCallback(async (doc: string) => {
    setSel(doc); setMsg(null); setScan(""); setLocTo("");
    const r = await fetch(`${endpoint}?doc=${encodeURIComponent(doc)}`, { cache: "no-store" });
    const j = await r.json();
    const ls: DetailLine[] = j.lines ?? [];
    setHeader(j.header ?? null);
    setLines(ls);
    setSerials(j.serials ?? []);
    setSameLocs(Array.isArray(j.sameLocs) ? j.sameLocs : []);
    setEmptyLocs(Array.isArray(j.emptyLocs) ? j.emptyLocs : []);
    // Landing warehouse: receive → destination (wh_to); return → source (wh_from).
    const destWh = mode === "receive" ? j.header?.wh_to : j.header?.wh_from;
    if (destWh) {
      try {
        const lr = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(destWh)}`, { cache: "no-store" });
        const ld = await lr.json();
        setLocList(Array.isArray(ld.locations) ? ld.locations : []);
      } catch { setLocList([]); }
    } else setLocList([]);
    // default qty = full in-transit for non-serial; serial items start at 0 (scan to add)
    const q: Record<string, number> = {};
    for (const l of ls) q[l.item_code] = l.serialized ? 0 : Number.parseFloat(l.in_transit) || 0;
    setQty(q);
    setPicked({});
    setReasons({});
    setLocByLine({});
  }, [endpoint, mode]);

  const locByCode = useMemo(() => new Map(locList.map((l) => [l.code, l.name])), [locList]);
  const nameOf = (code: string) => locByCode.get(code) || code;
  const locOptions: ROption[] = useMemo(() => locList.map((l) => ({ value: l.code, label: l.name || l.code, sub: l.name ? l.code : undefined })), [locList]);
  const sameByLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sameLocs) m.set(s.location, (m.get(s.location) ?? 0) + (Number.parseFloat(s.qty) || 0));
    return Array.from(m, ([location, qty]) => ({ location, qty: String(qty) })).sort((a, b) => Number(b.qty) - Number(a.qty));
  }, [sameLocs]);

  // Deep-link from the transfer dashboard (?doc=) → auto-open that doc once.
  useEffect(() => {
    if (autoOpened.current) return;
    const d = searchParams.get("doc");
    if (d) { autoOpened.current = true; void openDoc(d); }
  }, [searchParams, openDoc]);

  const serialsByItem = useMemo(() => {
    const m = new Map<string, SerialRow[]>();
    for (const s of serials) { const a = m.get(s.item_code) ?? []; a.push(s); m.set(s.item_code, a); }
    return m;
  }, [serials]);
  const serialOwner = useMemo(() => {
    const m = new Map<string, string>(); // serial id → item_code
    for (const s of serials) m.set(s.id, s.item_code);
    return m;
  }, [serials]);

  const handleScan = useCallback((raw: string) => {
    const id = raw.trim();
    if (!id) return;
    const item = serialOwner.get(id);
    if (!item) { setMsg({ tone: "err", text: `serial ${id} ບໍ່ຢູ່ໃນສາງລະຫວ່າງທາງຂອງໃບนี้` }); setScan(""); return; }
    setPicked((p) => {
      const cur = new Set(p[item] ?? []);
      if (cur.has(id)) { setMsg({ tone: "err", text: `serial ${id} ເລືອກໄປແລ້ວ` }); return p; }
      cur.add(id);
      const next = { ...p, [item]: cur };
      setQty((qq) => ({ ...qq, [item]: cur.size }));
      setMsg({ tone: "ok", text: `+ ${id}` });
      return next;
    });
    setScan("");
  }, [serialOwner]);

  const toggleSerial = (item: string, id: string) => {
    setPicked((p) => {
      const cur = new Set(p[item] ?? []);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      setQty((qq) => ({ ...qq, [item]: cur.size }));
      return { ...p, [item]: cur };
    });
  };

  const payloadLines = useMemo(() => lines.map((l) => {
    const ser = [...(picked[l.item_code] ?? [])];
    const q = l.serialized ? ser.length : (qty[l.item_code] ?? 0);
    return { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: q, serials: ser, location: putMode === "line" ? (locByLine[l.item_code] || null) : null };
  }).filter((l) => l.qty > 0), [lines, picked, qty, putMode, locByLine]);

  const overSome = lines.some((l) => !l.serialized && (qty[l.item_code] ?? 0) > (Number.parseFloat(l.in_transit) || 0) + 1e-6);
  const canSubmit = payloadLines.length > 0 && !overSome && !submitting;

  const submit = async () => {
    if (!sel || !canSubmit) return;
    setSubmitting(true); setMsg(null);
    try {
      const notes = lines.map((l) => {
        const got = l.serialized ? (picked[l.item_code]?.size ?? 0) : (qty[l.item_code] ?? 0);
        const inT = Number.parseFloat(l.in_transit) || 0;
        const code = reasons[l.item_code];
        return got < inT - 1e-6 && code ? { item_code: l.item_code, reason_code: code, short_qty: inT - got } : null;
      }).filter(Boolean);
      const r = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: sel, location_to: putMode === "all" ? (locTo || null) : null, lines: payloadLines, notes }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ tone: "err", text: j.error || "ບໍ່ສຳເລັດ" }); setSubmitting(false); return; }
      setMsg({ tone: "ok", text: `${t.verb}สำเร็จ · WMS ${j.wmsDoc} · ERP ${j.erpDoc}` });
      setLastDoc(j.wmsDoc ?? null);
      await loadList();
      await openDoc(sel); // refresh remaining; if 0 left it drops out of the list
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳเรັจ" });
    }
    setSubmitting(false);
  };

  if (sel) {
    const fmtName = mode === "receive" ? header?.wh_from_name : header?.wh_to_name;
    const toName = mode === "receive" ? header?.wh_to_name : header?.wh_from_name;
    const totalInT = lines.reduce((acc, l) => acc + (Number.parseFloat(l.in_transit) || 0), 0);
    const totalGot = lines.reduce((acc, l) => acc + (l.serialized ? (picked[l.item_code]?.size ?? 0) : (qty[l.item_code] ?? 0)), 0);
    const pct = totalInT > 0 ? Math.min(100, Math.round((totalGot / totalInT) * 100)) : 0;
    return (
      <div className="space-y-4 pb-24">
        <button onClick={() => { setSel(null); setMsg(null); }} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">← ກັບໄປລາຍกານ</button>

        {/* header */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 to-transparent px-5 py-4">
            <div className="min-w-0">
              <div className="font-mono text-lg font-black tracking-tight text-slate-800">{sel}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{fmtName ?? (mode === "receive" ? header?.wh_from : header?.wh_to)}</span>
                <span className="text-slate-300">→</span>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{t.landing} {toName}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t.verb} ແລ້ວ</div>
              <div className="font-mono text-3xl font-black leading-none text-emerald-600">{totalGot}<span className="text-lg text-slate-300">/{totalInT}</span></div>
              <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
          <div className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-500">📍 ບ່ອນຈັດເກັບປາຍທາງ:</label>
              <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                {([["all", "ທັງໝົດ"], ["line", "ທີ່ລະລາຍການ"]] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setPutMode(m)} className={`rounded px-3 py-1 transition cursor-pointer ${putMode === m ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>{label}</button>
                ))}
              </div>
            </div>
            {putMode === "all"
              ? <PutawayPicker allowPallet={false} dest="location" onDest={() => {}}
                  locValue={locTo} onLoc={setLocTo} locOptions={locOptions}
                  same={sameByLoc} empty={emptyLocs} nameOf={nameOf} />
              : <p className="text-[11px] text-slate-400">ເລືອກ location ແຍກໃນແຕ່ລະລາຍການດ້ານລຸ່ມ</p>}
          </div>
        </div>

        {/* big scan */}
        {lines.some((l) => l.serialized) && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3.5">
            <label className="mb-1 block text-[11px] font-bold text-emerald-700">🔫 ຍິງ / ປ້ອນ serial ทີ່ {t.verb} ຈິງ ແລ້ວ Enter</label>
            <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(scan); } }}
              autoFocus placeholder="scan SN / ISN …"
              className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </div>
        )}

        {/* items */}
        <div className="space-y-3">
          {lines.map((l) => {
            const inT = Number.parseFloat(l.in_transit) || 0;
            const pick = picked[l.item_code] ?? new Set<string>();
            const got = l.serialized ? pick.size : (qty[l.item_code] ?? 0);
            const over = !l.serialized && got > inT + 1e-6;
            const short = got < inT - 1e-6;
            const lp = inT > 0 ? Math.min(100, Math.round((got / inT) * 100)) : 0;
            return (
              <div key={l.item_code} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${got > 0 ? "border-emerald-300" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-slate-400">{l.item_code}{l.serialized && <span className="ml-1.5 rounded bg-violet-100 px-1 text-[9px] font-bold text-violet-700">SN</span>}</div>
                    <div className="truncate font-medium text-slate-800" title={l.item_name ?? ""}>{l.item_name ?? l.item_code}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] uppercase text-slate-400">ຄ້າງ</div>
                    <div className="font-mono text-lg font-black text-amber-600">{inT}<span className="text-xs text-slate-400"> {l.unit_code ?? ""}</span></div>
                  </div>
                </div>
                <div className="px-4"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${got >= inT && inT > 0 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${lp}%` }} /></div></div>
                <div className="flex flex-wrap items-center gap-2 p-4 pt-3">
                  {l.serialized ? (
                    <button onClick={() => { setPickerFor(l.item_code); setModalScan(""); setTimeout(() => modalScanRef.current?.focus(), 50); }}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold ring-1 transition cursor-pointer ${pick.size > 0 ? "bg-emerald-600 text-white ring-emerald-600" : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"}`}>
                      📦 ເລືອກ / ຍິງ ISN · {pick.size}/{inT}
                    </button>
                  ) : (
                    <>
                      <label className="text-xs font-semibold text-slate-500">{t.verb} ຈິງ</label>
                      <input type="number" min={0} max={inT} value={qty[l.item_code] ?? 0}
                        onChange={(e) => setQty((q) => ({ ...q, [l.item_code]: Math.max(0, Number.parseFloat(e.target.value) || 0) }))}
                        className={`w-24 rounded-lg border px-3 py-1.5 text-center font-mono text-sm font-bold ${over ? "border-red-400 bg-red-50 text-red-600" : "border-slate-300"}`} />
                      {over && <span className="text-xs font-bold text-red-500">ເກີນຄ້າງ</span>}
                    </>
                  )}
                  {short && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="text-xs font-bold text-amber-600">ຂາດ {inT - got} →</span>
                      <select value={reasons[l.item_code] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [l.item_code]: e.target.value }))}
                        className="rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1.5 text-xs text-slate-700 outline-none">
                        <option value="">ເຫດຜລ (ຖ້າรັບບໍ່ຄົບ)…</option>
                        {MOVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                {putMode === "line" && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <div className="mb-1.5 text-[11px] font-bold text-slate-500">📍 ບ່ອນຈັດເກັບ</div>
                    <PutawayPicker allowPallet={false} dest="location" onDest={() => {}}
                      locValue={locByLine[l.item_code] || ""} onLoc={(v) => setLocByLine((p) => ({ ...p, [l.item_code]: v }))}
                      locOptions={locOptions}
                      same={sameLocs.filter((s) => s.item_code === l.item_code).map((s) => ({ location: s.location, qty: s.qty }))}
                      empty={emptyLocs} nameOf={nameOf} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {msg && (
          <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
            <span>{msg.text}</span>
            {msg.tone === "ok" && lastDoc && (
              <a href={`/print/wms/${encodeURIComponent(lastDoc)}?auto=1`} target="_blank" rel="noopener"
                className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">🖨 ພິมໃບຮັບ</a>
            )}
          </div>
        )}

        {/* sticky footer */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-600">รధม {t.verb} {totalGot}/{totalInT}</span>
            <button onClick={submit} disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-7 py-3 text-sm font-bold text-white shadow-md hover:shadow-lg active:scale-98 transition disabled:opacity-50 cursor-pointer">
              {submitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "✓"}
              {t.btn}
            </button>
          </div>
        </div>

        {/* ── ISN picker modal (two-pane: ເລືອກແລ້ວ | ຍັງເຫຼືອ) ── */}
        {pickerFor && (() => {
          const line = lines.find((l) => l.item_code === pickerFor);
          const all = serialsByItem.get(pickerFor) ?? [];
          const pick = picked[pickerFor] ?? new Set<string>();
          const cap = line ? Number.parseFloat(line.in_transit) || 0 : 0;
          const term = modalScan.trim().toLowerCase();
          const remain = all.filter((s) => !pick.has(s.id) && (!term || s.id.toLowerCase().includes(term)));
          const tryScan = (raw: string) => {
            const id = raw.trim();
            if (!id) return;
            const hit = all.find((s) => s.id === id) ?? all.find((s) => s.id.toLowerCase() === id.toLowerCase());
            if (!hit) { setMsg({ tone: "err", text: `serial ${id} ບໍ່ຢູ່ໃນສາງລະຫວ່າງທາງຂອງສິນຄ້ານີ້` }); setModalScan(""); return; }
            if (pick.has(hit.id)) { setMsg({ tone: "err", text: `${hit.id} ເລືອກໄປແລ້ວ` }); setModalScan(""); return; }
            toggleSerial(pickerFor, hit.id); setModalScan("");
          };
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md" onClick={() => setPickerFor(null)}>
              <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-150 bg-slate-50/60 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-1 inline-block rounded border border-emerald-100 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-black text-emerald-700">{pickerFor}</div>
                      <div className="truncate text-xs font-extrabold text-slate-800">{line?.item_name}</div>
                    </div>
                    <button onClick={() => setPickerFor(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 cursor-pointer">✕</button>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-500">ຄ້າງໃນສາງລະຫວ່າງທາງ: <span className="font-mono text-slate-800">{cap}</span></span>
                    <span className="rounded-full bg-emerald-600 px-3 py-1 font-extrabold text-white">{t.verb}: {pick.size} / {all.length}</span>
                  </div>
                </div>
                <div className="border-b border-slate-100 bg-white p-3.5">
                  <div className="mb-1.5 text-[11px] font-bold text-slate-500">ຍິງ / ພິມ SN ຫຼື ISN ແລ້ວ Enter</div>
                  <div className="flex items-center gap-2">
                    <input ref={modalScanRef} autoFocus value={modalScan} onChange={(e) => setModalScan(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tryScan(modalScan); } }}
                      placeholder="ຍິງ barcode ຫຼື ພິມ ISN ແລ້ວ Enter..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20" />
                    <button onClick={() => tryScan(modalScan)} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95 cursor-pointer">ເພີ່ມ</button>
                  </div>
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-slate-100 overflow-hidden">
                  <div className="flex min-h-0 flex-col">
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">ເລືອກ {t.verb} · {pick.size}/{all.length}</div>
                    <div className="min-h-0 flex-1 overflow-auto p-1.5">
                      {pick.size === 0 ? <p className="py-6 text-center text-[11px] text-slate-400">ຍັງບໍ່ມີ — ຍິງ / ເລືອກ SN</p> :
                        [...pick].map((id) => {
                          const o = all.find((s) => s.id === id);
                          return (
                            <div key={id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-slate-50">
                              <span className="truncate font-mono text-[11px] font-bold text-slate-800">{o?.isn ?? id}</span>
                              <button onClick={() => toggleSerial(pickerFor, id)} className="shrink-0 rounded px-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer">✕</button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-500">ຍັງເຫຼືອ {remain.length} — ກົດ / ຍິງ ເພີ່ມ</div>
                    <div className="min-h-0 flex-1 overflow-auto p-1.5">
                      {remain.length === 0 ? <p className="py-6 text-center text-[11px] text-slate-400">{all.length === 0 ? "ບໍ່ມີ serial" : "ໝົດແລ້ວ / ບໍ່ພົບ"}</p> :
                        remain.map((s) => (
                          <button key={s.id} onClick={() => toggleSerial(pickerFor, s.id)}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition hover:bg-emerald-50">
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-[11px] font-bold text-slate-700">{s.sn || s.id}</span>
                              {s.isn && <span className="block text-[9px] text-slate-400">ISN: {s.isn}</span>}
                            </span>
                            <span className="shrink-0 text-[10px] font-bold text-emerald-500">+</span>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-150 bg-white px-5 py-3">
                  <span className="text-xs font-bold text-slate-500">{t.verb} {pick.size} SN</span>
                  <button onClick={() => setPickerFor(null)} className="rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:shadow-lg active:scale-95 transition cursor-pointer">ສຳເລັດ ({pick.size})</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {(["pending", "history"] as const).map((k) => (
          <button key={k} onClick={() => setView(k)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition cursor-pointer ${view === k ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>
            {k === "pending" ? `ຄ້າງ${t.verb} (${docs.length})` : "ປະຫວັດ"}
          </button>
        ))}
      </div>

      {view === "history" ? (
        history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">ຍັງບໍ່ມີປະຫວັດ</div>
        ) : history.map((d) => (
          <div key={d.doc_no} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="font-mono text-sm font-bold text-slate-800">{d.doc_no}</div>
              <div className="text-xs text-slate-500">{d.wh_name} · ອ້າງອີງ {d.doc_ref} · {d.doc_date}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{Number.parseFloat(d.qty)} ใน {d.items} ລາຍการ</span>
              <a href={`/print/wms/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener"
                className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">🖨 ພິມ</a>
            </div>
          </div>
        ))
      ) : loading ? (
        <div className="py-12 text-center text-sm text-slate-400">ກຳລັງໂຫລດ…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">{t.empty}</div>
      ) : (
        docs.map((d) => (
          <button key={d.doc_no} onClick={() => openDoc(d.doc_no)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer">
            <div>
              <div className="font-bold text-slate-800">{d.doc_no}</div>
              <div className="text-xs text-slate-500">
                {d.wh_from_name ?? d.wh_from} → {d.wh_to_name ?? d.wh_to} · {d.doc_date}
              </div>
            </div>
            <div className="text-right">
              <div className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">ຄ້າງ {Number.parseFloat(d.in_transit)} ໃນ {d.items} ລາຍการ</div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
