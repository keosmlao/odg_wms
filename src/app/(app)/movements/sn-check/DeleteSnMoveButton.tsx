"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Delete (undo) a serial-relocation document: restores every serial to its
 * original location and removes the sn_trans / sn_trans_detail records.
 */
export default function DeleteSnMoveButton({ docNo, snCount }: { docNo: string; snCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function doDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/sn-check?doc=${encodeURIComponent(docNo)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string; restored?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ລົບບໍ່ສຳເລັດ");
      setBusy(false);
      setConfirming(false);
    }
  }

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={(e) => { stop(e); setConfirming(true); }}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 dark:bg-zinc-900 dark:text-rose-400 dark:ring-rose-900/50 dark:hover:bg-rose-950/30"
        title="ລົບ + ຄືນ SN ໄປ location ເດີມ"
      >
        ລົບ
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" onClick={stop}>
      <button
        type="button"
        onClick={doDelete}
        disabled={busy}
        className="rounded-lg bg-gradient-to-r from-rose-500 to-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:shadow disabled:opacity-50"
        title={`ຄືນ ${snCount} SN ໄປ location ເດີມ ແລ້ວລຶບໃບນີ້`}
      >
        {busy ? "ກຳລັງລົບ..." : "ຢືນຢັນລົບ"}
      </button>
      <button type="button" onClick={(e) => { stop(e); setConfirming(false); }} disabled={busy} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">
        ຍົກເລີກ
      </button>
    </span>
  );
}
