"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, CheckIcon, PlusIcon } from "@/components/ui/Icons";
import {
  DEFECT_GRADES,
  DEFECT_STATUS,
  type DefectEntry,
  type DefectImage,
  type DefectWarehouseOption,
} from "@/lib/defects-shared";

/**
 * Edit panel for one defect entry, expanded under its table row: the editable
 * fields, its photos, its audit trail, and the issue/un-issue action.
 *
 * Only rendered when a row is actually expanded, so the photos and history of
 * dozens of rows are never fetched just to show the table.
 */

type HistoryRow = {
  round: number;
  warehouse: string | null;
  user_created: string | null;
  at: string | null;
};

const inputCls =
  "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition focus:ring-2 focus:ring-rose-500/40 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

function fmtQty(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

export default function DefectEntryEditor({
  entry,
  warehouses,
  onChanged,
}: {
  entry: DefectEntry;
  warehouses: DefectWarehouseOption[];
  /** Fired after a save/issue/photo change so the page can refetch. */
  onChanged: () => void;
}) {
  const [qty, setQty] = useState(entry.qty);
  const [wh, setWh] = useState(entry.warehouse ?? "");
  const [sn, setSn] = useState(entry.sn ?? "");
  const [grade, setGrade] = useState(entry.grade ?? "");
  const [remark, setRemark] = useState(entry.remark ?? "");
  const [images, setImages] = useState<DefectImage[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const toast = useToast();
  const [broken, setBroken] = useState<Record<number, true>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/defects/${encodeURIComponent(entry.code_ref)}`);
    const data = (await res.json()) as {
      images?: DefectImage[];
      history?: HistoryRow[];
      error?: string;
    };
    if (res.ok) {
      setImages(data.images ?? []);
      setHistory(data.history ?? []);
      setBroken({});
    }
  }, [entry.code_ref]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/defects/${encodeURIComponent(entry.code_ref)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty, warehouse: wh, sn, grade, remark }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setMsg({ tone: "ok", text: "ບັນທຶກແລ້ວ" });
      await loadDetail();
      onChanged();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * ເບີກຈ່າຍ / ຍົກເລີກການເບີກຈ່າຍ.
   *
   * ບໍ່ມີກ່ອງຖາມ “ແນ່ໃຈບໍ່?” ອີກຕໍ່ໄປ — ການກະທຳນີ້ຄືນຄ່າໄດ້ (API ຮັບ `undo`)
   * ຈຶ່ງເຮັດເລີຍແລ້ວໃຫ້ປຸ່ມ “ຍົກເລີກ” ຢູ່ໃນແຈ້ງເຕືອນ. ໄວກວ່າ ແລະ ປອດໄພກວ່າ:
   * ກ່ອງຖາມຢືນຢັນທີ່ຂຶ້ນທຸກເທື່ອ ສຸດທ້າຍຄົນຈະກົດ “ຕົກລົງ” ໂດຍບໍ່ອ່ານ.
   */
  async function setIssued(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/defects/${encodeURIComponent(entry.code_ref)}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo: !next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      onChanged();
      return true;
    } catch (e) {
      const text = e instanceof Error ? e.message : "ບໍ່ສຳເລັດ";
      setMsg({ tone: "err", text });
      toast.show({ message: text, tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleIssue() {
    const wasIssued = entry.status === DEFECT_STATUS.dispatched;
    const ok = await setIssued(!wasIssued);
    if (!ok) return;
    toast.show({
      message: wasIssued ? "ຍົກເລີກການເບີກຈ່າຍແລ້ວ" : "ເບີກຈ່າຍອອກແລ້ວ",
      detail: `#${entry.code_ref} · ${fmtQty(entry.qty)} ${entry.unit_code ?? ""}`,
      tone: "ok",
      undo: { onUndo: () => void setIssued(wasIssued) },
    });
  }

  async function upload(files: FileList) {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch(`/api/defects/${encodeURIComponent(entry.code_ref)}/images`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      await loadDetail();
      onChanged();
      setMsg({ tone: "ok", text: "ອັບໂຫຼດຮູບແລ້ວ" });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeImage(line: number) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/defects/${encodeURIComponent(entry.code_ref)}/images?line=${line}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      await loadDetail();
      onChanged();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  const issued = entry.status === DEFECT_STATUS.dispatched;

  return (
    <div className="border-y border-rose-100 bg-rose-50/40 px-4 py-4 dark:border-rose-950/40 dark:bg-rose-950/10">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ຈຳນວນ *</span>
          <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ສາງ *</span>
          <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
            <option value="">— ເລືອກສາງ —</option>
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} · {w.name ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">SN / ໝາຍເລກເຄື່ອງ</span>
          <input type="text" value={sn} onChange={(e) => setSn(e.target.value)} placeholder="ສະແກນ ຫຼື ພິມ..." className={`${inputCls} font-mono`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ເກຣດສະພາບ *</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className={inputCls}>
            <option value="">— ເລືອກເກຣດ —</option>
            {DEFECT_GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ໝາຍເຫດ / ອາການຕຳນິ</span>
          <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} className={inputCls} />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">ຮູບພາບ ({images.length})</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
            <PlusIcon className="h-3 w-3" />
            ເພິ່ມຮູບ
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && e.target.files.length > 0 && void upload(e.target.files)}
            />
          </label>
        </div>
        {images.length === 0 ? (
          <p className="text-[11px] italic text-zinc-400">ຍັງບໍ່ມີຮູບພາບ</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {images.map((img) => (
              <div key={img.line_number} className="group relative overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                {broken[img.line_number] ? (
                  // 67 legacy rows point at files that are no longer on disk —
                  // say so instead of showing a broken-image icon.
                  <div className="flex h-24 flex-col items-center justify-center gap-1 bg-zinc-100 px-1 text-center dark:bg-zinc-800">
                    <span className="text-lg leading-none text-zinc-400">🚫</span>
                    <span className="text-[9px] font-semibold text-zinc-500">ຮູບຫາຍ</span>
                  </div>
                ) : (
                  <a href={img.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.image_url}
                      loading="lazy"
                      onError={() => setBroken((p) => ({ ...p, [img.line_number]: true }))}
                      className="h-24 w-full object-cover transition group-hover:scale-105"
                    />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void removeImage(img.line_number)}
                  disabled={busy}
                  aria-label="ລຶບຮູບ"
                  className="absolute right-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <p className="mt-3 text-[10px] text-zinc-400">
          ແກ້ໄຂ {history.length} ຮອບ · ຄັ້ງລ່າສຸດ {history[history.length - 1].at ?? "—"} ໂດຍ{" "}
          {history[history.length - 1].user_created ?? "—"}
        </p>
      )}

      {msg && (
        <p className={`mt-3 text-xs font-semibold ${msg.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
        >
          <CheckIcon className="h-3.5 w-3.5" />
          {busy ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກການແກ້ໄຂ"}
        </button>
        <button
          type="button"
          onClick={() => void toggleIssue()}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50 ${
            issued
              ? "bg-gradient-to-r from-zinc-500 to-zinc-600 shadow-zinc-500/20"
              : "bg-gradient-to-r from-rose-500 to-red-600 shadow-rose-500/20"
          }`}
        >
          <AlertIcon className="h-3.5 w-3.5" />
          {issued ? "ຍົກເລີກການເບີກຈ່າຍ" : "ເບີກຈ່າຍອອກ"}
        </button>
      </div>

    </div>
  );
}
