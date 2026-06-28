"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type DocRow = {
  doc_no: string; doc_date: string | null; doc_time: string | null; wh_from: string | null; wh_to: string | null;
  wh_from_name: string | null; wh_to_name: string | null; remark: string | null; want_date: string | null;
  line_count: number; req_qty: string;
};
type DetailLine = { item_code: string; item_name: string | null; unit_code: string | null; req_qty: string; available: string };

export default function ApproveClient() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, DetailLine[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/movements/transfer-approve", { cache: "no-store" });
      const j = await r.json();
      setDocs(Array.isArray(j.docs) ? j.docs : []);
    } catch { setDocs([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Deep-link from the transfer dashboard (?doc=) → auto-expand that doc once.
  const searchParams = useSearchParams();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || docs.length === 0) return;
    const d = searchParams.get("doc");
    if (d && docs.some((x) => x.doc_no === d)) { autoOpened.current = true; void toggle(d); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, searchParams]);

  const toggle = async (doc: string) => {
    if (expanded === doc) { setExpanded(null); return; }
    setExpanded(doc);
    if (!detail[doc]) {
      const r = await fetch(`/api/movements/transfer-approve?doc=${encodeURIComponent(doc)}`);
      const j = await r.json();
      setDetail((p) => ({ ...p, [doc]: j.lines ?? [] }));
    }
  };

  const act = async (doc: string, action: "approve" | "reject") => {
    if (action === "reject" && !confirm(`ປฏิเสธ ໃບຂໍໂອນ ${doc}?`)) return;
    setBusy(doc); setMsg(null);
    try {
      const r = await fetch("/api/movements/transfer-approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc, action }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ tone: "err", text: j.error || "ບໍ່ສຳເລັດ" }); setBusy(null); return; }
      setMsg({ tone: "ok", text: action === "approve" ? `ອະນຸມັດ ${doc} ແລ້ວ` : `ປฏิเสธ ${doc} ແລ້ວ` });
      await load();
    } catch (e) { setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" }); }
    setBusy(null);
  };

  return (
    <div className="space-y-3">
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">ກຳລັງໂຫລດ…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">ບໍ່ມີໃບຂໍໂອນ ລໍຖ້າອະນຸມັດ</div>
      ) : docs.map((d) => {
        const open = expanded === d.doc_no;
        const overdue = !!d.want_date && d.want_date < new Date().toISOString().slice(0, 10);
        return (
          <div key={d.doc_no} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button onClick={() => toggle(d.doc_no)} className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-slate-50 cursor-pointer">
              <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-blue-600">{d.doc_no}</span>
                  <span className="text-[11px] text-slate-400">{d.doc_date} {d.doc_time}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">ລໍຖ້າອະນຸມັດ</span>
                  {overdue && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">ຕ້ອງการ {d.want_date}</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  ຈาก <b>{d.wh_from_name ?? d.wh_from}</b> → ຜູ້ຂໍ <b>{d.wh_to_name ?? d.wh_to}</b>{d.remark ? ` · ${d.remark}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-slate-500">{d.line_count} ລາຍການ · {Number.parseFloat(d.req_qty)}</div>
            </button>
            {open && (
              <div className="border-t border-slate-100">
                {!detail[d.doc_no] ? (
                  <div className="py-4 text-center text-xs text-slate-400">ກຳລັງໂຫລດ…</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-left text-[10px] font-semibold uppercase text-slate-500"><th className="px-4 py-2">ສິນຄ້າ</th><th className="px-4 py-2 text-right">ຂໍ</th><th className="px-4 py-2 text-right">ມີໃນສາງ</th><th className="px-4 py-2 text-right">ພร้อม?</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail[d.doc_no].map((ln) => {
                        const req = Number.parseFloat(ln.req_qty) || 0, av = Number.parseFloat(ln.available) || 0;
                        const ok = av + 1e-6 >= req;
                        return (
                          <tr key={ln.item_code}>
                            <td className="px-4 py-2"><span className="font-mono text-[11px] font-bold text-blue-600">{ln.item_code}</span><div className="max-w-md truncate text-[13px] text-slate-700">{ln.item_name}</div></td>
                            <td className="px-4 py-2 text-right font-mono">{req} <span className="text-[10px] text-slate-400">{ln.unit_code}</span></td>
                            <td className={`px-4 py-2 text-right font-mono ${ok ? "text-slate-600" : "text-rose-600 font-bold"}`}>{av}</td>
                            <td className="px-4 py-2 text-right">{ok ? <span className="text-emerald-600">✓</span> : <span className="text-rose-500 text-[11px] font-bold">ບໍ່ພໍ</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
                  <button disabled={busy === d.doc_no} onClick={() => act(d.doc_no, "reject")}
                    className="rounded-lg bg-rose-50 px-4 py-2 text-sm font-bold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 disabled:opacity-50 cursor-pointer">ປฏิเสธ</button>
                  <button disabled={busy === d.doc_no} onClick={() => act(d.doc_no, "approve")}
                    className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2 text-sm font-bold text-white shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer">
                    {busy === d.doc_no ? "…" : "✓ ອະນຸມັດ"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
