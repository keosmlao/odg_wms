"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import { estimatePalletPositions } from "@/lib/capacity";

type PoSummary = { po_no: string; cust_code: string | null; cust_name: string | null };
type WhInfo = { wh_code: string; wh_name: string | null };
type PackCandidate = { pack_no: string; pack_date: string | null; line_count: number; total_qty: string };
type LineSource = { po_no: string; ordered: string; remaining: string };
type MergedLineIn = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  pallet?: string | null;
  stack?: string | null;
  sources: LineSource[];
};
type WorkLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  remaining: number;
  isIsn: boolean;
  qty: string;
  pallet: number;
  stack: number;
  sources: { po_no: string; remaining: number }[];
};
type PendingPo = { po_no: string; cust_name: string | null };

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}
function parsedQty(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function CountSheetWizard({ po = "", wh = "" }: { po?: string; wh?: string }) {
  const router = useRouter();

  const [poNos, setPoNos] = useState<string[]>(po ? [po] : []);
  const [posInfo, setPosInfo] = useState<PoSummary[]>([]);
  const [whInfo, setWhInfo] = useState<WhInfo | null>(wh ? { wh_code: wh, wh_name: null } : null);
  const whRef = useRef<string>(wh);
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [packs, setPacks] = useState<PackCandidate[]>([]);
  const [packRef, setPackRef] = useState("");
  const [existingCounts, setExistingCounts] = useState<{ po_no: string; doc_no: string }[]>([]);
  const [availablePos, setAvailablePos] = useState<PendingPo[]>([]);
  const [poInput, setPoInput] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(!!po);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }

  // Merge freshly-fetched lines onto existing ones, preserving typed counts.
  const mergeLines = useCallback((incoming: MergedLineIn[]) => {
    setLines((prev) => {
      const prevQty = new Map(prev.map((l) => [l.item_code, l.qty]));
      return incoming.map((l) => {
        const remaining = Number.parseFloat(l.remaining) || 0;
        const ordered = Number.parseFloat(l.ordered) || 0;
        const kept = prevQty.get(l.item_code);
        return {
          item_code: l.item_code,
          item_name: l.item_name,
          unit_code: l.unit_code,
          ordered,
          remaining,
          isIsn: l.is_isn,
          qty: kept ?? String(remaining > 0 ? remaining : 0),
          pallet: Number.parseFloat(l.pallet ?? "") || 0,
          stack: Number.parseFloat(l.stack ?? "") || 0,
          sources: (l.sources ?? []).map((s) => ({ po_no: s.po_no, remaining: Number.parseFloat(s.remaining) || 0 })),
        };
      });
    });
  }, []);

  // Reload merged lines whenever the selected PO set changes.
  useEffect(() => {
    if (poNos.length === 0) { setLines([]); setPosInfo([]); setPacks([]); setExistingCounts([]); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        poNos.forEach((p) => qs.append("po", p));
        if (whRef.current) qs.set("wh", whRef.current);
        const res = await fetch(`/api/receive/packing-list?${qs}`);
        const data = (await res.json()) as {
          wh?: WhInfo; pos?: PoSummary[]; lines?: MergedLineIn[]; packs?: PackCandidate[];
          existing_counts?: { po_no: string; doc_no: string }[]; errors?: { po_no: string; error: string }[]; error?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        // Drop POs that aren't valid in this warehouse (e.g. different warehouse).
        if (data.errors && data.errors.length > 0) {
          const bad = new Set(data.errors.map((e) => e.po_no));
          showToast("err", data.errors.map((e) => `${e.po_no}: ${e.error}`).join(" · "));
          const good = poNos.filter((p) => !bad.has(p));
          if (good.length !== poNos.length) { setPoNos(good); return; }
        }
        if (data.wh) { setWhInfo(data.wh); whRef.current = data.wh.wh_code; }
        setPosInfo(data.pos ?? []);
        setPacks(data.packs ?? []);
        setExistingCounts(data.existing_counts ?? []);
        mergeLines(data.lines ?? []);
      } catch (e) {
        if (!cancelled) showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poNos.join("|")]);

  // Once the warehouse is known, load its pending POs for the quick picker.
  useEffect(() => {
    const code = whInfo?.wh_code;
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receive/pending?wh=${encodeURIComponent(code)}&type=po&limit=1000`);
        const data = (await res.json()) as { lines?: { po_no: string; cust_name: string | null }[] };
        if (cancelled) return;
        const seen = new Map<string, PendingPo>();
        for (const l of data.lines ?? []) if (!seen.has(l.po_no)) seen.set(l.po_no, { po_no: l.po_no, cust_name: l.cust_name });
        setAvailablePos(Array.from(seen.values()));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [whInfo?.wh_code]);

  function addPo(code: string) {
    const p = code.trim();
    if (!p) return;
    if (poNos.includes(p)) { showToast("err", `PO ${p} ຢູ່ໃນລາຍການແລ້ວ`); return; }
    setPackRef("");
    setPoNos((prev) => [...prev, p]);
    setPoInput("");
  }
  function removePo(code: string) {
    setPoNos((prev) => prev.filter((p) => p !== code));
  }

  // Optional (single-PO only): replace lines from a specific packing list.
  async function loadFromPack(packNo: string) {
    const p = packNo.trim();
    setPackRef(p);
    if (!p || poNos.length !== 1) return;
    try {
      const qs = new URLSearchParams({ po: poNos[0], pack: p });
      if (whRef.current) qs.set("wh", whRef.current);
      const res = await fetch(`/api/receive/packing-list?${qs}`);
      const data = (await res.json()) as { lines?: (MergedLineIn & { pack_qty?: string })[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      if (!data.lines || data.lines.length === 0) { showToast("err", "ບໍ່ພົບລາຍການໃນ packing list ນີ້"); return; }
      setLines(data.lines.map((l) => {
        const ordered = Number.parseFloat(l.ordered) || 0;
        const remaining = Number.parseFloat(l.remaining) || 0;
        const packQty = Number.parseFloat((l as { pack_qty?: string }).pack_qty ?? l.remaining) || 0;
        const dflt = remaining > 0 ? Math.min(packQty, remaining) : packQty;
        return {
          item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, ordered, remaining, isIsn: l.is_isn,
          qty: String(dflt), pallet: Number.parseFloat(l.pallet ?? "") || 0, stack: Number.parseFloat(l.stack ?? "") || 0,
          sources: (l.sources ?? []).map((s) => ({ po_no: s.po_no, remaining: Number.parseFloat(s.remaining) || 0 })),
        };
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

  const validLines = lines.filter((l) => (parsedQty(l.qty) ?? 0) > 0);

  async function submit() {
    if (poNos.length === 0 || !whInfo) { showToast("err", "ຍັງບໍ່ໄດ້ເລືອກ PO"); return; }
    if (validLines.length === 0) { showToast("err", "ບໍ່ມີລາຍການກວດນັບ" ); return; }
    for (const l of validLines) {
      const q = parsedQty(l.qty)!;
      if (l.remaining > 0 && q > l.remaining + 1e-6) { showToast("err", `${l.item_code}: ກວດນັບເກີນຄ້າງ (${fmt(l.remaining)})`); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/receive/count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pos: posInfo.length > 0 ? posInfo.map((p) => ({ po_no: p.po_no, supplier_code: p.cust_code })) : poNos.map((p) => ({ po_no: p })),
          pack_no: poNos.length === 1 ? packRef || null : null,
          wh_code: whInfo.wh_code,
          supplier_code: posInfo[0]?.cust_code ?? null,
          remark,
          lines: validLines.map((l) => ({ item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: parsedQty(l.qty) })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; count_code?: string; existing_count_no?: string; error?: string };
      if (!res.ok || !data.ok) {
        if (data.existing_count_no) setExistingCounts((prev) => [...prev, { po_no: "", doc_no: data.existing_count_no! }]);
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

  const supplierName = (code: string) => posInfo.find((p) => p.po_no === code)?.cust_name ?? null;
  const notAddedAvailable = availablePos.filter((a) => !poNos.includes(a.po_no));

  return (
    <div className="space-y-5">
      {/* Warehouse + selected POs */}
      <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-zinc-500">ສາງ</span>
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {whInfo ? `${whInfo.wh_code}${whInfo.wh_name ? ` · ${whInfo.wh_name}` : ""}` : "ຈະກຳນົດຈາກ PO ທຳອິດ"}
          </span>
          <span className="ml-auto text-xs text-zinc-400">PO ໃນໃບ: {poNos.length}</span>
        </div>

        {/* selected PO chips */}
        <div className="flex flex-wrap gap-1.5">
          {poNos.length === 0 && <span className="text-xs text-zinc-400">ຍັງບໍ່ໄດ້ເລືອກ PO — ເພີ່ມດ້ານລຸ່ມ</span>}
          {poNos.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-2.5 pr-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700">
              <span className="font-mono">PO {p}</span>
              {supplierName(p) && <span className="font-normal text-zinc-400">· {supplierName(p)}</span>}
              <button type="button" onClick={() => removePo(p)} className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-500/20" aria-label="ເອົາ PO ອອກ">×</button>
            </span>
          ))}
        </div>

        {/* add PO: type/scan + quick-pick */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={poInput}
              onChange={(e) => setPoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPo(poInput)}
              placeholder="ພິມ / ສະແກນ ເລກ PO ເພື່ອເພີ່ມ..."
              className={`${inputCls} pl-9`}
            />
          </div>
          <button type="button" onClick={() => addPo(poInput)} disabled={!poInput.trim()} className={primaryBtn}>
            <PlusIcon className="h-4 w-4" /> ເພີ່ມ PO
          </button>
        </div>

        {notAddedAvailable.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold text-zinc-400">PO ຄ້າງຮັບໃນສາງນີ້ ({notAddedAvailable.length}) — ກົດເພື່ອເພີ່ມ</div>
            <div className="flex flex-wrap gap-1.5">
              {notAddedAvailable.slice(0, 12).map((a) => (
                <button key={a.po_no} type="button" onClick={() => addPo(a.po_no)} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50" title={a.cust_name ?? ""}>
                  + {a.po_no}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {existingCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50">
          <AlertIcon className="h-4 w-4 shrink-0" />
          ⚠️ ມີໃບກວດນັບຄ້າງຢູ່ແລ້ວ:
          {existingCounts.map((e) => (
            <button key={e.doc_no} type="button" onClick={() => router.push(`/movements/receive/count/${encodeURIComponent(e.doc_no)}`)} className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-bold text-white">
              {e.po_no ? `${e.po_no} → ` : ""}{e.doc_no}
            </button>
          ))}
        </div>
      )}

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {/* optional packing-list reference (single PO only) */}
        {poNos.length === 1 && (
          <>
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
          </>
        )}

        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">ລາຍການກວດນັບ ({lines.length})</span>
          <button type="button" onClick={fillAll} className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">ກວດນັບ = ຄ້າງ ທຸກລາຍການ</button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-xs text-zinc-400 dark:border-zinc-800">ກຳລັງໂຫຼດ...</div>
        ) : lines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-xs text-zinc-400 dark:border-zinc-800">{poNos.length === 0 ? "ເພີ່ມ PO ເພື່ອດຶງລາຍການ" : "ບໍ່ມີລາຍການຄ້າງຮັບ"}</div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2.5">ສິນຄ້າ</th>
                  <th className="px-4 py-2.5 text-right">ສັ່ງ</th>
                  <th className="px-4 py-2.5 text-right">ຄ້າງ</th>
                  <th className="px-4 py-2.5 text-center">ກວດນັບ</th>
                  <th className="px-4 py-2.5 text-right">ພາເລດ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((l) => {
                  const q = parsedQty(l.qty);
                  const over = l.remaining > 0 && q !== null && q > l.remaining + 1e-6;
                  const multiSrc = l.sources.length > 1;
                  return (
                    <tr key={l.item_code} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}{l.isIsn && <span className="ml-1 rounded bg-aqua-100 px-1 text-[9px] text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">SN</span>}</div>
                        <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                        {multiSrc && (
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] text-zinc-400">
                            {l.sources.map((s) => <span key={s.po_no} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{s.po_no}: {fmt(s.remaining)}</span>)}
                          </div>
                        )}
                        {l.isIsn && <div className="mt-0.5 text-[10px] text-aqua-500">gen ISN ອັດຕະໂນມັດ {Math.round(q ?? 0)} ໜ່ວຍ ຕອນບັນທຶກ</div>}
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
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-brand-600 dark:text-brand-400">
                        {estimatePalletPositions(q ?? 0, l.pallet) > 0 ? `~${estimatePalletPositions(q ?? 0, l.pallet)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800/50">
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300" colSpan={4}>ພາເລດທີ່ຕ້ອງໃຊ້ລວມ</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-brand-600 dark:text-brand-400">
                    ~{lines.reduce((s, l) => s + estimatePalletPositions(parsedQty(l.qty) ?? 0, l.pallet), 0)} ພາເລດ
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
          <button type="button" onClick={submit} disabled={submitting || validLines.length === 0 || poNos.length === 0} className={primaryBtn}>
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
