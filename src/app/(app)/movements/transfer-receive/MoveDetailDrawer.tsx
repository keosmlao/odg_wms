"use client";

import { useEffect, useState } from "react";
import { MOVE_REASONS } from "@/lib/moveReasons";

/**
 * What one posted WMS movement (DP doc) actually did — the in-app answer to
 * "which units came in, and where did we put them", as opposed to the printable
 * slip. Opens over the history list and fetches on demand.
 */
const REASON_LABEL = Object.fromEntries(MOVE_REASONS.map((r) => [r.code, r.label]));

type Header = {
  doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null;
  wh_code: string | null; wh_name: string | null; user_created: string | null; user_name: string | null;
};
type Line = {
  item_code: string; item_name: string | null; unit_code: string | null; qty: string;
  from_wh: string | null; from_wh_name: string | null; from_loc: string | null;
  to_wh: string | null; to_wh_name: string | null; to_loc: string | null;
};
type Unit = { item_code: string; sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null; warehouse: string | null };
type Erp = { doc_no: string; doc_format_code: string | null; trans_flag: number; wh_from: string | null; wh_to: string | null };
type Note = { item_code: string; reason_code: string | null; short_qty: string | null };
type Detail = { header: Header; kind: string; lines: Line[]; units: Unit[]; erp: Erp[]; notes: Note[] };

const IN_TRANSIT = "9903";

function whLabel(code: string | null, name: string | null) {
  if (!code) return "—";
  return name ? `${code} · ${name}` : code;
}
function nodeLabel(u: { rack: string | null; location: string | null; pallet: string | null }) {
  return [u.rack, u.location, u.pallet].filter(Boolean).join(" / ") || "—";
}

