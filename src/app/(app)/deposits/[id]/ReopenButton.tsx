"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReopenButton({ depositId }: { depositId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reopen() {
    if (
      !confirm("ເປີດຄືນ?\nການຮັບເງິນທີ່ມີຢູ່ຈະຖືກລົບ — ສາມາດສຳເລັດໃໝ່ໄດ້.")
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/deposits/${depositId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reopen}
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      {busy ? "ກຳລັງ..." : "ເປີດຄືນ (ຜູ້ຈັດການ)"}
    </button>
  );
}
