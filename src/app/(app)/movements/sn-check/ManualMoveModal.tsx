"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Target = { rack: string; location: string; pallet: string; qty: string };
type Serial = { roworder: number; sn: string | null; isn: string | null; rack: string; location: string; pallet: string };

function locLabel(rack: string, location: string, pallet: string) {
  return [rack, location, pallet].filter(Boolean).join(" / ") || "(ສາງ)";
}
function key(x: { rack: string; location: string; pallet: string }) {
  return `${x.rack}|${x.location}|${x.pallet}`;
}

/**
 * Manual relocation — scan workflow: pick a target location, scan/check the SN
 * that belong there, repeat for each location, then save.
 */
export default function ManualMoveModal({
  whCode,
  item,
  onClose,
  onDone,
}: {
  whCode: string;
  item: { item_code: string; item_name: string | null };
  onClose: () => void;
  onDone: (kind: "ok" | "err", text: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<Target[]>([]);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [assign, setAssign] = useState<Record<number, number>>({}); // roworder -> target index
  const [active, setActive] = useState<number | null>(null);
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/movements/sn-check?wh=${encodeURIComponent(whCode)}&item=${encodeURIComponent(item.item_code)}`);
        const data = (await res.json()) as { wms?: Target[]; serials?: Serial[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
        setTargets(data.wms ?? []);
        setSerials(data.serials ?? []);
        if ((data.wms ?? []).length > 0) setActive(0);
      } catch (err) {
        if (!cancelled) {
          onDone("err", err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [whCode, item.item_code, onClose, onDone]);

  // focus the scan box when the active location changes
  useEffect(() => {
    if (active !== null) setTimeout(() => scanRef.current?.focus(), 50);
  }, [active]);

  const targetNeed = useMemo(() => targets.map((t) => Math.round(Number.parseFloat(t.qty) || 0)), [targets]);
  const assignedCount = useMemo(() => {
    const c = targets.map(() => 0);
    for (const ro of Object.keys(assign)) {
      const ti = assign[Number(ro)];
      if (ti >= 0 && ti < c.length) c[ti] += 1;
    }
    return c;
  }, [assign, targets]);

  // scan index: isn/sn (upper) -> serial
  const byCode = useMemo(() => {
    const m = new Map<string, Serial>();
    for (const s of serials) {
      if (s.isn) m.set(s.isn.toUpperCase(), s);
      if (s.sn) m.set(s.sn.toUpperCase(), s);
    }
    return m;
  }, [serials]);

  function flash(kind: "ok" | "err", text: string) {
    setScanMsg({ kind, text });
    setTimeout(() => setScanMsg(null), 1800);
  }

  function assignTo(roworder: number, ti: number | null) {
    setAssign((prev) => {
      const next = { ...prev };
      if (ti === null) delete next[roworder];
      else next[roworder] = ti;
      return next;
    });
  }

  /** Add a serial to the active location, capped at the location's WMS need. */
  function tryAddToActive(s: Serial) {
    if (active === null) return;
    if (assign[s.roworder] === active) {
      flash("ok", `ມີແລ້ວ: ${s.isn ?? s.sn}`);
      return;
    }
    if (assignedCount[active] >= targetNeed[active]) {
      flash("err", `ເຕັມແລ້ວ: ${locLabel(targets[active].rack, targets[active].location, targets[active].pallet)} (ຕ້ອງການ ${targetNeed[active]})`);
      return;
    }
    assignTo(s.roworder, active);
    flash("ok", `+ ${s.isn ?? s.sn} → ${locLabel(targets[active].rack, targets[active].location, targets[active].pallet)}`);
  }

  function onScanSubmit() {
    const code = scan.trim().toUpperCase();
    setScan("");
    if (!code || active === null) return;
    const s = byCode.get(code);
    if (!s) {
      flash("err", `ບໍ່ພົບ SN: ${code}`);
      return;
    }
    tryAddToActive(s);
  }

  const assignedToActive = useMemo(
    () => (active === null ? [] : serials.filter((s) => assign[s.roworder] === active)),
    [serials, assign, active],
  );
  const remaining = useMemo(() => {
    const s = q.trim().toLowerCase();
    return serials.filter((x) => {
      if (assign[x.roworder] === active) return false; // already in active list
      if (!s) return true;
      return (x.isn ?? x.sn ?? "").toLowerCase().includes(s);
    });
  }, [serials, assign, active, q]);

  const chosen = useMemo(() => Object.values(assign).filter((ti) => ti >= 0).length, [assign]);

  async function submit() {
    const assignments = serials
      .filter((s) => assign[s.roworder] != null && assign[s.roworder] >= 0)
      .map((s) => {
        const t = targets[assign[s.roworder]];
        return { id: s.roworder, rack: t.rack, location: t.location, pallet: t.pallet };
      });
    if (assignments.length === 0) {
      onDone("err", "ກະລຸນາເລືອກ SN ໄປ location ກ່ອນ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/sn-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: whCode, item_code: item.item_code, assignments }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; moved?: number; doc_no?: string | null };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      onDone("ok", `ຍ້າຍ ${data.moved ?? 0} SN${data.doc_no ? ` · ${data.doc_no}` : ""}`);
      onClose();
    } catch (err) {
      onDone("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      setSubmitting(false);
    }
  }

  const activeLabel = active !== null ? locLabel(targets[active].rack, targets[active].location, targets[active].pallet) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs font-bold text-aqua-600 dark:text-aqua-400">{item.item_code}</div>
            <div className="truncate text-xs text-zinc-500">{item.item_name}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 1. pick location */}
        <div className="border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
          <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">① ເລືອກ location ປາຍທາງ</div>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t, ti) => {
              const got = assignedCount[ti];
              const need = targetNeed[ti];
              const done = got >= need;
              const isActive = ti === active;
              return (
                <button
                  key={ti}
                  type="button"
                  onClick={() => setActive(ti)}
                  className={`rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold transition ${
                    isActive
                      ? "bg-aqua-600 text-white shadow"
                      : done
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                  }`}
                >
                  {locLabel(t.rack, t.location, t.pallet)} <span className={isActive ? "" : done ? "" : "text-amber-600 dark:text-amber-400"}>{got}/{need}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. scan SN into the active location */}
        {active !== null && (
          <div className="border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
            <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">② ຍິງ / ພິມ SN ເຂົ້າ <span className="font-mono text-aqua-600 dark:text-aqua-400">{activeLabel}</span></div>
            <div className="flex items-center gap-2">
              <input
                ref={scanRef}
                type="text"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScanSubmit(); } }}
                placeholder="ຍິງ barcode ຫຼື ພິມ ISN ແລ້ວ Enter..."
                className="flex-1 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-aqua-500 dark:bg-zinc-950 dark:ring-zinc-800"
              />
              <button type="button" onClick={onScanSubmit} className="rounded-lg bg-aqua-600 px-4 py-2 text-sm font-semibold text-white">ເພີ່ມ</button>
            </div>
            {scanMsg && (
              <div className={`mt-1.5 text-xs font-semibold ${scanMsg.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{scanMsg.text}</div>
            )}
          </div>
        )}

        {/* lists */}
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-100 overflow-hidden dark:divide-zinc-800">
          {/* assigned to active */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
              ໄປ {activeLabel || "—"} · {assignedToActive.length}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {assignedToActive.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">ຍັງບໍ່ມີ — ຍິງ SN ເຂົ້າ</p>
              ) : (
                assignedToActive.map((s) => (
                  <div key={s.roworder} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <span className="truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{s.isn ?? s.sn}</span>
                    <button type="button" onClick={() => assignTo(s.roworder, null)} className="shrink-0 rounded px-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" title="ເອົາອອກ">✕</button>
                  </div>
                ))
              )}
            </div>
          </div>
          {/* remaining */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/50">
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຍັງເຫຼືອ — ຄົ້ນຫາ / check ເພີ່ມ" className="w-full bg-transparent text-[11px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-200" />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {remaining.map((s) => {
                const other = assign[s.roworder];
                const elsewhere = other != null && other >= 0 && other !== active;
                return (
                  <button
                    key={s.roworder}
                    type="button"
                    onClick={() => tryAddToActive(s)}
                    disabled={active === null || assignedCount[active] >= targetNeed[active]}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition hover:bg-aqua-50 disabled:opacity-50 dark:hover:bg-aqua-950/20"
                  >
                    <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{s.isn ?? s.sn}</span>
                    {elsewhere ? (
                      <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">→ {locLabel(targets[other].rack, targets[other].location, targets[other].pallet)}</span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-zinc-400">{locLabel(s.rack, s.location, s.pallet)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. save */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">③ ເລືອກຍ້າຍ {chosen} / {serials.length} SN</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">ຍົກເລີກ</button>
            <button type="button" onClick={submit} disabled={submitting || chosen === 0} className="rounded-lg bg-gradient-to-r from-aqua-600 to-brand-700 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow disabled:opacity-50">
              {submitting ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກ ${chosen}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