export default function MoveDetailDrawer({ docNo, onClose }: { docNo: string | null; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docNo) { setData(null); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/movements/issue/${encodeURIComponent(docNo)}`, { cache: "no-store" });
        const j = (await res.json()) as Detail & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(j.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docNo]);

  if (!docNo) return null;

  const h = data?.header;
  // On a receive the interesting end is where the goods LANDED; on a transfer-out
  // it is where they came FROM. Label the unit column accordingly.
  const isReceive = data?.kind === "transfer_in";
  const unitNodeHeader = isReceive ? "ຮັບເຂົ້າທີ່" : "ຈ່າຍອອກຈາກ";
  const unitsByItem = new Map<string, Unit[]>();
  for (const u of data?.units ?? []) {
    const a = unitsByItem.get(u.item_code) ?? []; a.push(u); unitsByItem.set(u.item_code, a);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="close" onClick={onClose} className="flex-1 bg-black/40" />
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-900">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-base font-black text-zinc-900 dark:text-zinc-50">{docNo}</div>
            {h && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>📅 {h.doc_date} {h.doc_time}</span>
                {h.doc_ref && <span>ອ້າງອີງ <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{h.doc_ref}</span></span>}
                <span>👤 {h.user_name?.trim() || h.user_created || "—"}</span>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ…</div>}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* ① ຈາກ → ໄປ + ເອກະສານ ERP */}
              <section className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/30">
                <div className="mb-2 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">① ເສັ້ນທາງ ແລະ ເອກະສານ</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-lg bg-white px-2.5 py-1 font-semibold ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
                    {whLabel(data.lines.find((l) => l.from_wh)?.from_wh ?? null, data.lines.find((l) => l.from_wh)?.from_wh_name ?? null)}
                  </span>
                  <span className="text-zinc-400">→</span>
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
                    {whLabel(data.lines.find((l) => l.to_wh)?.to_wh ?? null, data.lines.find((l) => l.to_wh)?.to_wh_name ?? null)}
                  </span>
                </div>
                {data.erp.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">ເອກະສານ ERP:</span>
                    {Array.from(new Map(data.erp.map((e) => [e.doc_no, e])).values()).map((e) => (
                      <span key={e.doc_no} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] font-bold text-brand-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-brand-400 dark:ring-zinc-700"
                        title={e.wh_from === IN_TRANSIT ? "ໃບໂອນເຂົ້າ" : e.wh_to === IN_TRANSIT ? "ໃບໂອນອອກ" : "ERP"}>
                        {e.doc_no}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* ② ລາຍການ + ບ່ອນທີ່ຮັບເຂົ້າ/ຈ່າຍອອກ */}
              <section>
                <div className="mb-1.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
                  ② ລາຍການ ({data.lines.length}) — {isReceive ? "ບ່ອນທີ່ຮັບເຂົ້າ" : "ບ່ອນທີ່ຈ່າຍອອກ"}
                </div>
                <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">ສິນຄ້າ</th>
                        <th className="px-3 py-2">ຈາກ</th>
                        <th className="px-3 py-2">ໄປ</th>
                        <th className="px-3 py-2 text-right">ຈຳນວນ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {data.lines.map((l) => (
                        <tr key={l.item_code}>
                          <td className="px-3 py-2">
                            <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}</div>
                            <div className="text-zinc-700 dark:text-zinc-300">{l.item_name ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">
                            {l.from_wh ?? "—"}{l.from_loc ? <div className="text-zinc-400">{l.from_loc}</div> : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                            {l.to_wh ?? "—"}{l.to_loc ? <div className="font-bold text-emerald-700 dark:text-emerald-400">{l.to_loc}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {Number.parseFloat(l.qty || "0")}<span className="ml-1 text-[10px] font-normal text-zinc-400">{l.unit_code}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ③ SN / ISN ຕໍ່ໜ່ວຍ + node */}
              <section>
                <div className="mb-1.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
                  ③ SN / ISN ຕໍ່ໜ່ວຍ ({data.units.length})
                </div>
                {data.units.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                    ລາຍການນີ້ບໍ່ໄດ້ຕິດຕາມ serial (ຮັບ/ຈ່າຍ ຕາມຈຳນວນ)
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...unitsByItem.entries()].map(([item, us]) => (
                      <div key={item} className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                        <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-1.5 dark:bg-zinc-800/50">
                          <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{item}</span>
                          <span className="text-[10px] text-zinc-400">{us.length} ໜ່ວຍ</span>
                        </div>
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                            <tr>
                              <th className="px-3 py-1.5">SN (ໂຮງງານ)</th>
                              <th className="px-3 py-1.5">ISN (ບໍລິສັດ)</th>
                              <th className="px-3 py-1.5">{unitNodeHeader}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {us.map((u, i) => (
                              <tr key={`${u.sn ?? u.isn ?? i}`}>
                                <td className="px-3 py-1.5 font-mono break-all text-zinc-800 dark:text-zinc-200">
                                  {u.sn ?? <span className="italic text-zinc-400">ບໍ່ມີ</span>}
                                </td>
                                <td className="px-3 py-1.5 font-mono break-all text-zinc-800 dark:text-zinc-200">
                                  {u.isn ?? <span className="italic text-zinc-400">ບໍ່ມີ</span>}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-zinc-600 dark:text-zinc-400">
                                  {nodeLabel(u)}
                                  {u.warehouse && <span className="ml-1 text-zinc-400">({u.warehouse})</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ④ ຮັບ/ຈ່າຍ ບໍ່ຄົບ */}
              {data.notes.length > 0 && (
                <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <div className="mb-1 text-[11px] font-bold text-amber-800 dark:text-amber-300">④ ຮັບ / ຈ່າຍ ບໍ່ຄົບ</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900 dark:text-amber-200">
                    {data.notes.map((n, i) => (
                      <li key={i}>
                        <span className="font-mono font-bold">{n.item_code}</span> — {REASON_LABEL[n.reason_code ?? ""] ?? n.reason_code}
                        {n.short_qty ? ` (ຂາດ ${Number.parseFloat(n.short_qty)})` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {/* footer — jump to the printable copies */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <a href={`/print/wms/${encodeURIComponent(docNo)}`} target="_blank" rel="noopener"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700">🖨 ໃບໂອນ (ມີ SN)</a>
          <a href={`/print/wms/${encodeURIComponent(docNo)}/bill`} target="_blank" rel="noopener"
            className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">🧾 ບິນໂອນ</a>
        </div>
      </div>
    </div>
  );
}
