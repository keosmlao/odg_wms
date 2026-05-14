"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BootstrapManagerButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bootstrap-manager", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
        return;
      }
      router.refresh();
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {loading ? "ກຳລັງຕັ້ງຄ່າ..." : "ຕັ້ງຕົນເອງເປັນ manager ຄົນທຳອິດ"}
      </button>
      {error && (
        <div className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
