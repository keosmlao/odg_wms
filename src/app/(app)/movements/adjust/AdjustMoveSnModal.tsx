"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Serial = { sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null };

function norm(v: string | null | undefined) {
  return (v ?? "").trim();
}
function nodePath(n: { rack: string; location: string; pallet: string }) {
  const parts = [n.rack, n.location].filter(Boolean);
  if (n.pallet) parts.push(`pallet:${n.pallet}`);
  return parts.length ? parts.join(" / ") : "ບໍ່ລະບຸ (ສາງລວມ)";
}

/**
 * ເລືອກ SN ທີ່ຈະຍ້າຍຈາກ **ຈຸດທີ 1 → ຈຸດທີ 2**.
 *
 * ສະແດງສະເພາະ SN ທີ່ຢູ່ ຈຸດທີ 1 ຈິງໆ (ກອງຢູ່ client ອີກຊັ້ນ ເພາະ API ບໍ່ກອງ node
 * ທີ່ເປັນຄ່າຫວ່າງ) — ເພາະ server ຮັບການຍ້າຍສະເພາະ SN ທີ່ນອນຢູ່ ຈຸດທີ 1 ເທົ່ານັ້ນ.
 */
export default function AdjustMoveSnModal({
  whCode,
  from,
  to,
  item,
  initial,
  onClose,
  onDone,
}: {
  whCode: string;
  from: { rack: string; location: string; pallet: string };
  to: { rack: string; location: string; pallet: string };
  item: { item_code: string; item_name: string | null };
  initial: string[];
  onClose: () => void;
  onDone: (serials: string[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          warehouse: whCode,
          item: item.item_code,
          rack: from.rack,
          location: from.location,
          pallet: from.pallet,
          limit: "2000",
        });
        const res = await fetch(`/api/movements/item-serials?${params}`);
        const data = (await res.json()) as { serials?: Serial[] };
        if (!cancelled) setSerials(data.serials ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [whCode, item.item_code, from.rack, from.location, from.pallet]);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 1800);
  }
  const idOf = (s: Serial) => s.sn ?? s.isn ?? "";

  // ຢູ່ ຈຸດທີ 1 ແທ້ໆ — API ບໍ່ກອງ field ທີ່ຫວ່າງ, ຈຶ່ງກອງຢ້ຳຢູ່ນີ້.
  const atFrom = useMemo(
    () =>
      serials.filter(
        (s) => norm(s.rack) === from.rack && norm(s.location) === from.location && norm(s.pallet) === from.pallet,
      ),
    [serials, from.rack, from.location, from.pallet],
  );
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? atFrom.filter((s) => idOf(s).toLowerCase().includes(needle) || (s.isn ?? "").toLowerCase().includes(needle)) : atFrom),
    [atFrom, needle],
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function onScan() {
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const hit = atFrom.find(
      (s) => idOf(s).toUpperCase() === code.toUpperCase() || norm(s.isn).toUpperCase() === code.toUpperCase(),
    );
    if (!hit) {
      flash("err", `ບໍ່ພົບ ${code} ຢູ່ ຈຸດທີ 1`);
      return;
    }
    const id = idOf(hit);
    if (picked.has(id)) flash("err", `ເລືອກແລ້ວ: ${id}`);
    else {
      toggle(id);
      flash("ok", `✓ ${id}`);
    }
    setTimeout(() => scanRef.current?.focus(), 30);
  }

  const allShownPicked = shown.length > 0 && shown.every((s) => picked.has(idOf(s)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">{item.item_code}</div>
            <div className="truncate text-xs text-zinc-500">{item.item_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                ຈຸດທີ 1 · {nodePath(from)}
              </span>
              <span className="text-zinc-400">→</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                ຈຸດທີ 2 · {nodePath(to)}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase text-zinc-400">ເລືອກແລ້ວ</div>
            <div className="font-mono text-lg font-bold tabular-nums text-brand-600 dark:text-brand-400">{picked.size}</div>
          </div>
        </div>

        <div className="border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <input
              ref={scanRef}
              type="text"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onScan();
                }
              }}
              placeholder="ຍິງ / ພິມ ISN ຫຼື SN ແລ້ວ Enter ເພື່ອເລືອກ..."
              className="flex-1 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
            />
            <button
              type="button"
              onClick={() => setPicked(allShownPicked ? new Set() : new Set(shown.map(idOf)))}
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {allShownPicked ? "ຍົກເລີກທັງໝົດ" : "ເລືອກທັງໝົດ"}
            </button>
          </div>
          {msg && (
            <div className={`mt-1 text-xs font-semibold ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>
          )}
        </div>

        <div className="border-b border-zinc-100 px-5 py-1.5 dark:border-zinc-800">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ຄົ້ນຫາ ISN / SN..."
            className="w-full rounded-lg bg-white px-2.5 py-1 text-xs ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {loading ? (
            <p className="py-8 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">ບໍ່ມີ SN ຢູ່ ຈຸດທີ 1</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {shown.map((s) => {
                const id = idOf(s);
                const checked = picked.has(id);
                return (
                  <label
                    key={id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${
                      checked ? "bg-brand-50 dark:bg-brand-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="h-4 w-4 accent-brand-600" />
                    <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-200">{id}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">
            ຢູ່ ຈຸດທີ 1 ທັງໝົດ {atFrom.length} · ຈະຍ້າຍ {picked.size}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            >
              ຍົກເລີກ
            </button>
            <button
              type="button"
              onClick={() => onDone([...picked])}
              className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-5 py-2 text-xs font-semibold text-white shadow-sm"
            >
              ນຳໃຊ້ ({picked.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
