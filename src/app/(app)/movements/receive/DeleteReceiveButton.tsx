"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";

/** Void a receive (delete + revert) so it can be re-received. */
export default function DeleteReceiveButton({ docNo }: { docNo: string }) {
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
        setErr(data.error ?? "ລົບບໍ່ສຳເລັດ");
        return;
      }
      setOpen(false);
      router.refresh();
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
        title="ລົບໃບຮັບ (ຮັບໃໝ່ໄດ້)"
        className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:ring-rose-900/50 dark:hover:bg-rose-950/30"
      >
        {busy ? "..." : "ລົບ"}
      </button>
      <ConfirmModal
        open={open}
        title="ລົບໃບຮັບສິນຄ້ານີ້?"
        message={
          <>
            ໃບຮັບ <span className="font-mono font-semibold">{docNo}</span> — ຍອດຄົງເຫຼືອ + serial ທີ່ອອກຈາກໃບນີ້ຈະຖືກ revert (ຮັບໃໝ່ໄດ້).
            {err && <span className="mt-2 block font-semibold text-rose-600 dark:text-rose-400">{err}</span>}
          </>
        }
        confirmLabel="ລົບໃບຮັບ"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
