"use client";

import { useState } from "react";

/**
 * The confirm-step audit trail for one pick slip / issue doc, as a collapsible
 * panel that only fetches when it is opened.
 *
 * Pass `doc` (OUT… pick slip) while the pick is still being confirmed, or
 * `issue` (DP… issue doc) to look back at one that has already posted.
 */
type Row = {
  roworder: number;
  event: string;
  result: string | null;
  item_code: string | null;
  scan_input: string | null;
  sn: string | null;
  isn: string | null;
  rack: string | null;
  location: string | null;
  pallet: string | null;
  from_node: string | null;
  to_node: string | null;
  qty: string | null;
  note: string | null;
  user_created: string | null;
  created_at: string;
};

const EVENT_LABEL: Record<string, string> = {
  scan: "ຍິງ",
  unscan: "ຍົກເລີກຍິງ",
  move: "ແກ້ location",
  confirm: "ຢືນຢັນຈ່າຍ",
};
/** Green = it counted, amber = the screen pushed back, red = nothing was there. */
const RESULT_STYLE: Record<string, { label: string; cls: string }> = {
  ok: { label: "ສຳເລັດ", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/40" },
  not_found: { label: "ບໍ່ພົບ", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/40" },
  duplicate: { label: "ຍິງຊ້ຳ", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40" },
  over_qty: { label: "ເກີນຈຳນວນ", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40" },
  short: { label: "ຈ່າຍບໍ່ຄົບ", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40" },
};

function hhmmss(ts: string) {
  return ts.length >= 19 ? ts.slice(11, 19) : ts;
}

export default function ScanLogPanel({ doc, issue }: { doc?: string; issue?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams(doc ? { doc } : { issue: issue ?? "" });
      const res = await fetch(`/api/movements/issue/scan-log?${params}`);
      const data = (await res.json()) as { events?: Row[]; unavailable?: boolean };
      setRows(data.events ?? []);
      setUnavailable(!!data.unavailable);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load(); // always refetch — the trail grows while you scan
  }

  const rejected = (rows ?? []).filter((r) => r.result && r.result !== "ok").length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/20">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[11px] font-bold text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <span className={`text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        📋 ປະຫວັດການຍິງ SN / ແກ້ location
        {rows && (
          <span className="font-normal text-zinc-400">
            ({rows.length}{rejected > 0 ? ` · ບໍ່ຜ່ານ ${rejected}` : ""})
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {loading && <div className="px-4 py-6 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>}
          {!loading && unavailable && (
            <div className="px-4 py-6 text-center text-xs text-amber-600 dark:text-amber-400">
              ຍັງບໍ່ໄດ້ຕິດຕັ້ງຕາຕະລາງ log — ໃຫ້ admin ຮັນ migration 025 ກ່ອນ
            </div>
          )}
          {!loading && !unavailable && rows?.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-zinc-400">ຍັງບໍ່ມີປະຫວັດ</div>
          )}
          {!loading && rows && rows.length > 0 && (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-zinc-100/95 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 backdrop-blur dark:bg-zinc-800/95 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-1.5">ເວລາ</th>
                    <th className="px-3 py-1.5">ເຫດການ</th>
                    <th className="px-3 py-1.5">ສິນຄ້າ</th>
                    <th className="px-3 py-1.5">SN / ISN</th>
                    <th className="px-3 py-1.5">ບ່ອນ</th>
                    <th className="px-3 py-1.5">ຜູ້ເຮັດ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.map((r) => {
                    const style = r.result ? RESULT_STYLE[r.result] : undefined;
                    const node = [r.rack, r.location, r.pallet].filter(Boolean).join(" / ");
                    return (
                      <tr key={r.roworder} className={style && r.result !== "ok" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-zinc-500">{hhmmss(r.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{EVENT_LABEL[r.event] ?? r.event}</span>
                          {style && (
                            <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold ring-1 ${style.cls}`}>{style.label}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-zinc-600 dark:text-zinc-400">{r.item_code ?? "—"}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {r.event === "move" ? (
                            <span className="text-amber-700 dark:text-amber-300">{r.from_node} → {r.to_node}</span>
                          ) : (
                            <div className="space-y-0.5">
                              {/* what was physically scanned, then what it resolved to */}
                              {r.scan_input && <div className="text-zinc-800 dark:text-zinc-200">{r.scan_input}</div>}
                              {(r.sn || r.isn) && (
                                <div className="text-[10px] text-zinc-400">
                                  {r.sn ? `SN ${r.sn}` : ""}{r.sn && r.isn ? " · " : ""}{r.isn ? `ISN ${r.isn}` : ""}
                                </div>
                              )}
                              {!r.scan_input && !r.sn && !r.isn && <span className="text-zinc-400">—</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-zinc-500">
                          {node || "—"}
                          {r.qty != null && r.event !== "scan" && <span className="ml-1 text-zinc-400">({r.qty})</span>}
                          {r.note && <div className="text-[10px] font-sans text-zinc-400">{r.note}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{r.user_created ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
