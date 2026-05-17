"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({
  depositId,
  depositCode,
  status,
}: {
  depositId: number;
  depositCode: string;
  status: "active" | "settled" | "cancelled";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const warning =
      status === "settled"
        ? `⚠️ ການຮັບຝາກນີ້ສຳເລັດແລ້ວ — ມີຂໍ້ມູນຮັບເງິນ.\n\nລົບ ${depositCode}? ບໍ່ສາມາດກູ້ຄືນໄດ້.`
        : `ລົບ ${depositCode}?\nຂໍ້ມູນທັງໝົດຈະຖືກລົບ ແລະ ບໍ່ສາມາດກູ້ຄືນໄດ້.`;
    if (!confirm(warning)) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/deposits/${depositId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.push("/deposits");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:bg-zinc-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
    >
      {busy ? "ກຳລັງລົບ..." : "ລົບການຮັບຝາກ (ຜູ້ຈັດການ)"}
    </button>
  );
}
