"use client";

import { useState } from "react";

export default function SnDualBrandsClient({ initialBrands }: { initialBrands: string[] }) {
  const [brands, setBrands] = useState<string[]>(initialBrands);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 2800); }

  function addBrand() {
    const b = input.trim();
    if (!b) return;
    if (brands.some((x) => x.toUpperCase() === b.toUpperCase())) { showToast("err", "ມີຢູ່ແລ້ວ"); setInput(""); return; }
    setBrands((p) => [...p, b].sort((a, c) => a.localeCompare(c)));
    setInput("");
  }
  function removeBrand(b: string) {
    setBrands((p) => p.filter((x) => x !== b));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sn-dual-brands", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brands }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; brands?: string[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      setBrands(data.brands ?? brands);
      showToast("ok", "ບັນທຶກແລ້ວ");
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBrand(); } }}
          placeholder="ພິມຊື່ຍີ່ຫໍ້ ເຊັ່ນ SAMSUNG ແລ້ວ Enter"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <button type="button" onClick={addBrand} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">+ ເພີ່ມ</button>
      </div>

      {brands.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
          ຍັງບໍ່ມີຍີ່ຫໍ້ — ຈະບໍ່ມີການບັງຄັບ sn+isn ຕອນຈ່າຍ
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/40">
              {b}
              <button type="button" onClick={() => removeBrand(b)} className="text-blue-400 hover:text-rose-500" aria-label={`ລົບ ${b}`}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {toast && <span className={`text-xs font-semibold ${toast.k === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{toast.t}</span>}
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
        </button>
      </div>
    </div>
  );
}
