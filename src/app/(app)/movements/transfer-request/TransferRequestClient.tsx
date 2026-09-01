"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import RSelect, { type ROption } from "@/components/ui/RSelect";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";
import StockLocationsDrawer from "./StockLocationsDrawer";

export type WarehouseOption = { code: string; name: string | null };
type Hit = { item_code: string; item_name: string | null; unit_code: string | null; wh_balance: string | null };
type ShelfOption = { code: string; name: string | null; is_defect: boolean; is_damage: boolean };
type Line = { item_code: string; item_name: string | null; unit_code: string | null; qty: string; shelfFrom: string; shelfTo: string };

type ReqDoc = { doc_no: string; doc_date: string | null; doc_time: string | null; wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null; remark: string | null; status: number | null; want_date: string | null; line_count: number; pulled: number; req_qty: string; to_transit: string; in_transit: string; received: string };

type StatusInfo = { key: "await" | "rejected" | "wait" | "pulled" | "issuing" | "transit" | "partial" | "done"; label: string; cls: string };
function statusOf(d: ReqDoc): StatusInfo {
  const req = Number.parseFloat(d.req_qty) || 0, toT = Number.parseFloat(d.to_transit) || 0;
  const inT = Number.parseFloat(d.in_transit) || 0, rcv = Number.parseFloat(d.received) || 0;
  const amber = "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300";
  // Approval gate first (ic_trans.status): 0 = awaiting approval, 2 = rejected.
  if ((d.status ?? 0) === 0) return { key: "await", label: "ລໍຖ້າອະນຸມັດ", cls: amber };
  if ((d.status ?? 0) === 2) return { key: "rejected", label: "ຖືກປະຕິເສດ", cls: "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300" };
  if (req > 0 && rcv + 1e-6 >= req) return { key: "done", label: "ຮັບຄົບ ✓", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300" };
  if (inT > 0.0001) return { key: "transit", label: "ຄ້າງລະຫວ່າງທາງ", cls: amber };
  if (rcv > 0.0001) return { key: "partial", label: "ຮັບບາງສ່ວນ", cls: "bg-aqua-50 text-aqua-700 ring-1 ring-aqua-200 dark:bg-aqua-950/40 dark:text-aqua-300" };
  if (toT > 0.0001) return { key: "issuing", label: "ກຳລັງຈ່າຍ", cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300" };
  if (d.pulled > 0) return { key: "pulled", label: "ດຶງໄປແລ້ວ", cls: "bg-aqua-50 text-aqua-700 ring-1 ring-aqua-200 dark:bg-aqua-950/40 dark:text-aqua-300" };
  return { key: "wait", label: "ລໍຖ້າຈ່າຍ", cls: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400" };
}
type DetailLine = { item_code: string; item_name: string | null; unit_code: string | null; req_qty: string; issued: string; in_transit?: string; received?: string; remaining: string; shelf_from?: string | null; shelf_to?: string | null };

function ddmm(d: string | null) { if (!d) return "—"; const [y, m, day] = d.split("-"); return day ? `${day}-${m}-${y}` : d; }

export default function TransferRequestClient({ allWarehouses, destWarehouses, requester }: { allWarehouses: WarehouseOption[]; destWarehouses: WarehouseOption[]; requester: string }) {
  const today0 = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [statusTab, setStatusTab] = useState<"all" | "pending" | "done">("all");
  const [fromDate, setFromDate] = useState(ago30);
  const [toDate, setToDate] = useState(today0);
  const [docQuery, setDocQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [docs, setDocs] = useState<ReqDoc[]>([]);
  const [nextDoc, setNextDoc] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailByDoc, setDetailByDoc] = useState<Record<string, DetailLine[]>>({});
  const [notesByDoc, setNotesByDoc] = useState<Record<string, Record<string, string>>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [whTo, setWhTo] = useState(destWarehouses.length === 1 ? destWarehouses[0].code : "");
  const [whFrom, setWhFrom] = useState("");
  const [title, setTitle] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [wantDate, setWantDate] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [shelvesFrom, setShelvesFrom] = useState<ShelfOption[]>([]);
  const [shelvesTo, setShelvesTo] = useState<ShelfOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editDoc, setEditDoc] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [stockDrawer, setStockDrawer] = useState<{ code: string; name: string | null; shelf?: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 3000); }

  function newRequest() {
    setEditDoc(null); setLines([]); setTitle(""); setWantDate("");
    setWhFrom(""); setWhTo(destWarehouses.length === 1 ? destWarehouses[0].code : "");
    setMode("create");
  }

  async function startEdit(d: ReqDoc) {
    let dl = detailByDoc[d.doc_no];
    if (!dl) {
      const res = await fetch(`/api/movements/transfer-request?doc=${encodeURIComponent(d.doc_no)}`);
      const data = (await res.json()) as { lines?: DetailLine[] };
      dl = data.lines ?? [];
      setDetailByDoc((p) => ({ ...p, [d.doc_no]: dl! }));
    }
    setEditDoc(d.doc_no);
    setWhTo(d.wh_to ?? ""); setWhFrom(d.wh_from ?? "");
    setWantDate(d.want_date ?? ""); setTitle(d.remark ?? "");
    setLines(dl.map((l) => ({ item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: String(Number.parseFloat(l.req_qty) || 0), shelfFrom: l.shelf_from ?? "", shelfTo: l.shelf_to ?? "" })));
    setMode("create");
  }

  async function cancelRequest(docNo: string) {
    if (!confirm(`ຍົກເລີກໃບຂໍໂອນ ${docNo}?`)) return;
    setCancelling(docNo);
    try {
      const res = await fetch(`/api/movements/transfer-request?doc=${encodeURIComponent(docNo)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { showToast("err", data.error || "ຍົກເລີກບໍ່ສຳເລັດ"); return; }
      showToast("ok", `ຍົກເລີກ ${docNo} ແລ້ວ`);
      setExpanded(null);
      await loadList(page);
    } finally { setCancelling(null); }
  }

  async function loadList(pg = page) {
    setLoadingList(true);
    try {
      const p = new URLSearchParams({ from: fromDate, to: toDate, page: String(pg) });
      if (docQuery.trim()) p.set("q", docQuery.trim());
      const res = await fetch(`/api/movements/transfer-request?${p}`);
      const data = (await res.json()) as { docs?: ReqDoc[]; has_more?: boolean; next_doc_no?: string };
      setDocs(data.docs ?? []);
      setHasMore(Boolean(data.has_more));
      setNextDoc(data.next_doc_no ?? "");
      setPage(pg);
    } finally { setLoadingList(false); }
  }
  useEffect(() => { if (mode === "list") void loadList(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, fromDate, toDate]);

  async function toggleDetail(docNo: string) {
    if (expanded === docNo) { setExpanded(null); return; }
    setExpanded(docNo);
    if (!detailByDoc[docNo]) {
      const res = await fetch(`/api/movements/transfer-request?doc=${encodeURIComponent(docNo)}`);
      const data = (await res.json()) as { lines?: DetailLine[]; notes?: Record<string, string> };
      setDetailByDoc((p) => ({ ...p, [docNo]: data.lines ?? [] }));
      setNotesByDoc((p) => ({ ...p, [docNo]: data.notes ?? {} }));
    }
  }

  const toOpt = (w: WarehouseOption): ROption => ({ value: w.code, label: w.name ?? w.code, sub: w.code });
  const destOptions = useMemo(() => destWarehouses.map(toOpt), [destWarehouses]);
  const fromOptions = useMemo(() => allWarehouses.filter((w) => w.code !== whTo).map(toOpt), [allWarehouses, whTo]);
  const shelfOpt = (s: ShelfOption): ROption => ({ value: s.code, label: s.name || s.code, sub: s.code });
  const shelfFromOptions = useMemo(() => shelvesFrom.map(shelfOpt), [shelvesFrom]);
  const shelfToOptions = useMemo(() => shelvesTo.map(shelfOpt), [shelvesTo]);

  // Load the shelf (ສະພາບ/ທີ່ເກັບ) masters for the source + dest warehouses.
  useEffect(() => {
    if (!whFrom) { setShelvesFrom([]); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/movements/shelves?wh=${encodeURIComponent(whFrom)}`);
      const data = (await res.json()) as { shelves?: ShelfOption[] };
      if (!cancelled) setShelvesFrom(data.shelves ?? []);
    })();
    return () => { cancelled = true; };
  }, [whFrom]);
  useEffect(() => {
    if (!whTo) { setShelvesTo([]); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/movements/shelves?wh=${encodeURIComponent(whTo)}`);
      const data = (await res.json()) as { shelves?: ShelfOption[] };
      if (!cancelled) setShelvesTo(data.shelves ?? []);
    })();
    return () => { cancelled = true; };
  }, [whTo]);

  useEffect(() => {
    if (!search.trim() || !whFrom) { setHits([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/movements/items/search?warehouse=${encodeURIComponent(whFrom)}&q=${encodeURIComponent(search.trim())}&scope=any`);
      const data = (await res.json()) as { items?: Hit[]; error?: string };
      if (!res.ok) { showToast("err", data.error || "ຄົ້ນຫາບໍ່ສຳເລັດ"); setHits([]); return; }
      setHits(data.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, whFrom]);

  function applyRow1ShelfToAll() {
    if (lines.length === 0) return;
    const { shelfFrom, shelfTo } = lines[0];
    setLines((p) => p.map((x) => ({ ...x, shelfFrom, shelfTo })));
  }

  function addHit(h: Hit) {
    setHits([]); setSearch("");
    if (lines.some((l) => l.item_code === h.item_code)) { showToast("err", "ມີໃນລາຍການແລ້ວ"); return; }
    setLines((p) => [...p, { item_code: h.item_code, item_name: h.item_name, unit_code: h.unit_code, qty: "1", shelfFrom: "", shelfTo: "" }]);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function submit() {
    if (!whFrom || !whTo) { showToast("err", "ເລືອກສາງຕົ້ນທາງ + ປາຍທາງ"); return; }
    const ready = lines.filter((l) => (Number.parseFloat(l.qty) || 0) > 0);
    if (ready.length === 0) { showToast("err", "ກະລຸນາເພີ່ມສິນຄ້າ"); return; }
    setSubmitting(true);
    try {
      const payloadLines = ready.map((l) => ({ item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: Number.parseFloat(l.qty), shelf_from: l.shelfFrom || null, shelf_to: l.shelfTo || null }));
      const res = await fetch(`/api/movements/transfer-request`, {
        method: editDoc ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDoc
          ? { doc: editDoc, wh_from: whFrom, doc_ref: title, remark: title, want_date: wantDate || null, lines: payloadLines }
          : { wh_from: whFrom, wh_to: whTo, doc_ref: title, remark: title, want_date: wantDate || null, lines: payloadLines }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; doc_no?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", editDoc ? `ແກ້ໄຂ ${data.doc_no} ສຳເລັດ` : `ສ້າງໃບຂໍໂອນ ${data.doc_no} ສຳເລັດ`);
      setDetailByDoc((p) => { const n = { ...p }; if (editDoc) delete n[editDoc]; return n; });
      setLines([]); setTitle(""); setEditDoc(null);
      setMode("list");
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setSubmitting(false); }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400";

  // "ຈ່າຍແລ້ວ" = ຖືກດຶງໄປອອກໃບສັ່ງຈ່າຍ (pending draft) ຫຼື finalize (DP) ແລ້ວ.
  const isDone = (d: ReqDoc) => statusOf(d).key === "done";
  const counts = { all: docs.length, pending: docs.filter((d) => !isDone(d)).length, done: docs.filter(isDone).length };
  const filtered = docs.filter((d) => statusTab === "all" || (statusTab === "done" ? isDone(d) : !isDone(d)));
  // ແຍກກຸ່ມຕາມ "ສາງຜູ້ຂໍ" (wh_to) — ບໍ່ມີ dropdown ກອງສາງອີກແລ້ວ.
  const docGroups = groupByWarehouse(filtered, (d) => d.wh_to ?? "—", destWarehouses);

  if (mode === "list") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {([["all", "ທັງໝົດ"], ["pending", "ລໍຖ້າຈ່າຍ"], ["done", "ຈ່າຍແລ້ວ"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setStatusTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${statusTab === k ? "bg-white text-brand-600 shadow-sm dark:bg-zinc-950 dark:text-brand-400" : "text-zinc-500"}`}>
                {label} <span className="ml-0.5 text-[10px] opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={newRequest} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg">
            <PlusIcon className="h-4 w-4" /> ສ້າງໃບຂໍໂອນ
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="min-w-[170px]"><label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ (ຜູ້ຂໍ)</label>
            <div className={`${inputCls} flex items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{destWarehouses.length}</span>
            </div>
          </div>
          <div><label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ແຕ່ວັນທີ</label><input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} /></div>
          <div><label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຫາວັນທີ</label><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} /></div>
          <div className="min-w-[160px] flex-1"><label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ເລກທີເອກະສານ</label>
            <div className="relative"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input type="text" value={docQuery} onChange={(e) => setDocQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadList(0)} placeholder="ເຊັ່ນ FR2606..." className={`${inputCls} w-full pl-8`} /></div>
          </div>
          <button type="button" onClick={() => loadList(0)} disabled={loadingList} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">ກອງ</button>
        </div>
        {loadingList ? (
          <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-500">ບໍ່ມີໃບຂໍໂອນ{statusTab === "pending" ? " ລໍຖ້າຈ່າຍ" : statusTab === "done" ? " ທີ່ຈ່າຍແລ້ວ" : ""}</p>
            <p className="mt-1 text-xs text-zinc-400">ກົດ &quot;ສ້າງໃບຂໍໂອນ&quot; ເພື່ອເລີ່ມ</p>
          </div>
        ) : (
          <div className="space-y-7">
            {docGroups.map((g) => (
            <WarehouseGroup
              key={g.code}
              code={g.code}
              name={destWarehouses.find((w) => w.code === g.code)?.name}
              count={g.rows.length}
              countLabel="ໃບ"
              tone="brand"
            >
            <div className="space-y-2">
            {g.rows.map((d) => {
              const st = statusOf(d);
              const open = expanded === d.doc_no;
              const overdue = !!d.want_date && st.key !== "done" && d.want_date < new Date().toISOString().slice(0, 10);
              return (
                <div key={d.doc_no} className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                  <button type="button" onClick={() => toggleDetail(d.doc_no)} className="flex w-full flex-wrap items-center gap-3 p-3.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <ChevronRightIcon className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-brand-600 dark:text-brand-400">{d.doc_no}</span>
                        <span className="text-[11px] text-zinc-400">{ddmm(d.doc_date)} {d.doc_time}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                        {overdue && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300">ເກີນກຳນົດ {ddmm(d.want_date)}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        <span className="font-mono">{d.wh_from}</span> {d.wh_from_name ? `(${d.wh_from_name})` : ""} → <span className="font-mono">{d.wh_to}</span> {d.wh_to_name ? `(${d.wh_to_name})` : ""}
                        {d.remark ? ` · ${d.remark}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-zinc-500">{d.line_count} ລາຍການ</div>
                  </button>
                  {open && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800">
                      {!detailByDoc[d.doc_no] ? (
                        <div className="py-4 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2">ສິນຄ້າ</th><th className="px-4 py-2 text-right">ຂໍ</th><th className="px-4 py-2 text-right">ຈ່າຍແລ້ວ</th><th className="px-4 py-2 text-right">ຄ້າງທາງ</th><th className="px-4 py-2 text-right">ຮັບແລ້ວ</th><th className="px-4 py-2 text-right">ຍັງເຫຼືອ</th></tr></thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {detailByDoc[d.doc_no].map((ln) => {
                              const rem = Number.parseFloat(ln.remaining) || 0;
                              const inT = Number.parseFloat(ln.in_transit ?? "0") || 0;
                              const rcv = Number.parseFloat(ln.received ?? "0") || 0;
                              return (
                                <tr key={ln.item_code}>
                                  <td className="px-4 py-2"><span className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{ln.item_code}</span><div className="max-w-md truncate text-[13px] text-zinc-700 dark:text-zinc-300">{ln.item_name}</div>{(ln.shelf_from || ln.shelf_to) && <div className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">ສະພາບ: <span className="font-mono">{ln.shelf_from ?? "—"}</span> → <span className="font-mono">{ln.shelf_to ?? "—"}</span></div>}{notesByDoc[d.doc_no]?.[ln.item_code] && <div className="mt-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">⚠ {notesByDoc[d.doc_no][ln.item_code]}</div>}</td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums">{ln.req_qty}<span className="ml-1 text-[10px] text-zinc-400">{ln.unit_code}</span></td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{ln.issued}</td>
                                  <td className={`px-4 py-2 text-right font-mono tabular-nums ${inT > 0.0001 ? "font-bold text-amber-600 dark:text-amber-400" : "text-zinc-400"}`}>{inT > 0.0001 ? inT : "—"}</td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums text-aqua-600 dark:text-aqua-400">{rcv > 0.0001 ? rcv : "—"}</td>
                                  <td className={`px-4 py-2 text-right font-mono font-bold tabular-nums ${rem > 0.0001 ? "text-zinc-500" : "text-zinc-400"}`}>{ln.remaining}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {(st.key === "wait" || st.key === "await" || st.key === "rejected") && (
                        <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                          <button type="button" onClick={() => startEdit(d)}
                            className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-600 ring-1 ring-brand-200 transition hover:bg-brand-100 cursor-pointer dark:bg-brand-950/30 dark:text-brand-300 dark:ring-brand-900/40">
                            ແກ້ໄຂ
                          </button>
                          <button type="button" disabled={cancelling === d.doc_no}
                            onClick={() => cancelRequest(d.doc_no)}
                            className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-50 cursor-pointer dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/40">
                            {cancelling === d.doc_no ? "ກຳລັງຍົກເລີກ…" : "ຍົກເລີກໃບຂໍ"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            </WarehouseGroup>
            ))}
          </div>
        )}
        {(page > 0 || hasMore) && (
          <div className="flex items-center justify-center gap-3">
            <button type="button" disabled={page === 0 || loadingList} onClick={() => loadList(page - 1)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:ring-zinc-800">← ກ່ອນ</button>
            <span className="text-xs text-zinc-500">ໜ້າ {page + 1}</span>
            <button type="button" disabled={!hasMore || loadingList} onClick={() => loadList(page + 1)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:ring-zinc-800">ຕໍ່ໄປ →</button>
          </div>
        )}
        {toast && (
          <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
            <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.k === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.k === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.t}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => { setMode("list"); setEditDoc(null); }} className="text-sm font-semibold text-zinc-500 hover:text-zinc-700">← ກັບໄປລາຍການ</button>
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {/* Read-only header: doc_no / date / requester */}
        <div className="mb-3 grid gap-3 rounded-xl bg-zinc-50/60 p-3 sm:grid-cols-3 dark:bg-zinc-950/30">
          <div><div className={labelCls}>ເລກທີ ໃບຂໍໂອນ {editDoc && <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700">ແກ້ໄຂ</span>}</div><div className="font-mono text-sm font-bold text-brand-600 dark:text-brand-400">{editDoc || nextDoc || "—"}</div></div>
          <div><div className={labelCls}>ວັນທີ</div><div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{today.split("-").reverse().join("-")}</div></div>
          <div><div className={labelCls}>ຜູ້ຂໍໂອນ</div><div className="truncate text-sm font-semibold text-zinc-700 dark:text-zinc-200">{requester || "—"}</div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>ສາງທີ່ຮັບຜິດຊອບ (ຜູ້ຂໍ) *</label>
            {editDoc ? (
              <div className={`${inputCls} w-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800`}>{destWarehouses.find((w) => w.code === whTo)?.name ?? whTo}</div>
            ) : (
              <RSelect value={whTo} options={destOptions} onChange={setWhTo} placeholder="ຄົ້ນຫາ/ເລືອກ ສາງ..." />
            )}
          </div>
          <div>
            <label className={labelCls}>ສາງທີ່ຕ້ອງການໂອນຂອງມາ (source) *</label>
            <RSelect value={whFrom} options={fromOptions} onChange={(v) => { setWhFrom(v); setLines([]); }} placeholder="ຄົ້ນຫາ/ເລືອກ ສາງ source..." />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>ວັນທີ່ຕ້ອງການຮັບສິນຄ້າ</label>
            <input type="date" value={wantDate} min={today} onChange={(e) => setWantDate(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className={labelCls}>ໝາຍເຫດ / ເຫດຜົນ</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ເຊັ່ນ: ຂໍໂອນເຄື່ອງມື..." className={`${inputCls} w-full`} />
          </div>
        </div>
      </section>

      {whFrom && (
        <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ຄົ້ນຫາ ສິນຄ້າ ທີ່ຈະຂໍ (ຈາກສາງ source)..." className={`${inputCls} w-full pl-9`} />
            {hits.length > 0 && (
              <div className="absolute inset-x-0 top-[calc(100%+0.3rem)] z-30 max-h-72 overflow-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                {hits.map((h) => (
                  <div key={h.item_code} className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/70">
                    <button type="button" onClick={() => addHit(h)} className="flex min-w-0 flex-1 items-center gap-3">
                      <PlusIcon className="h-4 w-4 shrink-0 text-brand-500" />
                      <div className="min-w-0 flex-1"><div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{h.item_code}</div><div className="truncate text-xs">{h.item_name}</div></div>
                    </button>
                    <button type="button" onClick={() => setStockDrawer({ code: h.item_code, name: h.item_name })} title="ເບິ່ງສະຕັອກທຸກສາງ" className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-brand-600 dark:hover:text-brand-400">ມີ {h.wh_balance ?? "0"} · {h.unit_code}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">ຄົ້ນຫາ + ເພີ່ມສິນຄ້າທີ່ຈະຂໍໂອນ</div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2.5">ສິນຄ້າ</th><th className="px-4 py-2.5 text-center">ຈຳນວນຂໍ</th><th className="px-3 py-2.5">
                  ສະພາບ (ຈາກ)
                  {lines.length > 1 && (lines[0].shelfFrom || lines[0].shelfTo) && (
                    <button type="button" onClick={applyRow1ShelfToAll} title="ໃຊ້ສະພາບຂອງແຖວ 1 ກັບທຸກລາຍການ" className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold normal-case text-brand-600 hover:bg-brand-100 dark:bg-brand-950/30 dark:text-brand-300">ໃຊ້ຄືແຖວ 1 ທຸກລາຍການ</button>
                  )}
                </th><th className="px-3 py-2.5">ສະພາບ (ເຂົ້າ)</th><th className="w-8" /></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {lines.map((l, i) => (
                    <tr key={l.item_code}>
                      <td className="px-4 py-2.5"><button type="button" onClick={() => setStockDrawer({ code: l.item_code, name: l.item_name, shelf: l.shelfFrom })} title="ເບິ່ງສະຕັອກທຸກສາງ" className="font-mono text-[11px] font-bold text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700 dark:text-brand-400">{l.item_code}</button><div className="max-w-md truncate text-[13px]">{l.item_name}</div></td>
                      <td className="px-4 py-2.5 text-center"><input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLines((p) => p.map((x) => x.item_code === l.item_code ? { ...x, qty: e.target.value } : x))} className="w-24 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800" /><span className="ml-1 text-[10px] text-zinc-400">{l.unit_code}</span></td>
                      <td className="px-3 py-2.5">
                        <div className="min-w-[160px]"><RSelect size="sm" value={l.shelfFrom} options={shelfFromOptions} onChange={(v) => setLines((p) => p.map((x) => x.item_code === l.item_code ? { ...x, shelfFrom: v } : x))} placeholder="— ສະພາບ —" /></div>
                        {i > 0 && (lines[0].shelfFrom || lines[0].shelfTo) && (l.shelfFrom !== lines[0].shelfFrom || l.shelfTo !== lines[0].shelfTo) && (
                          <button type="button" onClick={() => setLines((p) => p.map((x) => x.item_code === l.item_code ? { ...x, shelfFrom: lines[0].shelfFrom, shelfTo: lines[0].shelfTo } : x))} className="mt-1 text-[10px] font-semibold text-brand-500 underline decoration-dotted underline-offset-2 hover:text-brand-700 dark:text-brand-400">
                            ໃຊ້ຄືແຖວ 1
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5"><div className="min-w-[160px]"><RSelect size="sm" value={l.shelfTo} options={shelfToOptions} onChange={(v) => setLines((p) => p.map((x) => x.item_code === l.item_code ? { ...x, shelfTo: v } : x))} placeholder="— ສະພາບ —" /></div></td>
                      <td className="px-2 py-2.5 text-right"><button type="button" onClick={() => setLines((p) => p.filter((x) => x.item_code !== l.item_code))} className="rounded p-1 text-zinc-300 hover:text-rose-500">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-3">
            {lines.length > 0 && <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">{lines.length} ລາຍການ</span>}
            <button type="button" onClick={submit} disabled={submitting || lines.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50"><CheckIcon className="h-4 w-4" />{submitting ? "ກຳລັງສ້າງ..." : "ສ້າງໃບຂໍໂອນ"}</button>
          </div>
        </section>
      )}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.k === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.k === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.t}</div>
        </div>
      )}
      <StockLocationsDrawer open={!!stockDrawer} itemCode={stockDrawer?.code ?? ""} itemName={stockDrawer?.name ?? null} highlightWh={whFrom || undefined} highlightLocation={stockDrawer?.shelf || undefined} onClose={() => setStockDrawer(null)} />
    </div>
  );
}
