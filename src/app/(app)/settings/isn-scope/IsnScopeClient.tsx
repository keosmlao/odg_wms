"use client";

import { useMemo, useState } from "react";
import type { IsnCategoryRow, IsnItemRow, IsnItemHit } from "@/lib/isnScope";

type Tab = "category" | "item";

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const cardCls =
  "space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

export default function IsnScopeClient({
  initialCategories,
  initialOverrides,
  missingCategory,
}: {
  initialCategories: IsnCategoryRow[];
  initialOverrides: IsnItemRow[];
  missingCategory: { item_code: string; item_name: string | null; item_brand: string | null }[];
}) {
  const [tab, setTab] = useState<Tab>("category");
  const [cats, setCats] = useState(initialCategories);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [threshold, setThreshold] = useState("5");

  function showToast(k: "ok" | "err", t: string) {
    setToast({ k, t });
    setTimeout(() => setToast(null), 3000);
  }

  const totals = useMemo(() => {
    const on = cats.filter((c) => c.require_isn);
    return {
      onCats: on.length,
      onItems: on.reduce((s, c) => s + c.items, 0),
      serialItems: cats.reduce((s, c) => s + c.items_with_sn, 0),
      coveredSerial: on.reduce((s, c) => s + c.items_with_sn, 0),
    };
  }, [cats]);

  /** % ຂອງລາຍການໃນໝວດທີ່ມີ serial ຈິງ — ຕົວຕັດສິນວ່າໝວດນີ້ຄວນເກັບ ISN ບໍ. */
  const coverage = (c: IsnCategoryRow) => (c.items > 0 ? (c.items_with_sn / c.items) * 100 : 0);

  /**
   * ຜົນຂອງເກນ % ກ່ອນນຳໃຊ້ — ໃຫ້ເຫັນວ່າແລກຫຍັງກັບຫຍັງ: ຍິ່ງເກນສູງ ຍິ່ງບັງຄັບ
   * ເກັບ ISN ໜ້ອຍລົງ ແຕ່ອາດປ່ອຍສິນຄ້າທີ່ຖື serial ຈິງຫຼຸດອອກ.
   */
  const preview = useMemo(() => {
    const pct = Number.parseFloat(threshold);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    const on = cats.filter((c) => coverage(c) >= pct);
    return {
      pct,
      cats: on.length,
      items: on.reduce((s, c) => s + c.items, 0),
      covered: on.reduce((s, c) => s + c.items_with_sn, 0),
    };
  }, [cats, threshold]);

  /** ຕັ້ງທຸກໝວດຕາມເກນ — ຍັງບໍ່ບັນທຶກ ຈົນກວ່າຜູ້ໃຊ້ຈະກົດ “ບັນທຶກ”. */
  function applyThreshold(pct: number) {
    const changed: Record<string, boolean> = { ...dirty };
    const next = cats.map((c) => {
      const req = coverage(c) >= pct;
      if (req !== c.require_isn) changed[c.category_code] = true;
      return { ...c, require_isn: req };
    });
    setCats(next);
    setDirty(changed);
  }

  const shownCats = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return cats.filter((c) => {
      if (onlyOn && !c.require_isn) return false;
      if (!q) return true;
      return c.category_code.toLowerCase().includes(q) || (c.category_name ?? "").toLowerCase().includes(q);
    });
  }, [cats, filter, onlyOn]);

  function toggleCat(code: string) {
    setCats((p) => p.map((c) => (c.category_code === code ? { ...c, require_isn: !c.require_isn } : c)));
    setDirty((p) => ({ ...p, [code]: true }));
  }

  async function saveCats() {
    const changed = cats.filter((c) => dirty[c.category_code]);
    if (changed.length === 0) return showToast("err", "ຍັງບໍ່ມີການປ່ຽນແປງ");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/isn-scope", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: changed.map((c) => ({ category_code: c.category_code, require_isn: c.require_isn })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; categories?: IsnCategoryRow[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      if (data.categories) setCats(data.categories);
      setDirty({});
      showToast("ok", `ບັນທຶກ ${changed.length} ໝວດແລ້ວ`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ສະຫຼຸບ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ໝວດທີ່ເປີດ" value={`${totals.onCats} / ${cats.length}`} />
        <Stat label="ລາຍການທີ່ຕ້ອງເກັບ ISN" value={totals.onItems.toLocaleString()} />
        <Stat label="ຍົກເວັ້ນລາຍການ" value={overrides.length.toLocaleString()} />
        <Stat
          label="ຄຸມ serial ຈິງ"
          value={`${totals.coveredSerial.toLocaleString()} / ${totals.serialItems.toLocaleString()}`}
          hint={totals.coveredSerial < totals.serialItems ? "ມີສິນຄ້າທີ່ຖື serial ຢູ່ ແຕ່ໝວດປິດ" : undefined}
        />
      </div>

      {missingCategory.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <b>{missingCategory.length} ລາຍການ</b> ຖືກຕັ້ງໃຫ້ເກັບ ISN ແຕ່<b>ໝວດຫວ່າງ</b> — ອອກເລກ ISN ບໍ່ໄດ້
          (ໝວດຄື prefix ຂອງເລກ). ຕັ້ງໝວດໃຫ້ມັນໃນແທັບ “ຍົກເວັ້ນລາຍສິນຄ້າ”.
          <div className="mt-1 font-mono text-xs">
            {missingCategory.slice(0, 6).map((m) => m.item_code).join(" · ")}
            {missingCategory.length > 6 ? " …" : ""}
          </div>
        </div>
      )}

      {/* ແທັບ */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/60">
        {([
          ["category", `ໝວດ (${cats.length})`],
          ["item", `ຍົກເວັ້ນລາຍສິນຄ້າ (${overrides.length})`],
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

      {tab === "category" ? (
        <div className={cardCls}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ຄົ້ນລະຫັດ ຫຼື ຊື່ໝວດ"
              className={`flex-1 ${inputCls}`}
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />
              ສະເພາະທີ່ເປີດ
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">ຕັ້ງໄວ</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">ເປີດສະເພາະໝວດທີ່ມີ serial ຈິງ ≥</span>
            <input
              type="text"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              aria-label="ເປີເຊັນຂັ້ນຕ່ຳ"
              className="w-14 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">%</span>
            <button
              type="button"
              disabled={preview == null}
              onClick={() => preview != null && applyThreshold(preview.pct)}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ນຳໃຊ້
            </button>
            {preview && (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                → ເປີດ <b className="tabular-nums">{preview.cats}</b> ໝວດ ·{" "}
                <b className="tabular-nums">{preview.items.toLocaleString()}</b> ລາຍການຕ້ອງເກັບ ISN · ຄຸມ serial{" "}
                <b className="tabular-nums">{preview.covered.toLocaleString()}</b>/
                {totals.serialItems.toLocaleString()}
              </span>
            )}
            <span className="ml-auto text-[10px] text-zinc-400">
              ຕັ້ງແລ້ວຍັງບໍ່ບັນທຶກ — ກວດເບິ່ງກ່ອນກົດ “ບັນທຶກ”
            </span>
          </div>

          <div className="max-h-[calc(100dvh-30rem)] min-h-[18rem] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">ເກັບ ISN</th>
                  <th className="px-3 py-2">ໝວດ</th>
                  <th className="px-3 py-2 text-right">ລາຍການ</th>
                  <th className="px-3 py-2 text-right">ມີ serial ຈິງ</th>
                  <th className="px-3 py-2 text-right" title="ສັດສ່ວນລາຍການໃນໝວດທີ່ຖື serial ຈິງ">
                    % serial
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownCats.map((c) => (
                  <tr
                    key={c.category_code}
                    className={`border-t border-zinc-100 dark:border-zinc-800 ${
                      dirty[c.category_code] ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={c.require_isn}
                        onChange={() => toggleCat(c.category_code)}
                        aria-label={`ເກັບ ISN ໝວດ ${c.category_code}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">
                        {c.category_code}
                      </span>{" "}
                      <span className="text-zinc-800 dark:text-zinc-200">{c.category_name ?? "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {c.items.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {c.items_with_sn > 0 ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {c.items_with_sn.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-600">0</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <CoverageBadge pct={coverage(c)} />
                    </td>
                  </tr>
                ))}
                {shownCats.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-400">
                      ບໍ່ພົບໝວດ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {toast && (
              <span className={`text-xs font-semibold ${toast.k === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                {toast.t}
              </span>
            )}
            <button
              type="button"
              onClick={saveCats}
              disabled={saving || Object.keys(dirty).length === 0}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກ (${Object.keys(dirty).length})`}
            </button>
          </div>
        </div>
      ) : (
        <ItemTab overrides={overrides} setOverrides={setOverrides} showToast={showToast} toast={toast} />
      )}
    </div>
  );
}

/** ສີ: ຂຽວ = ໝວດຄຸມ serial ແທ້ · ເຫຼືອງ = ປົນກັນ · ເທົາ = ແທບບໍ່ມີ serial ເລີຍ. */
function CoverageBadge({ pct }: { pct: number }) {
  if (pct <= 0) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  const tone =
    pct >= 20
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 5
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-400 dark:text-zinc-500";
  return <span className={`font-semibold ${tone}`}>{pct < 1 ? pct.toFixed(1) : Math.round(pct)}%</span>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">{hint}</div>}
    </div>
  );
}

// ─────────────────────── ແທັບ: ຍົກເວັ້ນລາຍສິນຄ້າ ───────────────────────

function ItemTab({
  overrides,
  setOverrides,
  showToast,
  toast,
}: {
  overrides: IsnItemRow[];
  setOverrides: (rows: IsnItemRow[]) => void;
  showToast: (k: "ok" | "err", t: string) => void;
  toast: { k: "ok" | "err"; t: string } | null;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<IsnItemHit[]>([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    const term = q.trim();
    if (!term) return setHits([]);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/isn-scope?q=${encodeURIComponent(term)}`);
      const data = (await res.json()) as { items?: IsnItemHit[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ຄົ້ນບໍ່ສຳເລັດ");
      setHits(data.items ?? []);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ຄົ້ນບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  async function setOverride(itemCode: string, requireIsn: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/isn-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_code: itemCode, require_isn: requireIsn }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; overrides?: IsnItemRow[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      if (data.overrides) setOverrides(data.overrides);
      setHits((p) => p.map((h) => (h.item_code === itemCode ? { ...h, needs_isn: requireIsn, is_override: true } : h)));
      showToast("ok", `${itemCode} → ${requireIsn ? "ຕ້ອງເກັບ ISN" : "ບໍ່ຕ້ອງເກັບ ISN"}`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(itemCode: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/isn-scope?item=${encodeURIComponent(itemCode)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string; overrides?: IsnItemRow[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ລົບບໍ່ສຳເລັດ");
      if (data.overrides) setOverrides(data.overrides);
      setHits((p) => p.map((h) => (h.item_code === itemCode ? { ...h, is_override: false } : h)));
      showToast("ok", `${itemCode} ກັບໄປໃຊ້ຄ່າຂອງໝວດ`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ລົບບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(itemCode: string, categoryCode: string) {
    const cat = categoryCode.trim();
    if (!cat) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/isn-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_code: itemCode, category_code: cat }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ຕັ້ງໝວດບໍ່ສຳເລັດ");
      setHits((p) => p.map((h) => (h.item_code === itemCode ? { ...h, category: cat } : h)));
      showToast("ok", `${itemCode} → ໝວດ ${cat}`);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ຕັ້ງໝວດບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardCls}>
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="ຄົ້ນລະຫັດ ຫຼື ຊື່ສິນຄ້າ ແລ້ວ Enter"
          className={`flex-1 ${inputCls}`}
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          ຄົ້ນ
        </button>
      </div>

      {hits.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          {hits.map((h) => (
            <div
              key={h.item_code}
              className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {h.item_code}
                  </span>
                  {h.has_serial && (
                    <span className="rounded bg-aqua-100 px-1 py-0.5 text-[9px] font-bold text-aqua-700 dark:bg-aqua-950/50 dark:text-aqua-300">
                      ມີ serial
                    </span>
                  )}
                  {h.is_override && (
                    <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                      ຍົກເວັ້ນ
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-zinc-700 dark:text-zinc-300">{h.item_name ?? "—"}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  ໝວດ:
                  {h.category ? (
                    <span className="font-mono">
                      {h.category} {h.category_name ? `· ${h.category_name}` : ""}
                    </span>
                  ) : (
                    <CategoryInput onSave={(v) => void saveCategory(h.item_code, v)} disabled={busy} />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    h.needs_isn
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {h.needs_isn ? "ເກັບ ISN" : "ບໍ່ເກັບ"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setOverride(h.item_code, !h.needs_isn)}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {h.needs_isn ? "ປິດ" : "ເປີດ"}
                </button>
                {h.is_override && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeOverride(h.item_code)}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-rose-500 disabled:opacity-50"
                    title="ລົບຍົກເວັ້ນ — ກັບໄປໃຊ້ຄ່າຂອງໝວດ"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          ຍົກເວັ້ນທີ່ຕັ້ງໄວ້ ({overrides.length})
        </div>
        {overrides.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
            ຍັງບໍ່ມີຍົກເວັ້ນ — ທຸກລາຍການໃຊ້ຄ່າຂອງໝວດມັນ
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            {overrides.map((o) => (
              <div
                key={o.item_code}
                className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {o.item_code}
                  </span>
                  <div className="truncate text-sm text-zinc-700 dark:text-zinc-300">{o.item_name ?? "—"}</div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    ໝວດ {o.category ?? "—"} ({o.category_require_isn ? "ເປີດ" : "ປິດ"}) → ທັບເປັນ{" "}
                    <b>{o.require_isn ? "ເກັບ ISN" : "ບໍ່ເກັບ"}</b>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeOverride(o.item_code)}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-rose-500 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="flex justify-end">
          <span className={`text-xs font-semibold ${toast.k === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
            {toast.t}
          </span>
        </div>
      )}
    </div>
  );
}

/** ຕັ້ງໝວດໃຫ້ສິນຄ້າທີ່ໝວດຫວ່າງ (ຂຽນລົງ ic_inventory.item_category). */
function CategoryInput({ onSave, disabled }: { onSave: (v: string) => void; disabled: boolean }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-amber-600 dark:text-amber-400">ຫວ່າງ</span>
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(v);
          }
        }}
        placeholder="ລະຫັດໝວດ"
        className="w-24 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button
        type="button"
        disabled={disabled || !v.trim()}
        onClick={() => onSave(v)}
        className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] disabled:opacity-40 dark:border-zinc-700"
      >
        ຕັ້ງ
      </button>
    </span>
  );
}
