"use client";

import { useEffect, useMemo, useState } from "react";
import Barcode from "@/components/Barcode";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";
import {
  PICK_TYPES,
  buildPlan,
  fmtQty,
  type PickPendingDoc,
  type PickSrcLine,
  type PickTask,
} from "@/lib/pickPlan";

export type WarehouseOption = { code: string; name: string | null };

// ຕົວແບບຂໍ້ມູນ ແລະ ການວາງແຜນຢູ່ທີ່ src/lib/pickPlan.ts — ໜ້າມືຖື (/m/pick)
// ໃຊ້ຊຸດດຽວກັນ ເພື່ອໃຫ້ລຳດັບການຍ່າງເກັບຕົງກັນທັງສອງໜ້າ.
type PendingDoc = PickPendingDoc;
type SrcLine = PickSrcLine;
type Task = PickTask;

const TYPES = PICK_TYPES;

const fmt = fmtQty;
function ddmm(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return day ? `${day}-${m}-${y}` : d;
}

export default function PickClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  // ບໍ່ມີການເລືອກສາງ — ລາຍການມາທຸກສາງ; `wh` ຄືສາງຂອງໃບທີ່ເປີດ.
  const [wh, setWh] = useState("");
  const [type, setType] = useState("req");
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [active, setActive] = useState<PendingDoc | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    setActive(null); setTasks(null); setDone(new Set());
    let cancelled = false;
    setLoadingDocs(true);
    (async () => {
      try {
        const res = await fetch(`/api/movements/issue/pending?type=${type}`);
        const data = (await res.json()) as { docs?: PendingDoc[] };
        if (!cancelled) setDocs(data.docs ?? []);
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type]);

  async function openDoc(d: PendingDoc) {
    setActive(d); setWh(d.wh_code); setTasks(null); setDone(new Set()); setLoadingPlan(true);
    try {
      const res = await fetch(`/api/movements/issue/source?wh=${encodeURIComponent(d.wh_code)}&type=${type}&doc=${encodeURIComponent(d.doc_no)}`);
      const data = (await res.json()) as { lines?: SrcLine[] };
      setTasks(buildPlan(data.lines ?? []));
    } finally {
      setLoadingPlan(false);
    }
  }

  const docGroups = useMemo(() => groupByWarehouse(docs, (d) => d.wh_code, warehouses), [docs, warehouses]);

  const pickStats = useMemo(() => {
    if (!tasks) return null;
    const real = tasks.filter((t) => !t.short);
    return { total: real.length, done: real.filter((t) => done.has(t.key)).length, short: tasks.filter((t) => t.short).length };
  }, [tasks, done]);

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      {/* Filters + doc list (hidden on print) */}
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <div className={`${inputCls} flex items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{warehouses.length}</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດເອກະສານ</label>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {TYPES.map((t) => (
                <button key={t.v} type="button" onClick={() => setType(t.v)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${type === t.v ? "bg-white text-emerald-600 shadow-sm dark:bg-zinc-950 dark:text-emerald-400" : "text-zinc-500"}`}>{t.label}<span className="ml-1 text-[10px] opacity-60">{t.flag}</span></button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {!active && (
        <section className="space-y-2 print:hidden">
          {loadingDocs ? <div className="py-10 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
          : docs.length === 0 ? <div className="py-10 text-center text-sm text-zinc-400">ບໍ່ມີເອກະສານຄ້າງເກັບ</div>
          : docGroups.map((g) => (
            <WarehouseGroup
              key={g.code}
              code={g.code}
              name={warehouses.find((w) => w.code === g.code)?.name}
              count={g.rows.length}
              countLabel="ໃບ"
              tone="emerald"
            >
            <div className="space-y-2">
            {g.rows.map((d) => (
            <button key={`${d.wh_code}-${d.doc_no}`} type="button" onClick={() => openDoc(d)} className="flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left ring-1 ring-zinc-200 transition hover:ring-emerald-300 hover:shadow-md dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">{d.doc_no}</span><span className="text-[11px] text-zinc-400">{ddmm(d.doc_date)}</span></div>
                <div className="truncate text-xs text-zinc-500">{d.cust_name ?? d.cust_code ?? "—"}</div>
              </div>
              <div className="text-right text-[11px] text-zinc-500"><div>{d.line_count} ລາຍການ</div><div className="font-semibold text-zinc-700 dark:text-zinc-300">ຍັງ {fmt(d.remaining_qty)}</div></div>
              <ChevronRightIcon className="h-4 w-4 text-zinc-300" />
            </button>
            ))}
            </div>
            </WarehouseGroup>
          ))}
        </section>
      )}

      {active && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <button type="button" onClick={() => { setActive(null); setTasks(null); }} className="text-sm font-semibold text-zinc-500 hover:text-zinc-700">← ກັບ</button>
            <div className="flex items-center gap-2">
              {pickStats && <span className="text-xs text-zinc-500">{pickStats.done}/{pickStats.total} ເກັບແລ້ວ{pickStats.short ? ` · ${pickStats.short} ບໍ່ພໍ` : ""}</span>}
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg">🖨 ພິມໃບເກັບ</button>
            </div>
          </div>

          {/* On-screen interactive pick list */}
          <div className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 print:hidden">
            <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
              <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-100">{active.doc_no}</span>
              <span className="ml-2 text-xs text-zinc-500">{active.cust_name ?? ""} · {ddmm(active.doc_date)}</span>
            </div>
            {loadingPlan ? <div className="py-10 text-center text-sm text-zinc-400">ກຳລັງຈັດໃບເກັບ...</div>
            : !tasks || tasks.length === 0 ? <div className="py-10 text-center text-sm text-zinc-400">ບໍ່ມີຫຍັງໃຫ້ເກັບ</div>
            : (
              <table className="w-full text-sm">
                <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50"><th className="w-10 px-3 py-2.5">✓</th><th className="px-3 py-2.5">ບ່ອນເກັບ (walk order)</th><th className="px-3 py-2.5">ສິນຄ້າ</th><th className="px-3 py-2.5 text-right">ເກັບ</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {tasks.map((t) => {
                    const checked = done.has(t.key);
                    return (
                      <tr key={t.key} onClick={() => !t.short && setDone((p) => { const n = new Set(p); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}
                        className={`transition ${t.short ? "bg-rose-50/50 dark:bg-rose-950/20" : `cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${checked ? "opacity-50" : ""}`}`}>
                        <td className="px-3 py-2.5">{!t.short && <span className={`flex h-5 w-5 items-center justify-center rounded ${checked ? "bg-emerald-500 text-white" : "bg-zinc-100 text-transparent dark:bg-zinc-800"}`}>✓</span>}</td>
                        <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">{t.loc}</td>
                        <td className="px-3 py-2.5"><span className="font-mono text-[11px] text-zinc-500">{t.item_code}</span><div className={`max-w-md truncate text-[13px] ${checked ? "line-through" : "text-zinc-700 dark:text-zinc-300"}`}>{t.item_name}</div></td>
                        <td className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${t.short ? "text-rose-600 dark:text-rose-400" : "text-zinc-800 dark:text-zinc-100"}`}>{fmt(t.qty)}<span className="ml-1 text-[10px] text-zinc-400">{t.unit}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Print sheet */}
          {tasks && tasks.length > 0 && (
            <div className="print-sheet hidden print:block text-black">
              <div className="mb-2 border-b border-black pb-1">
                <div className="text-lg font-bold">ໃບເກັບສິນຄ້າ / Pick List</div>
                <div className="text-xs">{active.doc_no} · {active.cust_name ?? ""} · {ddmm(active.doc_date)} · ສາງ {wh}</div>
              </div>
              <table className="w-full border-collapse text-[11px]">
                <thead><tr className="border-b border-black text-left"><th className="py-1 pr-2">✓</th><th className="py-1 pr-2">ບ່ອນເກັບ</th><th className="py-1 pr-2">ສິນຄ້າ</th><th className="py-1 text-right">ເກັບ</th></tr></thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.key} className="break-inside-avoid border-b border-zinc-300 align-top">
                      <td className="py-1.5 pr-2">☐</td>
                      <td className="py-1.5 pr-2" style={{ width: "32%" }}>
                        <div className="font-mono font-bold">{t.loc}</div>
                        {!t.short && t.barcode && <div style={{ width: 120 }}><Barcode value={t.barcode} height={26} /></div>}
                      </td>
                      <td className="py-1.5 pr-2"><span className="font-mono">{t.item_code}</span> {t.item_name}</td>
                      <td className="py-1.5 text-right font-mono font-bold">{fmt(t.qty)} {t.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
