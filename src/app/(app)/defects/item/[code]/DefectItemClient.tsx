"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, SearchIcon } from "@/components/ui/Icons";
import {
  DEFECT_STATUS,
  type DefectEntry,
  type DefectImage,
  type DefectWarehouseOption,
} from "@/lib/defects-shared";
import DefectEntryEditor from "../../_components/DefectEntryEditor";

/**
 * One line per entry — because 1,048 of the 1,057 open entries are a single
 * serialised unit, this table is effectively an SN list. Everything constant for
 * the whole page (item name, warehouse, unit) lives in the header instead of
 * being repeated on every row.
 *
 * Photos show as thumbnails on the row itself (they arrive with the row data, so
 * no extra request per entry) and open full size on click — the evidence is the
 * point of this register, so it should not be hidden behind an expand toggle.
 *
 * Selecting rows enables a single batched issue-out, so a 41-unit item takes one
 * action instead of 41.
 */

const inputCls =
  "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-rose-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

function fmtQty(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-[10px] italic text-zinc-400">—</span>;
  const tone =
    grade === "A"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
      : grade === "B"
        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50"
        : "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50";
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${tone}`}>
      {grade}
    </span>
  );
}

export default function DefectItemClient({
  code,
  wh,
  status,
  initialRows,
  warehouses,
}: {
  code: string;
  wh: string;
  status: 0 | 1;
  initialRows: DefectEntry[];
  warehouses: DefectWarehouseOption[];
}) {
  const [rows, setRows] = useState<DefectEntry[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openRef, setOpenRef] = useState<string | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ photos: DefectImage[]; index: number; caption: string } | null>(null);
  const [broken, setBroken] = useState<Record<string, true>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ code, status: String(status) });
      if (wh) params.set("wh", wh);
      const res = await fetch(`/api/defects/lines?${params}`);
      const data = (await res.json()) as { rows?: DefectEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setRows(data.rows ?? []);
      // Entries that moved to the other status are gone from this list — drop
      // them from the selection so the count can't claim rows that aren't shown.
      const present = new Set((data.rows ?? []).map((r) => r.code_ref));
      setSelected((prev) => new Set([...prev].filter((r) => present.has(r))));
      setOpenRef((prev) => (prev && present.has(prev) ? prev : null));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }, [code, wh, status]);

  // Esc closes the lightbox; ←/→ step through that entry's photos.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft")
        setLightbox((p) => (p ? { ...p, index: (p.index - 1 + p.photos.length) % p.photos.length } : p));
      if (e.key === "ArrowRight")
        setLightbox((p) => (p ? { ...p, index: (p.index + 1) % p.photos.length } : p));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.sn ?? "").toLowerCase().includes(s) ||
        r.code_ref.includes(s) ||
        (r.remark ?? "").toLowerCase().includes(s),
    );
  }, [rows, q]);

  // Anything identical across every row is noise in the table — show it once.
  const allSameRemark =
    rows.length > 1 && new Set(rows.map((r) => r.remark ?? "")).size === 1 ? (rows[0].remark ?? "") : null;
  const allQtyOne = rows.length > 0 && rows.every((r) => Number.parseFloat(r.qty) === 1);
  const totalQty = rows.reduce((sum, r) => sum + (Number.parseFloat(r.qty) || 0), 0);

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.code_ref));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) for (const r of filtered) next.delete(r.code_ref);
      else for (const r of filtered) next.add(r.code_ref);
      return next;
    });
  }
  function toggleOne(ref: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  const issued = status === DEFECT_STATUS.dispatched;

  /** ຮຽກ API ເບີກຈ່າຍ/ຄືນ ສຳລັບຊຸດ ref ທີ່ລະບຸ. ຄືນ true ເມື່ອສຳເລັດ. */
  async function applyBulk(refs: string[], undo: boolean) {
    if (refs.length === 0) return false;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/defects/withdraw-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs, undo }),
      });
      const data = (await res.json()) as { changed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      await reload();
      return true;
    } catch (e) {
      const text = e instanceof Error ? e.message : "ບໍ່ສຳເລັດ";
      setErr(text);
      toast.show({ message: text, tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * ເບີກຈ່າຍ / ຍົກເລີກ ຫຼາຍລາຍການພ້ອມກັນ.
   *
   * ເຮັດເລີຍ ແລ້ວໃຫ້ປຸ່ມ “ຍົກເລີກ” 6 ວິນາທີ ແທນກ່ອງຖາມຢືນຢັນ — API ຮັບ `undo`
   * ຢູ່ແລ້ວ ຈຶ່ງຄືນສະພາບເກົ່າໄດ້ຄົບຖ້ວນດ້ວຍ ref ຊຸດເກົ່າ.
   */
  async function bulkIssue() {
    const refs = [...selected];
    const wasIssued = issued;
    const qty = selectedQty;
    const unit = rows[0]?.unit_code ?? "";
    const ok = await applyBulk(refs, wasIssued);
    if (!ok) return;
    setSelected(new Set());
    toast.show({
      message: wasIssued
        ? `ຍົກເລີກການເບີກຈ່າຍ ${refs.length} ລາຍການ`
        : `ເບີກຈ່າຍ ${refs.length} ລາຍການແລ້ວ`,
      detail: `${fmtQty(qty)} ${unit}`,
      tone: "ok",
      undo: { onUndo: () => void applyBulk(refs, !wasIssued) },
    });
  }

  const selectedQty = rows
    .filter((r) => selected.has(r.code_ref))
    .reduce((sum, r) => sum + (Number.parseFloat(r.qty) || 0), 0);

  return (
    <div className="space-y-4">
      {allSameRemark && (
        <div className="rounded-xl bg-zinc-50 px-4 py-2.5 text-xs text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
          <span className="font-semibold">ໝາຍເຫດ (ຄືກັນທຸກລາຍການ):</span> {allSameRemark}
        </div>
      )}

      {/* Toolbar — selection count + bulk action + filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-rose-500"
            />
            ເລືອກທັງໝົດ ({filtered.length})
          </label>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => void bulkIssue()}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50 ${
                issued
                  ? "bg-gradient-to-r from-zinc-500 to-zinc-600 shadow-zinc-500/20"
                  : "bg-gradient-to-r from-rose-500 to-red-600 shadow-rose-500/20"
              }`}
            >
              <AlertIcon className="h-3.5 w-3.5" />
              {issued
                ? `ຍົກເລີກການເບີກຈ່າຍ ${selected.size} ລາຍການ`
                : `ເບີກຈ່າຍ ${selected.size} ລາຍການທີ່ເລືອກ`}
            </button>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[11px] font-semibold text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              ລ້າງການເລືອກ
            </button>
          )}
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ຄົ້ນຫາ / ສະແກນ SN..."
            className={`${inputCls} py-2 pl-8 font-mono text-xs`}
          />
        </div>
      </div>

      {err && (
        <div className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50">
          {err}
        </div>
      )}

      {/* One line per entry */}
      <div className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
              <th className="w-8 px-3 py-2.5 print:hidden"></th>
              <th className="px-3 py-2.5">ເລກອ້າງອີງ</th>
              <th className="px-3 py-2.5">SN / ໝາຍເລກເຄື່ອງ</th>
              <th className="px-3 py-2.5 text-center">ເກຣດ</th>
              {!allQtyOne && <th className="px-3 py-2.5 text-right">ຈຳນວນ</th>}
              <th className="px-3 py-2.5">ວັນທີບັນທຶກ</th>
              {!allSameRemark && <th className="px-3 py-2.5">ໝາຍເຫດ</th>}
              {wh === "" && <th className="px-3 py-2.5">ສາງ</th>}
              <th className="px-3 py-2.5 text-center">ຮູບ</th>
              <th className="w-16 px-3 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {loading ? "ກຳລັງໂຫຼດ..." : q ? `ບໍ່ພົບ "${q}"` : "ບໍ່ມີລາຍການ"}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const isOpen = openRef === r.code_ref;
              const isSel = selected.has(r.code_ref);
              return (
                <Fragment key={r.code_ref}>
                  <tr
                    className={`transition ${isSel ? "bg-rose-50/60 dark:bg-rose-950/20" : "hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"}`}
                  >
                    <td className="px-3 py-2 print:hidden">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleOne(r.code_ref)}
                        aria-label={`ເລືອກ ${r.code_ref}`}
                        className="h-4 w-4 accent-rose-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        #{r.code_ref}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                      {r.sn ?? <span className="italic font-sans text-zinc-400">ບໍ່ມີ SN</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <GradeBadge grade={r.grade} />
                    </td>
                    {!allQtyOne && (
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-200">
                        {fmtQty(r.qty)}
                      </td>
                    )}
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">{r.date_register ?? "—"}</td>
                    {!allSameRemark && (
                      <td className="max-w-[16rem] truncate px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400" title={r.remark ?? ""}>
                        {r.remark || "—"}
                      </td>
                    )}
                    {wh === "" && (
                      <td className="px-3 py-2 text-[11px] text-zinc-500">
                        <span className="font-mono">{r.warehouse}</span>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {r.photos.length === 0 ? (
                        <span className="text-[11px] text-zinc-300 dark:text-zinc-600">—</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {r.photos.slice(0, 3).map((p, i) =>
                            broken[p.image_url] ? (
                              <span
                                key={p.image_url}
                                title={`ຮູບຫາຍ: ${p.image_url}`}
                                className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-[9px] text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
                              >
                                🚫
                              </span>
                            ) : (
                              <button
                                key={p.image_url}
                                type="button"
                                onClick={() =>
                                  setLightbox({ photos: r.photos, index: i, caption: `#${r.code_ref} · ${r.sn ?? ""}` })
                                }
                                className="overflow-hidden rounded-md ring-1 ring-zinc-200 transition hover:ring-2 hover:ring-rose-400 dark:ring-zinc-700"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={p.url}
                                  alt={p.image_url}
                                  loading="lazy"
                                  onError={() => setBroken((prev) => ({ ...prev, [p.image_url]: true }))}
                                  className="h-10 w-10 object-cover"
                                />
                              </button>
                            ),
                          )}
                          {r.photos.length > 3 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({ photos: r.photos, index: 3, caption: `#${r.code_ref} · ${r.sn ?? ""}` })
                              }
                              className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
                            >
                              +{r.photos.length - 3}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right print:hidden">
                      <button
                        type="button"
                        onClick={() => setOpenRef(isOpen ? null : r.code_ref)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
                          isOpen
                            ? "bg-rose-500 text-white ring-rose-500"
                            : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                        }`}
                      >
                        {isOpen ? "ປິດ" : "ແກ້ໄຂ"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="print:hidden">
                      <td colSpan={10} className="p-0">
                        <DefectEntryEditor
                          entry={r}
                          warehouses={warehouses}
                          onChanged={() => void reload()}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-800/50">
                <td className="px-3 py-2.5 print:hidden" />
                <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300" colSpan={2}>
                  ລວມ {rows.length} ລາຍການ
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400" colSpan={2}>
                  {fmtQty(totalQty)} {rows[0]?.unit_code ?? ""}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {selected.size > 0 && (
        <p className="text-[11px] text-zinc-500 print:hidden">
          ເລືອກແລ້ວ {selected.size} ລາຍການ · {fmtQty(selectedQty)} {rows[0]?.unit_code ?? ""}
        </p>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 print:hidden">
          <button
            type="button"
            aria-label="ປິດ"
            onClick={() => setLightbox(null)}
            className="absolute inset-0 bg-zinc-900/85 backdrop-blur-sm"
          />
          <div className="relative flex max-h-full w-full max-w-4xl flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.photos[lightbox.index].url}
              alt={lightbox.photos[lightbox.index].image_url}
              className="max-h-[78vh] rounded-xl shadow-2xl"
            />
            <div className="flex items-center gap-3 text-xs font-semibold text-white">
              {lightbox.photos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightbox((p) =>
                      p ? { ...p, index: (p.index - 1 + p.photos.length) % p.photos.length } : p,
                    )
                  }
                  className="rounded-lg bg-white/15 px-3 py-1.5 transition hover:bg-white/25"
                >
                  ← ກ່ອນ
                </button>
              )}
              <span className="font-mono">
                {lightbox.caption}
                {lightbox.photos.length > 1 && ` · ${lightbox.index + 1}/${lightbox.photos.length}`}
              </span>
              {lightbox.photos.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setLightbox((p) => (p ? { ...p, index: (p.index + 1) % p.photos.length } : p))
                  }
                  className="rounded-lg bg-white/15 px-3 py-1.5 transition hover:bg-white/25"
                >
                  ຕໍ່ໄປ →
                </button>
              )}
              <a
                href={lightbox.photos[lightbox.index].url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-white/15 px-3 py-1.5 transition hover:bg-white/25"
              >
                ເປີດເຕັມຈໍ
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-lg bg-white/15 px-3 py-1.5 transition hover:bg-white/25"
              >
                ປິດ (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
