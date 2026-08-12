"use client";

import { useEffect, useRef, useState } from "react";
import { WarehouseGroupHeader, groupByWarehouse } from "@/components/ui/WarehouseGroup";
import { MOVE_REASONS } from "@/lib/moveReasons";

export type WarehouseOption = { code: string; name: string | null };
type Hit = { wh_code: string; item_code: string; item_name: string | null; unit_code: string | null; wh_balance?: string | null };
type Line = { item_code: string; item_name: string | null; unit_code: string | null; qty: string; location: string; serials: string[]; serialInput: string };

export default function SaleReturnClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  // ບໍ່ມີ dropdown ເລືອກສາງ — ຄົ້ນຫາສິນຄ້າໄດ້ທຸກສາງ, ຜົນລັບແຍກກຸ່ມຕາມສາງ;
  // ສາງປາຍທາງຂອງໃບຮັບຄືນ ຖືກກຳນົດຈາກແຖວທຳອິດທີ່ເລືອກ (1 ໃບ = 1 ສາງ).
  const [wh, setWh] = useState("");
  const [cust, setCust] = useState("");
  const [refInv, setRefInv] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastDoc, setLastDoc] = useState<string | null>(null);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const show = (k: "ok" | "err", t: string) => { setToast({ k, t }); setTimeout(() => setToast(null), 3500); };

  // ຄົ້ນຫາໃນທຸກສາງທີ່ມີສິດ; ຖ້າມີແຖວແລ້ວ ຈຳກັດຢູ່ສາງຂອງໃບນີ້ (1 ໃບ = 1 ສາງ).
  useEffect(() => {
    if (!search.trim()) { setHits([]); return; }
    const scope = wh ? warehouses.filter((w) => w.code === wh) : warehouses;
    const t = setTimeout(async () => {
      const all = await Promise.all(
        scope.map(async (w) => {
          const r = await fetch(`/api/movements/items/search?warehouse=${encodeURIComponent(w.code)}&q=${encodeURIComponent(search.trim())}`);
          const j = (await r.json()) as { items?: Omit<Hit, "wh_code">[] };
          return (j.items ?? []).map((it) => ({ ...it, wh_code: w.code }));
        }),
      );
      setHits(all.flat());
    }, 250);
    return () => clearTimeout(t);
  }, [search, wh, warehouses]);

  const hitGroups = groupByWarehouse(hits, (h) => h.wh_code, warehouses);

  const addHit = (h: Hit) => {
    setHits([]); setSearch("");
    if (!wh) setWh(h.wh_code);
    if (lines.some((l) => l.item_code === h.item_code)) { show("err", "ມີໃນລາຍການແລ້ວ"); return; }
    setLines((p) => [{ item_code: h.item_code, item_name: h.item_name, unit_code: h.unit_code, qty: "1", location: "", serials: [], serialInput: "" }, ...p]);
    setTimeout(() => searchRef.current?.focus(), 50);
  };
  const upd = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const remove = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));
  const addSerial = (i: number) => setLines((p) => p.map((l, idx) => {
    if (idx !== i) return l;
    const id = l.serialInput.trim();
    if (!id || l.serials.includes(id)) return { ...l, serialInput: "" };
    return { ...l, serials: [...l.serials, id], serialInput: "", qty: String(l.serials.length + 1) };
  }));
  const rmSerial = (i: number, sn: string) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, serials: l.serials.filter((s) => s !== sn) } : l));

  const submit = async () => {
    if (!wh) { show("err", "ເລືອກສາງ"); return; }
    const ready = lines.filter((l) => (Number.parseFloat(l.qty) || 0) > 0);
    if (ready.length === 0) { show("err", "ເພີ່ມສິນຄ້າ"); return; }
    setSubmitting(true); setLastDoc(null);
    try {
      const r = await fetch("/api/movements/sale-return", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh, cust_code: cust || null, ref_invoice: refInv || null, reason: reason || null,
          lines: ready.map((l) => ({ item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: Number.parseFloat(l.qty), location: l.location || null, serials: l.serials })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "ບໍ່ສຳເລັດ");
      show("ok", `ຮັບคืนสำเร็จ · ${j.doc_no} · ${j.lines} ລາຍການ`);
      setLastDoc(j.doc_no); setLines([]); setCust(""); setRefInv(""); setReason("");
    } catch (e) { show("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    setSubmitting(false);
  };

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-aqua-500";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">ສາງที่รับคืนเข้า</label>
            {wh ? (
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-aqua-50 px-3 py-2 font-mono text-sm font-black text-aqua-700 ring-1 ring-aqua-200">{wh}</span>
                <span className="truncate text-sm font-bold text-slate-600">{warehouses.find((w) => w.code === wh)?.name ?? ""}</span>
                <button type="button" onClick={() => { setWh(""); setLines([]); }} className="rounded p-1 text-slate-300 hover:text-rose-500" title="ປ່ຽນສາງ">✕</button>
              </div>
            ) : (
              <p className={`${inputCls} text-slate-500`}>ຄົ້ນຫາສິນຄ້າດ້ານລຸ່ມ — ສາງມາຈາກແຖວທີ່ເລືອກ</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">ລະຫัสลูกค้า (ถ้ามี)</label>
            <input value={cust} onChange={(e) => setCust(e.target.value)} placeholder="cust_code" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">ບິลขายเดิม (ref)</label>
            <input value={refInv} onChange={(e) => setRefInv(e.target.value)} placeholder="INHPB..." className={`${inputCls} w-full`} />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">ເຫດผลรับคืน</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} w-full max-w-xs`}>
            <option value="">— ເລືອກ —</option>
            {MOVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>
      </section>

      {(
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="relative">
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ຄົ້ນຫາ ສິນຄ້າ ເພື່ອเพิ่ม…" className={`${inputCls} w-full`} />
            {hits.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {hitGroups.map((g) => (
                  <div key={g.code}>
                    <WarehouseGroupHeader
                      code={g.code}
                      name={warehouses.find((w) => w.code === g.code)?.name}
                      count={g.rows.length}
                      countLabel="ລາຍການ"
                      tone="aqua"
                    />
                    {g.rows.map((h) => (
                      <button key={`${h.wh_code}-${h.item_code}`} onClick={() => addHit(h)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-aqua-50">
                        <span><span className="font-mono text-xs font-bold text-aqua-600">{h.item_code}</span> <span className="text-slate-600">{h.item_name}</span></span>
                        <span className="text-[10px] text-slate-400">{h.unit_code}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">ຍັງບໍ່ມີລາຍການ — ຄົ້ນຫາ ເພື່ອเพิ่ม</p>
            ) : lines.map((l, i) => (
              <div key={l.item_code} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-aqua-600">{l.item_code}</div>
                    <div className="truncate text-sm text-slate-700">{l.item_name}</div>
                  </div>
                  <button onClick={() => remove(i)} className="rounded p-1 text-slate-300 hover:text-rose-500">✕</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-500">ຈำนวน</label>
                  <input type="number" min={0} value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} className={`${inputCls} w-24`} />
                  <label className="text-xs text-slate-500">location</label>
                  <input value={l.location} onChange={(e) => upd(i, { location: e.target.value })} placeholder="ບ່ອນຈັດເກັບ" className={`${inputCls} w-40`} />
                </div>
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <input value={l.serialInput} onChange={(e) => upd(i, { serialInput: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSerial(i); } }}
                      placeholder="ຍິງ / ພິມ SN ແລ້ວ Enter (ถ้ามี serial)" className={`${inputCls} flex-1 font-mono text-xs`} />
                    <button onClick={() => addSerial(i)} className="rounded-lg bg-aqua-600 px-3 py-2 text-xs font-bold text-white hover:bg-aqua-700">ເພີ່ມ SN</button>
                  </div>
                  {l.serials.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {l.serials.map((sn) => (
                        <span key={sn} className="inline-flex items-center gap-1 rounded-md bg-aqua-50 px-2 py-0.5 font-mono text-[11px] text-aqua-700 ring-1 ring-aqua-200">
                          {sn}<button onClick={() => rmSerial(i, sn)} className="text-rose-400 hover:text-rose-600">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            {lastDoc && <a href={`/print/wms/${encodeURIComponent(lastDoc)}?auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">🖨 ພິมໃບຮັບคืน {lastDoc}</a>}
            <button onClick={submit} disabled={submitting || lines.length === 0}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-aqua-700 to-brand-800 px-6 py-3 text-sm font-bold text-white shadow-md hover:shadow-lg active:scale-98 transition disabled:opacity-50 cursor-pointer">
              {submitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "✓"} ບັນທຶก ຮັບคืน
            </button>
          </div>
        </section>
      )}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.k === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.t}</div>
        </div>
      )}
    </div>
  );
}
