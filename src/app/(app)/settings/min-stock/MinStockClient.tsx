"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MinStockItemHit, MinStockRule, MinStockWarehouse } from "@/lib/minStock";

type Tab = "warehouses" | "rules" | "import";
type Draft = { min: string; max: string; note: string };

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const cardCls =
  "space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

const fmt = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 4 });

function draftOf(r: MinStockRule): Draft {
  return { min: String(r.min_qty), max: r.max_qty === null ? "" : String(r.max_qty), note: r.note ?? "" };
}

export default function MinStockClient({
  initialWarehouses,
  initialWh,
  initialRules,
}: {
  initialWarehouses: MinStockWarehouse[];
  initialWh: string;
  initialRules: MinStockRule[];
}) {
  const [tab, setTab] = useState<Tab>(initialWarehouses.some((w) => w.enabled) ? "rules" : "warehouses");
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [wh, setWh] = useState(initialWh);
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filter, setFilter] = useState("");
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  // ຄົ້ນສິນຄ້າເພື່ອເພີ່ມກົດໃໝ່
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<MinStockItemHit[]>([]);
  const [searching, setSearching] = useState(false);

  const current = warehouses.find((w) => w.wh_code === wh) ?? null;

  function showToast(k: "ok" | "err", t: string) {
    setToast({ k, t });
    setTimeout(() => setToast(null), 3000);
  }

  // ຄົ້ນສິນຄ້າ (debounce 300ms)
  useEffect(() => {
    const q = search.trim();
    if (!wh || q.length < 2) { setHits([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/min-stock?wh=${encodeURIComponent(wh)}&q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { items?: MinStockItemHit[] };
        if (!cancelled) setHits(data.items ?? []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, wh]);

  async function loadRules(code: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/min-stock?wh=${encodeURIComponent(code)}`);
      const data = (await res.json()) as { rules?: MinStockRule[]; warehouses?: MinStockWarehouse[] };
      setRules(data.rules ?? []);
      if (data.warehouses) setWarehouses(data.warehouses);
      setDrafts({});
    } catch {
      showToast("err", "ໂຫຼດບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  function selectWarehouse(code: string) {
    setWh(code);
    setFilter("");
    setSearch("");
    void loadRules(code);
  }

  async function toggleWarehouse(code: string, enabled: boolean) {
    setWarehouses((p) => p.map((w) => (w.wh_code === code ? { ...w, enabled } : w)));
    try {
      const res = await fetch("/api/admin/min-stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: code, enabled }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; warehouses?: MinStockWarehouse[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      if (data.warehouses) setWarehouses(data.warehouses);
      showToast("ok", `${enabled ? "ເປີດ" : "ປິດ"}ການຄຸມສາງ ${code} ແລ້ວ`);
    } catch (e) {
      setWarehouses((p) => p.map((w) => (w.wh_code === code ? { ...w, enabled: !enabled } : w)));
      showToast("err", e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    }
  }

  function editDraft(item: string, patch: Partial<Draft>) {
    setDrafts((p) => {
      const base = p[item] ?? draftOf(rules.find((r) => r.item_code === item) ?? ({ min_qty: 0, max_qty: null, note: null } as MinStockRule));
      return { ...p, [item]: { ...base, ...patch } };
    });
  }

  async function saveDrafts() {
    const changed = Object.entries(drafts);
    if (changed.length === 0) return showToast("err", "ຍັງບໍ່ມີການປ່ຽນແປງ");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/min-stock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: wh,
          rules: changed.map(([item_code, d]) => ({
            item_code,
            min_qty: d.min.trim() === "" ? 0 : d.min,
            max_qty: d.max.trim() === "" ? null : d.max,
            note: d.note.trim() || null,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; saved?: number; rules?: MinStockRule[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      setRules(data.rules ?? []);
      setDrafts({});
      await refreshWarehouseStats();
      showToast("ok", `ບັນທຶກ ${data.saved ?? changed.length} ລາຍການແລ້ວ`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  async function refreshWarehouseStats() {
    try {
      const res = await fetch("/api/admin/min-stock");
      const data = (await res.json()) as { warehouses?: MinStockWarehouse[] };
      if (data.warehouses) setWarehouses(data.warehouses);
    } catch {
      // ສະຖິຕິບໍ່ຄົບບໍ່ແມ່ນເລື່ອງໃຫຍ່ — ຄ່າທີ່ຕັ້ງບັນທຶກໄປແລ້ວ
    }
  }

  async function removeRule(item: string) {
    if (!confirm(`ລົບກົດຂອງ ${item} ໃນສາງ ${wh}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/min-stock?wh=${encodeURIComponent(wh)}&item=${encodeURIComponent(item)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string; rules?: MinStockRule[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ລົບບໍ່ສຳເລັດ");
      setRules(data.rules ?? []);
      setDrafts((p) => { const n = { ...p }; delete n[item]; return n; });
      await refreshWarehouseStats();
      showToast("ok", "ລົບແລ້ວ");
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ລົບບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  /** ເພີ່ມສິນຄ້າຈາກຜົນຄົ້ນ — ໃສ່ເປັນແຖວຮ່າງ (ຂັ້ນຕ່ຳ 0) ໃຫ້ພິມຄ່າແລ້ວກົດບັນທຶກ. */
  function addItem(hit: MinStockItemHit) {
    if (!rules.some((r) => r.item_code === hit.item_code)) {
      setRules((p) => [
        {
          wh_code: wh,
          wh_name: current?.wh_name ?? null,
          item_code: hit.item_code,
          item_name: hit.item_name,
          unit_code: hit.unit_code,
          min_qty: hit.min_qty ?? 0,
          max_qty: hit.max_qty,
          note: null,
          on_hand: hit.on_hand,
          status: "ok",
          shortfall: 0,
          excess: 0,
          updated_at: null,
          updated_by: null,
        },
        ...p,
      ]);
    }
    editDraft(hit.item_code, {
      min: String(hit.min_qty ?? 0),
      max: hit.max_qty === null || hit.max_qty === undefined ? "" : String(hit.max_qty),
      note: "",
    });
    setSearch("");
    setHits([]);
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rules.filter((r) => {
      if (onlyBelow && r.status !== "below") return false;
      if (!q) return true;
      return r.item_code.toLowerCase().includes(q) || (r.item_name ?? "").toLowerCase().includes(q);
    });
  }, [rules, filter, onlyBelow]);

  const dirtyCount = Object.keys(drafts).length;
  const enabledCount = warehouses.filter((w) => w.enabled).length;
  const totalBelow = warehouses.filter((w) => w.enabled).reduce((s, w) => s + w.below, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ສາງທີ່ເປີດຄຸມ" value={`${enabledCount} / ${warehouses.length}`} />
        <Stat label="ລາຍການທີ່ຕັ້ງ (ສາງນີ້)" value={rules.length.toLocaleString()} />
        <Stat label="ຕ່ຳກວ່າຂັ້ນຕ່ຳ (ສາງນີ້)" value={rules.filter((r) => r.status === "below").length.toLocaleString()} tone="warn" />
        <Stat label="ຕ່ຳກວ່າຂັ້ນຕ່ຳ (ທຸກສາງທີ່ເປີດ)" value={totalBelow.toLocaleString()} tone="warn" />
      </div>

      {enabledCount === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          ຍັງບໍ່ມີສາງໃດເປີດຄຸມ — ຕັ້ງຄ່າໄວ້ໄດ້ ແຕ່ຈະຍັງບໍ່ມີການເຕືອນຈົນກວ່າຈະເປີດສາງໃນແທັບ “ສາງທີ່ຄຸມ”.
        </div>
      )}

      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/60">
        {([
          ["warehouses", `ສາງທີ່ຄຸມ (${enabledCount})`],
          ["rules", `ຄ່າ min/max (${rules.length})`],
          ["import", "ນຳເຂົ້າ Excel"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === k
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "warehouses" ? (
        <div className={cardCls}>
          <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">ຄຸມ</th>
                  <th className="px-3 py-2">ສາງ</th>
                  <th className="px-3 py-2 text-right">ລາຍການທີ່ຕັ້ງ</th>
                  <th className="px-3 py-2 text-right">ຕ່ຳກວ່າຂັ້ນຕ່ຳ</th>
                  <th className="px-3 py-2 text-right">ເກີນຂັ້ນສູງ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.wh_code} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={w.enabled}
                        onChange={(e) => void toggleWarehouse(w.wh_code, e.target.checked)}
                        aria-label={`ຄຸມ min/max ສາງ ${w.wh_code}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">{w.wh_code}</span>{" "}
                      <span className="text-zinc-800 dark:text-zinc-200">{w.wh_name ?? "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {w.rules.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {w.below > 0 ? (
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{w.below.toLocaleString()}</span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-600">0</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {w.above > 0 ? (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">{w.above.toLocaleString()}</span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-600">0</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => { selectWarehouse(w.wh_code); setTab("rules"); }}
                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        ຕັ້ງຄ່າ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "rules" ? (
        <div className={cardCls}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={wh} onChange={(e) => selectWarehouse(e.target.value)} className={inputCls}>
              {warehouses.map((w) => (
                <option key={w.wh_code} value={w.wh_code}>
                  {w.wh_code} · {w.wh_name ?? ""}{w.enabled ? "" : " (ບໍ່ໄດ້ເປີດຄຸມ)"}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ກັ່ນຕອງລາຍການທີ່ຕັ້ງແລ້ວ"
              className={`flex-1 ${inputCls}`}
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} />
              ສະເພາະທີ່ຕ່ຳກວ່າ
            </label>
            <button
              type="button"
              onClick={() => void saveDrafts()}
              disabled={busy || dirtyCount === 0}
              className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກ${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
            </button>
          </div>

          {/* ເພີ່ມສິນຄ້າໃໝ່ */}
          <div className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ເພີ່ມສິນຄ້າ — ພິມລະຫັດ ຫຼື ຊື່ (ຢ່າງໜ້ອຍ 2 ຕົວ)"
              className={`w-full ${inputCls}`}
            />
            {searching && <div className="text-xs text-zinc-400">ກຳລັງຄົ້ນ...</div>}
            {hits.length > 0 && (
              <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {hits.map((h) => (
                  <li key={h.item_code}>
                    <button
                      type="button"
                      onClick={() => addItem(h)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">{h.item_code}</span>{" "}
                        <span className="text-zinc-800 dark:text-zinc-200">{h.item_name ?? "—"}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                        ຄົງເຫຼືອ {fmt(h.on_hand)}
                        {h.min_qty !== null && <span className="ml-2 text-emerald-600 dark:text-emerald-400">ຕັ້ງແລ້ວ</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">ສິນຄ້າ</th>
                  <th className="px-3 py-2 text-right">ຄົງເຫຼືອ</th>
                  <th className="px-3 py-2 text-right">ຂັ້ນຕ່ຳ</th>
                  <th className="px-3 py-2 text-right">ຂັ້ນສູງ</th>
                  <th className="px-3 py-2">ໝາຍເຫດ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const d = drafts[r.item_code];
                  return (
                    <tr
                      key={r.item_code}
                      className={`border-t border-zinc-100 dark:border-zinc-800 ${d ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">{r.item_code}</span>
                          {r.status === "below" && (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-extrabold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                              ຕ່ຳກວ່າ
                            </span>
                          )}
                          {r.status === "above" && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              ເກີນ
                            </span>
                          )}
                        </div>
                        <div className="max-w-md truncate text-zinc-800 dark:text-zinc-200" title={r.item_name ?? ""}>
                          {r.item_name ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {fmt(r.on_hand)}
                        <span className="ml-1 text-[10px] text-zinc-400">{r.unit_code ?? ""}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={d ? d.min : String(r.min_qty)}
                          onChange={(e) => editDraft(r.item_code, { min: e.target.value })}
                          className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="—"
                          value={d ? d.max : r.max_qty === null ? "" : String(r.max_qty)}
                          onChange={(e) => editDraft(r.item_code, { max: e.target.value })}
                          className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={d ? d.note : r.note ?? ""}
                          onChange={(e) => editDraft(r.item_code, { note: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => void removeRule(r.item_code)}
                          title="ລົບກົດຂອງລາຍການນີ້"
                          className="rounded p-1 text-zinc-300 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-400">
                      ຍັງບໍ່ມີລາຍການທີ່ຕັ້ງຄ່າໃນສາງນີ້
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ImportPanel
          wh={wh}
          warehouses={warehouses}
          onWarehouseChange={selectWarehouse}
          onImported={(next) => { setRules(next); setDrafts({}); void refreshWarehouseStats(); }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${
            toast.k === "ok" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          {toast.t}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 font-mono text-lg font-bold ${
          tone === "warn" ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

type ImportSummary = { rows_read: number; rows_valid: number; rows_invalid: number; saved: number; cleared: number };

function ImportPanel({
  wh,
  warehouses,
  onWarehouseChange,
  onImported,
}: {
  wh: string;
  warehouses: MinStockWarehouse[];
  onWarehouseChange: (code: string) => void;
  onImported: (rules: MinStockRule[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok?: boolean; error?: string; summary?: ImportSummary; errors?: { row: number; message: string }[];
  } | null>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setResult({ error: "ກະລຸນາເລືອກໄຟລ໌ .xlsx" });
      return;
    }
    setResult(null);
    setFile(f);
  }

  async function submit() {
    if (!file || busy || !wh) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("wh", wh);
      if (replace) fd.append("mode", "replace");
      const res = await fetch("/api/admin/min-stock/import", { method: "POST", body: fd });
      const data = (await res.json()) as {
        ok?: boolean; error?: string; summary?: ImportSummary;
        errors?: { row: number; message: string }[]; rules?: MinStockRule[];
      };
      setResult(data);
      if (res.ok && data.ok && data.rules) onImported(data.rules);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={wh} onChange={(e) => onWarehouseChange(e.target.value)} className={inputCls}>
          {warehouses.map((w) => (
            <option key={w.wh_code} value={w.wh_code}>
              {w.wh_code} · {w.wh_name ?? ""}
            </option>
          ))}
        </select>
        <a
          href={`/api/admin/min-stock/import?wh=${encodeURIComponent(wh)}`}
          className="text-xs font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
        >
          ດາວໂຫຼດ template (ພ້ອມຄ່າປັດຈຸບັນ)
        </a>
      </div>

      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        ຄໍລຳ: <b>ລະຫັດສິນຄ້າ</b> · <b>ຊື່ສິນຄ້າ</b> · <b>ຂັ້ນຕ່ຳ</b> · <b>ຂັ້ນສູງ</b> · <b>ໝາຍເຫດ</b>{" "}
        (ຂັ້ນສູງ ວ່າງໄວ້ = ບໍ່ຄຸມ)
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 px-4 py-6 text-center transition hover:border-brand-300 dark:border-zinc-700 dark:hover:border-brand-700">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        {file ? (
          <>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{file.name}</div>
            <div className="text-[11px] text-zinc-500">{(file.size / 1024).toFixed(1)} KB · ກົດເພື່ອປ່ຽນ</div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">ກົດເພື່ອເລືອກໄຟລ໌</div>
            <div className="text-[11px] text-zinc-500">.xlsx ສູງສຸດ 5MB</div>
          </>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          ລົບຄ່າເກົ່າຂອງສາງນີ້ກ່ອນ (ແທນທີ່ທັງໝົດ)
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!file || busy}
          className="flex-1 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "ກຳລັງນຳເຂົ້າ..." : "ນຳເຂົ້າ"}
        </button>
      </div>

      {result?.error && !s && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300">
          {result.error}
        </div>
      )}

      {s && (
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            ອ່ານ <b>{s.rows_read}</b> ແຖວ · ບັນທຶກ <b className="text-emerald-600 dark:text-emerald-400">{s.saved}</b>
            {s.cleared > 0 && <> · ລົບຂອງເກົ່າ <b>{s.cleared}</b></>}
            {s.rows_invalid > 0 && <> · ຂ້າມ <b className="text-amber-600 dark:text-amber-400">{s.rows_invalid}</b></>}
          </div>
          {result?.errors && result.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-amber-700 dark:text-amber-400">
                ດູຂໍ້ຜິດພາດ ({result.errors.length})
              </summary>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-white p-2 text-[11px] dark:bg-zinc-950">
                {result.errors.map((er, i) => (
                  <li key={i} className="font-mono text-zinc-600 dark:text-zinc-400">
                    {er.row > 0 ? `ແຖວ ${er.row}: ` : ""}{er.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
