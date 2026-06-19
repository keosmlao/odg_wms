"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";

/**
 * Edit a posted receive = void it (revert stock/serial, reopen its count sheet as
 * a draft) then jump to the count sheet to fix the qty/serials and re-receive.
 */
export default function EditReceiveButton({ docNo, countNo }: { docNo: string; countNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function ask(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    setOpen(true);
  }

  async function onConfirm() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/receive/${encodeURIComponent(docNo)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setErr(data.error ?? "ແກ້ໄຂບໍ່ສຳເລັດ");
        return;
      }
      router.push(`/movements/receive/count/${encodeURIComponent(countNo)}`);
    } catch {
      setErr("ເຊື່ອມຕໍ່ບໍ່ໄດ້");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={ask}
        disabled={busy}
        title="ແກ້ໄຂ (ຍ້ອນໃບ + ເປີດໃບກວດນັບ)"
        className="rounded-md px-2 py-1 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-200 transition hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:ring-amber-900/50 dark:hover:bg-amber-950/30"
      >
        {busy ? "..." : "ແກ້ໄຂ"}
      </button>
      <ConfirmModal
        open={open}
        title="ແກ້ໄຂໃບຮັບສິນຄ້ານີ້?"
        message={
          <>
            ໃບຮັບ <span className="font-mono font-semibold">{docNo}</span> ຈະຖືກຍ້ອນ (revert stock + serial) ແລ້ວເປີດໃບກວດນັບ <span className="font-mono font-semibold">{countNo}</span> ໃຫ້ແກ້ ແລະ ຮັບໃໝ່.
            {err && <span className="mt-2 block font-semibold text-rose-600 dark:text-rose-400">{err}</span>}
          </>
        }
        confirmLabel="ຍ້ອນ ແລະ ແກ້ໄຂ"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
