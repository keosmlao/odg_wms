"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Serial = { sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null };

export type SerialPlan = { serialsRemove: string[]; serialsAdd: string[]; serialsGenerate: number };

function norm(v: string | null | undefined) {
  return (v ?? "").trim();
}
function locLabel(s: { rack: string | null; location: string | null; pallet: string | null }) {
  return [s.rack, s.location, s.pallet].map(norm).filter(Boolean).join(" / ") || "(ສາງ)";
}

/**
 * Manage the serials of one item during a stock adjustment.
 *  - shows the ISN at the selected node (remove candidates)
 *  - shows the ISN elsewhere in the warehouse (add → relocate here)
 *  - scan any ISN/SN: if it exists in the system add it, else create a new one
 *  - generate N brand-new ISN
 * Resulting count = before − removed + added + generated.
 */
export default function AdjustSerialModal({
  whCode,
  rack,
  location,
  pallet,
  item,
  initial,
  onClose,
  onDone,
}: {
  whCode: string;
  rack: string;
  location: string;
  pallet: string;
  item: { item_code: string; item_name: string | null; before: number };
  initial: SerialPlan;
  onClose: () => void;
  onDone: (plan: SerialPlan) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [serials, setSerials] = useState<Serial[]>([]); // all in-stock serials in the warehouse
  const [removeSet, setRemoveSet] = useState<Set<string>>(new Set(initial.serialsRemove));
  const [addList, setAddList] = useState<{ code: string; isNew: boolean }[]>(initial.serialsAdd.map((c) => ({ code: c, isNew: false })));
  const [generate, setGenerate] = useState<number>(initial.serialsGenerate);
  const [scan, setScan] = useState("");
  const [pendingNew, setPendingNew] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Load every in-stock serial of this item across the warehouse.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/movements/item-serials?warehouse=${encodeURIComponent(whCode)}&item=${encodeURIComponent(item.item_code)}&limit=2000`);
        const data = (await res.json()) as { serials?: Serial[] };
        if (!cancelled) setSerials(data.serials ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [whCode, item.item_code]);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 1800);
  }
  const idOf = (s: Serial) => s.isn ?? s.sn ?? "";

  const atNode = useMemo(
    () => serials.filter((s) => norm(s.rack) === norm(rack) && norm(s.location) === norm(location) && norm(s.pallet) === norm(pallet)),
    [serials, rack, location, pallet],
  );
  const elsewhere = useMemo(
    () => serials.filter((s) => !(norm(s.rack) === norm(rack) && norm(s.location) === norm(location) && norm(s.pallet) === norm(pallet))),
    [serials, rack, location, pallet],
  );
  const addedSet = useMemo(() => new Set(addList.map((a) => a.code.toUpperCase())), [addList]);
  const atNodeIds = useMemo(() => new Set(atNode.map(idOf)), [atNode]);

  function addCode(code: string, isNew: boolean) {
    if (addList.some((a) => a.code.toUpperCase() === code.toUpperCase())) return;
    setAddList((p) => [{ code, isNew }, ...p]);
  }
  function toggleRemove(id: string) {
    setRemoveSet((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function onScan() {
    const code = scan.trim();
    setScan("");
    setPendingNew(null);
    if (!code) return;
    if (addedSet.has(code.toUpperCase())) {
      flash("err", `ມີໃນລາຍການເພີ່ມແລ້ວ: ${code}`);
      return;
    }
    if (atNodeIds.has(code)) {
      flash("err", `${code} ມີຢູ່ບ່ອນນີ້ແລ້ວ`);
      return;
    }
    // exists elsewhere in the just-loaded list? add directly.
    const local = serials.find((s) => idOf(s).toUpperCase() === code.toUpperCase() || norm(s.sn).toUpperCase() === code.toUpperCase());
    if (local) {
      addCode(idOf(local), false);
      flash("ok", `+ ${idOf(local)} (ຈาก ${locLabel(local)})`);
      setTimeout(() => scanRef.current?.focus(), 30);
      return;
    }
    // otherwise check the wider system.
    setChecking(true);
    try {
      const res = await fetch(`/api/movements/item-serials/lookup?item=${encodeURIComponent(item.item_code)}&code=${encodeURIComponent(code)}&wh=${encodeURIComponent(whCode)}`);
      const data = (await res.json()) as { found?: boolean; isn?: string | null; in_stock?: boolean };
      if (data.found) {
        addCode(data.isn ?? code, false);
        flash("ok", `+ ${data.isn ?? code} (ມີໃນລະບบ${data.in_stock ? "" : " · ເຄີຍຈ່າຍ"})`);
        setTimeout(() => scanRef.current?.focus(), 30);
      } else {
        setPendingNew(code);
        flash("err", `ບໍ່ພົບ '${code}' ໃນລະບບ`);
      }
    } catch {
      flash("err", "ກວດບໍ່ສຳເລັດ");
    } finally {
      setChecking(false);
    }
  }

  const removeCount = removeSet.size;
  const addCount = addList.length;
  const after = item.before - removeCount + addCount + generate;
  const delta = addCount + generate - removeCount;

  const needle = q.trim().toLowerCase();
  const fAtNode = useMemo(() => (needle ? atNode.filter((s) => idOf(s).toLowerCase().includes(needle)) : atNode), [atNode, needle]);
  const fElsewhere = useMemo(
    () => (needle ? elsewhere.filter((s) => idOf(s).toLowerCase().includes(needle) || locLabel(s).toLowerCase().includes(needle)) : elsewhere),
    [elsewhere, needle],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">{item.item_code}</div>
            <div className="truncate text-xs text-zinc-500">{item.item_name} · ບ່ອນເລືອກ: <span className="font-mono">{locLabel({ rack, location, pallet })}</span></div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase text-zinc-400">ຍอด {item.before} → <b className={delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-zinc-500"}>{after}</b></div>
            <div className={`font-mono text-sm font-bold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : delta < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-400"}`}>{delta > 0 ? "+" : ""}{delta}</div>
          </div>
        </div>

        {/* scan + generate */}
        <div className="border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <input ref={scanRef} type="text" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(); } }} placeholder="ຍິງ / ພິມ ISN ຫຼື SN ແລ້ວ Enter (ມີໃນລະບບ → ເພີ່ມ)..." className="flex-1 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:ring-zinc-800" />
            <button type="button" onClick={onScan} disabled={checking} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{checking ? "..." : "ກວດ"}</button>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500">gen</span>
              <input type="number" min={0} value={generate || ""} onChange={(e) => setGenerate(Math.max(0, Number.parseInt(e.target.value, 10) || 0))} placeholder="0" title="generate ISN ໃໝ່" className="w-14 rounded-lg bg-white px-2 py-1.5 text-center text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:ring-zinc-800" />
            </div>
          </div>
          {msg && <div className={`mt-1 text-xs font-semibold ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>}
          {pendingNew && (
            <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900/50">
              <span className="text-[11px] text-amber-700 dark:text-amber-300">ບໍ່ພົບ <b className="font-mono">{pendingNew}</b> ໃນລະບບ</span>
              <button type="button" onClick={() => { addCode(pendingNew, true); flash("ok", `+ ${pendingNew} (ໃໝ່)`); setPendingNew(null); setTimeout(() => scanRef.current?.focus(), 30); }} className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600">ສ້າງ ISN ໃໝ່</button>
              <button type="button" onClick={() => setPendingNew(null)} className="rounded-md px-1.5 py-1 text-[11px] text-zinc-500">ຍົກເລີກ</button>
            </div>
          )}
          {addList.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {addList.map((a) => (
                <span key={a.code} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ring-1 ${a.isNew ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50" : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50"}`}>
                  {a.code}{a.isNew ? " ✦ໃໝ່" : ""}<button type="button" onClick={() => setAddList((p) => p.filter((x) => x.code !== a.code))} className="hover:text-rose-600">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* search */}
        <div className="border-b border-zinc-100 px-5 py-1.5 dark:border-zinc-800">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ຄົ້ນຫາ ISN / location..." className="w-full rounded-lg bg-white px-2.5 py-1 text-xs ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800" />
        </div>

        {/* two lists */}
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-100 overflow-hidden dark:divide-zinc-800">
          {/* at this node → remove */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold text-rose-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-rose-400">
              ➖ ຢູ່ບ່ອນນີ້ · {atNode.length} (ຕິກ = ເອົາອອກ)
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {loading ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">ກຳລັງໂຫຼດ...</p>
              ) : fAtNode.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">ບໍ່ມີ SN ຢູ່ບ່ອນນີ້</p>
              ) : (
                fAtNode.map((s) => {
                  const id = idOf(s);
                  const checked = removeSet.has(id);
                  return (
                    <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${checked ? "bg-rose-50 dark:bg-rose-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleRemove(id)} className="h-4 w-4 accent-rose-600" />
                      <span className={`font-mono text-[11px] ${checked ? "text-rose-700 line-through dark:text-rose-300" : "text-zinc-700 dark:text-zinc-200"}`}>{id}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          {/* elsewhere in warehouse → add */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-emerald-400">
              ➕ ຢູ່ບ່ອນອື່ນໃນສາງ · {elsewhere.length} (ກົດ = ຍ້າຍມາ)
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {loading ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">ກຳລັງໂຫຼດ...</p>
              ) : fElsewhere.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">ບໍ່ມີ SN ບ່ອນອື່ນ</p>
              ) : (
                fElsewhere.map((s) => {
                  const id = idOf(s);
                  const added = addedSet.has(id.toUpperCase());
                  return (
                    <button key={id} type="button" disabled={added} onClick={() => { addCode(id, false); flash("ok", `+ ${id}`); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/20">
                      <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{id}</span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400">{added ? "ເລືອກແລ້ວ" : locLabel(s)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">ເອົາອອກ {removeCount} · ເພີ່ມ {addCount} · gen {generate}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">ຍົກເລີກ</button>
            <button type="button" onClick={() => onDone({ serialsRemove: [...removeSet], serialsAdd: addList.map((a) => a.code), serialsGenerate: generate })} className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-5 py-2 text-xs font-semibold text-white shadow-sm">ນຳໃຊ້ (Δ {delta > 0 ? "+" : ""}{delta})</button>
          </div>
        </div>
      </div>
    </div>
  );
}
