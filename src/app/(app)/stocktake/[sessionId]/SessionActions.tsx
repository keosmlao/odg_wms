"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "open" | "pending_approval" | "closed";

export default function SessionActions({
  sessionId,
  status,
  blind,
  role,
}: {
  sessionId: number;
  status: Status;
  blind: boolean;
  role: "manager" | "supervisor" | "keeper";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const isManager = role === "manager";
  const canApprove = role === "manager" || role === "supervisor";

  async function send(body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stocktake/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function toggleBlind() {
    await send({ action: "update", blind: !blind });
  }

  async function submitForApproval() {
    await send(
      { action: "submit" },
      "ສົ່ງຮອບກວດນັບເພື່ອອະນຸມັດ?\nຫຼັງສົ່ງແລ້ວຈະບໍ່ສາມາດແກ້ໄຂການນັບໄດ້.",
    );
  }

  async function approve() {
    const note = prompt(
      "ບັນທຶກອະນຸມັດ (optional):\nຕົວຢ່າງ: ກວດສອບແລ້ວ, ສ່ວນຕ່າງເຫດຜົນ X",
      "",
    );
    if (note === null) return;
    await send(
      { action: "approve", approval_note: note },
      "ຢຶນຍັນອະນຸມັດ ແລະ ປິດຮອບກວດນັບ?",
    );
  }

  async function reject() {
    const note = prompt("ເຫດຜົນປະຕິເສດ:", "");
    if (note === null) return;
    if (!note.trim()) {
      alert("ກະລຸນາລະບຸເຫດຜົນ");
      return;
    }
    await send({ action: "reject", approval_note: note });
  }

  async function reopen() {
    await send(
      { action: "reopen" },
      "ເປີດຮອບກວດນັບຄືນ?\nການອະນຸມັດທີ່ມີຢູ່ຈະຖືກລ້າງ.",
    );
  }

  async function remove() {
    if (
      !confirm(
        "ລຶບຮອບກວດນັບນີ້ພ້ອມຂໍ້ມູນທັງໝົດ? ບໍ່ສາມາດກູ້ຄືນໄດ້",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stocktake/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      window.location.href = "/stocktake";
    } catch (err) {
      alert(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {status === "open" && (
        <>
          {canApprove && (
            <button
              type="button"
              onClick={toggleBlind}
              disabled={busy}
              title="Blind mode = counter ບໍ່ເຫັນ SML balance (supervisor/manager ເທົ່ານັ້ນ)"
              className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
            >
              {blind ? "🙈 Blind: ON" : "👁️ Blind: OFF"}
            </button>
          )}
          <button
            type="button"
            onClick={submitForApproval}
            disabled={busy}
            className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
          >
            ສົ່ງເພື່ອອະນຸມັດ
          </button>
        </>
      )}

      {status === "pending_approval" && canApprove && (
        <>
          <button
            type="button"
            onClick={reject}
            disabled={busy}
            className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-60 dark:bg-zinc-900 dark:text-red-400 dark:ring-red-900/50"
          >
            ປະຕິເສດ
          </button>
          <button
            type="button"
            onClick={approve}
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
          >
            ✓ ອະນຸມັດ ແລະ ປິດ
          </button>
        </>
      )}

      {status === "pending_approval" && !canApprove && (
        <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
          ລໍຖ້າ supervisor ອະນຸມັດ
        </span>
      )}

      {status === "closed" && canApprove && (
        <button
          type="button"
          onClick={reopen}
          disabled={busy}
          className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
        >
          ເປີດຄືນ
        </button>
      )}

      {isManager && status !== "closed" && (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="ລຶບ session (ບໍ່ໃຫ້ລຶບ session ທີ່ປິດແລ້ວ — ກວດສອບ trail)"
          className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-60 dark:bg-zinc-900 dark:text-red-400 dark:ring-red-900/50"
        >
          ລຶບ
        </button>
      )}
    </div>
  );
}
