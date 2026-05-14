"use client";

import { useState } from "react";
import ItemMovementsDrawer from "./ItemMovementsDrawer";

type BalanceItem = {
  ic_code: string | null;
  ic_name: string | null;
  ic_unit_code: string | null;
  balance_qty: string | null;
};

type SelectedItem = { code: string; name: string | null };

type LoadState = "idle" | "loading" | "ready" | "error";

const PAGE_SIZE = 50;

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return value?.toString() ?? "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default function BalanceLocationItems({
  warehouse,
  rack = "",
  location = "",
  pallet = "",
  buttonLabel = "ໂຫຼດລາຍການສິນຄ້າ",
}: {
  warehouse: string;
  /** rack code (shelf_code). "" = items at warehouse-level only */
  rack?: string;
  /** location code (shelf_code1). "" = items at rack-level only */
  location?: string;
  /** pallet code. "" = items not on a pallet */
  pallet?: string;
  buttonLabel?: string;
}) {
  const [items, setItems] = useState<BalanceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>("idle");
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  async function load(offset = 0) {
    setState("loading");
    try {
      const params = new URLSearchParams({
        warehouse,
        rack,
        location,
        pallet,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`/api/movements/balance-items?${params}`);
      const data = (await res.json()) as {
        items?: BalanceItem[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Load failed");
      setItems((prev) =>
        offset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])],
      );
      setTotal(data.total ?? 0);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => load()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {buttonLabel}
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        ໂຫຼດລາຍການບໍ່ສຳເລັດ
      </div>
    );
  }

  return (
    <>
    <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="grid grid-cols-[minmax(220px,1fr)_120px_90px] gap-3 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
        <div>ສິນຄ້າ</div>
        <div className="text-right">ຄົງເຫຼືອ</div>
        <div>ຫົວໜ່ວຍ</div>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((item) => (
          <button
            type="button"
            key={item.ic_code ?? `${item.ic_name}-${items.indexOf(item)}`}
            disabled={!item.ic_code}
            onClick={() =>
              item.ic_code &&
              setSelected({ code: item.ic_code, name: item.ic_name })
            }
            className="grid w-full grid-cols-[minmax(220px,1fr)_120px_90px] gap-3 px-3 py-2 text-left text-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800/50"
            title="ກົດເພື່ອເບິ່ງປະຫວັດການເຄື່ອນໄຫວ"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                {item.ic_code ?? "-"}
              </div>
              <div
                className="mt-0.5 truncate text-zinc-700 dark:text-zinc-300"
                title={item.ic_name ?? ""}
              >
                {item.ic_name ?? "-"}
              </div>
            </div>
            <div className="text-right font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatQty(item.balance_qty)}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {item.ic_unit_code ?? "-"}
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          ສະແດງ {items.length.toLocaleString("en-US")} /{" "}
          {total.toLocaleString("en-US")}
        </div>
        {items.length < total && (
          <button
            type="button"
            disabled={state === "loading"}
            onClick={() => load(items.length)}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {state === "loading" ? "ກຳລັງໂຫຼດ..." : "ໂຫຼດເພີ່ມ"}
          </button>
        )}
      </div>
    </div>
    <ItemMovementsDrawer
      open={selected !== null}
      itemCode={selected?.code ?? ""}
      itemName={selected?.name ?? null}
      warehouse={warehouse}
      location={location || rack || ""}
      onClose={() => setSelected(null)}
    />
    </>
  );
}
