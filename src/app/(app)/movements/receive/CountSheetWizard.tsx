"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";

type PoInfo = { wh_code: string; wh_name: string | null; cust_code: string | null; cust_name: string | null };
type PackCandidate = { pack_no: string; pack_date: string | null; line_count: number; total_qty: string };
type PoLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  foot?: string | null;
  stack?: string | null;
};
type WorkLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  remaining: number;
  isIsn: boolean;
  qty: string;
  serials: string[]; // manual serials (blank = auto ISN at receipt)
  mfd: string;
  expire: string;
  showSn: boolean;
  foot: number; // unit floor footprint (m²)
  stack: number; // stackable count
};

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}
// Floor area (m²) a qty needs = ceil(qty / stack) × unit footprint.
function areaM2(qty: number, foot: number, stack: number): number {
  if (!(foot > 0) || qty <= 0) return 0;
  return Math.ceil(qty / (stack > 0 ? stack : 1)) * foot;
}
function parsedQty(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function CountSheetWizard({ po, wh = "" }: { po: string; wh?: string }) {
  const router = useRouter();
  const whParam = wh ? `&wh=${encodeURIComponent(wh)}` : "";
  const [poInfo, setPoInfo] = useState<PoInfo | null>(null);
  const [existingCount, setExistingCount] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackCandidate[]>([]);
  const [packRef, setPackRef] = useState("");
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }

  function toWorkLines(src: PoLine[]): WorkLine[] {
    return src.map((l) => {
      const ordered = Number.parseFloat(l.ordered) || 0;
      const remaining = Number.parseFloat(l.remaining) || 0;
      return { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, ordered, remaining, isIsn: l.is_isn, qty: String(remaining > 0 ? remaining : 0), serials: [], mfd: "", expire: "", showSn: false, foot: Number.parseFloat(l.foot ?? "") || 0, stack: Number.parseFloat(l.stack ?? "") || 0 };
    });
  }

  // Pull the PO's pending lines directly on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receive/packing-list?po=${encodeURIComponent(po)}${whParam}`);
        const data = (await res.json()) as { po?: PoInfo; lines?: PoLine[]; packs?: PackCandidate[]; existing_count?: string | null; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setPoInfo(data.po ?? null);
        setExistingCount(data.existing_count ?? null);
        setPacks(data.packs ?? []);
        setLines(toWorkLines(data.lines ?? []));
      } catch (e) {
        if (!cancelled) showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [po]);

  // Optional: replace lines with a specific packing list's lines.
  async function loadFromPack(packNo: string) {
    const p = packNo.trim();
    setPackRef(p);
    if (!p) return;
    try {
      const res = await fetch(`/api/receive/packing-list?po=${encodeURIComponent(po)}&pack=${encodeURIComponent(p)}${whParam}`);
      const data = (await res.json()) as { lines?: (PoLine & { pack_qty?: string })[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      if (!data.lines || data.lines.length === 0) { showToast("err", "ບໍ່ພົບລາຍການໃນ packing list ນີ້"); return; }
      // packing-list lines carry pack_qty; use it as the default counted qty.
      setLines(data.lines.map((l) => {
        const ordered = Number.parseFloat(l.ordered) || 0;
        const remaining = Number.parseFloat(l.remaining) || 0;
        const packQty = Number.parseFloat(l.pack_qty ?? l.remaining) || 0;
        const dflt = remaining > 0 ? Math.min(packQty, remaining) : packQty;
        return { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, ordered, remaining, isIsn: l.is_isn, qty: String(dflt), serials: [], mfd: "", expire: "", showSn: false, foot: Number.parseFloat(l.foot ?? "") || 0, stack: Number.parseFloat(l.stack ?? "") || 0 };
      }));
      showToast("ok", `ດຶງຈາກ ${p} ແລ້ວ`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
    }
  }

  function setLine(itemCode: string, patch: Partial<WorkLine>) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, ...patch } : l)));
  }
  function fillAll() {
    setLines((prev) => prev.map((l) => ({ ...l, qty: String(l.remaining > 0 ? l.remaining : 0) })));
  }
  function toggleSn(l: WorkLine) {
    const n = Math.max(0, Math.round(parsedQty(l.qty) ?? 0));
    const serials = l.serials.length === n ? l.serials : Array.from({ length: n }, (_, i) => l.serials[i] ?? "");
    setLine(l.item_code, { showSn: !l.showSn, serials });
  }
  function setSerial(itemCode: string, idx: number, value: string) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, serials: l.serials.map((s, i) => (i === idx ? value : s)) } : l)));
  }

  const validLines = lines.filter((l) => (parsedQty(l.qty) ?? 0) > 0);

  async function submit() {
    if (!poInfo) return;
    if (validLines.length === 0) { showToast("err", "ບໍ່ມີລາຍການກວດນັບ"); return; }
    for (const l of validLines) {
      const q = parsedQty(l.qty)!;
      if (l.remaining > 0 && q > l.remaining + 1e-6) { showToast("err", `${l.item_code}: ກວດນັບເກີນຄ້າງ (${fmt(l.remaining)})`); return; }
      if (l.serials.filter((s) => s.trim() !== "").length > q + 1e-6) { showToast("err", `${l.item_code}: SN ເກີນຈຳນວນ`); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/receive/count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_no: po,
          pack_no: packRef || null,
          wh_code: poInfo.wh_code,
          supplier_code: poInfo.cust_code,
          remark,
          lines: validLines.map((l) => ({
            item_code: l.item_code,
            item_name: l.item_name,
            unit_code: l.unit_code,
            qty: parsedQty(l.qty),
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; count_code?: string; existing_count_no?: string; error?: string };
      if (!res.ok || !data.ok) {
        if (data.existing_count_no) setExistingCount(data.existing_count_no);
        throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      }
      showToast("ok", `ສ້າງໃບກວດນັບ ${data.count_code} ສຳເລັດ`);
      setTimeout(() => router.push("/movements/receive?tab=count"), 700);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800";

  if (loading) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ກຳລັງໂຫຼດ...</div>;
  if (!poInfo) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-rose-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ບໍ່ພົບ PO ນີ້</div>;

  return (
    <div className="space-y-5">
      <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-mono font-bold text-zinc-900 dark:text-zinc-50">PO {po}</span>
          <span className="text-zinc-600 dark:text-zinc-300">{poInfo.cust_name ?? poInfo.cust_code ?? "—"}</span>
          <span className="text-xs text-zinc-500">ສາງ {poInfo.wh_code}{poInfo.wh_name ? ` · ${poInfo.wh_name}` : ""}</span>
        </div>
      </div>

      {existingCount && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50">
          <AlertIcon className="h-4 w-4 shrink-0" />
          ⚠️ PO ນີ້ມີໃບກວດນັບຄ້າງຢູ່ແລ້ວ: <span className="font-mono font-bold">{existingCount}</span>
          <button type="button" onClick={() => router.push(`/movements/receive/count/${encodeURIComponent(existingCount)}`)} className="ml-auto rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white">ເປີດໃບເກົ່າ</button>
        </div>
      )}

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {/* optional packing-list reference */}
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເລກ packing list (ທາງເລືອກ)</label>
            <input value={packRef} onChange={(e) => setPackRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadFromPack(packRef)} placeholder="ວ່າງ = ໃຊ້ລາຍການຈາກ PO" className={inputCls} />
          </div>
          {packRef.trim() && <button type="button" onClick={() => loadFromPack(packRef)} className={ghostBtn}>ດຶງຕາມ packing list</button>}
        </div>
        {packs.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {packs.slice(0, 8).map((p) => (
              <button key={p.pack_no} type="button" onClick={() => loadFromPack(p.pack_no)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${packRef === p.pack_no ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{p.pack_no}</button>
            ))}
          </div>
        )}

        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">ລາຍການກວດນັບ ({lines.length})</span>
          <button type="button" onClick={fillAll} className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">ກວດນັບ = ຄ້າງ ທຸກລາຍການ</button>
        </div>

        {lines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-xs text-zinc-400 dark:border-zinc-800">ບໍ່ມີລາຍການຄ້າງຮັບໃນ PO ນີ້</div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2.5">ສິນຄ້າ</th>
                  <th className="px-4 py-2.5 text-right">ສັ່ງ</th>
                  <th className="px-4 py-2.5 text-right">ຄ້າງ</th>
                  <th className="px-4 py-2.5 text-center">ກວດນັບ</th>
                  <th className="px-4 py-2.5 text-right">ພື້ນທີ່ m²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((l) => {
                  const q = parsedQty(l.qty);
                  const over = l.remaining > 0 && q !== null && q > l.remaining + 1e-6;
                  return (
                    <tr key={l.item_code} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}{l.isIsn && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">SN</span>}</div>
                        <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                        {l.isIsn && <div className="mt-0.5 text-[10px] text-violet-500">gen ISN ອັດຕະໂນมัด {Math.round(q ?? 0)} ໜ່ວຍ ຕอนບັນທຶก</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(l.ordered)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{l.remaining > 0 ? fmt(l.remaining) : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.item_code, { qty: e.target.value })} className={`w-24 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 focus:outline-none focus:ring-2 dark:bg-zinc-950 ${over ? "ring-red-400 focus:ring-red-500" : "ring-zinc-200 focus:ring-emerald-500 dark:ring-zinc-800"}`} />
                          <span className="w-8 text-[10px] text-zinc-400">{l.unit_code ?? ""}</span>
                        </div>
                        {over && <div className="mt-0.5 text-center text-[10px] text-red-500">ເກີນຄ້າງ</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                        {areaM2(q ?? 0, l.foot, l.stack) > 0 ? `~${areaM2(q ?? 0, l.foot, l.stack).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800/50">
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300" colSpan={4}>ໃຊ້ພື້ນທີ່ລວມ</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                    ~{lines.reduce((s, l) => s + areaM2(parsedQty(l.qty) ?? 0, l.foot, l.stack), 0).toFixed(2)} m²
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ໝາຍເຫດ (ທາງເລືອກ)</label>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດ..." className={inputCls} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => router.push("/movements/receive")} className={ghostBtn}>← ຍົກເລີກ</button>
          <button type="button" onClick={submit} disabled={submitting || validLines.length === 0} className={primaryBtn}>
            <CheckIcon className="h-4 w-4" />{submitting ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກໃບກວດນັບ ${validLines.length} ລາຍການ`}
          </button>
        </div>
      </section>

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
            {toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
