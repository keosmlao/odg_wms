"use client";

import { useEffect, useState } from "react";
import type { MovementRow } from "@/app/api/movements/item-history/route";

const PAGE_SIZE = 50;

type Scope = "rack" | "warehouse" | "all";

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return value?.toString() ?? "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("lo-LA");
  } catch {
    return d;
  }
}

export default function ItemMovementsDrawer({
  open,
  itemCode,
  itemName,
  warehouse,
  location,
  onClose,
}: {
  open: boolean;
  itemCode: string;
  itemName: string | null;
  warehouse: string;
  location: string;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("rack");
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !itemCode) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          item_code: itemCode,
          limit: String(PAGE_SIZE),
          offset: "0",
        });
        if (scope === "rack") {
          if (warehouse) params.set("warehouse", warehouse);
          if (location) params.set("location", location);
        } else if (scope === "warehouse") {
          if (warehouse) params.set("warehouse", warehouse);
        }
        const res = await fetch(`/api/movements/item-history?${params}`);
        const data = (await res.json()) as {
          movements?: MovementRow[];
          total?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Load failed");
        setMovements(data.movements ?? []);
        setTotal(data.total ?? 0);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, itemCode, warehouse, location, scope]);

  async function loadMore() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        item_code: itemCode,
        limit: String(PAGE_SIZE),
        offset: String(movements.length),
      });
      if (scope === "rack") {
        if (warehouse) params.set("warehouse", warehouse);
        if (location) params.set("location", location);
      } else if (scope === "warehouse") {
        if (warehouse) params.set("warehouse", warehouse);
      }
      const res = await fetch(`/api/movements/item-history?${params}`);
      const data = (await res.json()) as {
        movements?: MovementRow[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Load failed");
      setMovements((prev) => [...prev, ...(data.movements ?? [])]);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {itemCode}
            </div>
            <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {itemName ?? "—"}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              ປະຫວັດການເຄື່ອນໄຫວ ({total.toLocaleString("en-US")} ລາຍການ)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
            <ScopeButton
              active={scope === "rack"}
              onClick={() => setScope("rack")}
              disabled={!location}
            >
              ສະເພາະ rack/location
            </ScopeButton>
            <ScopeButton
              active={scope === "warehouse"}
              onClick={() => setScope("warehouse")}
              disabled={!warehouse}
            >
              ທັງສາງ
            </ScopeButton>
            <ScopeButton
              active={scope === "all"}
              onClick={() => setScope("all")}
            >
              ທຸກສາງທີ່ມີສິດ
            </ScopeButton>
          </div>
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {scope === "rack" && location && (
              <span>
                ກອງ: ສາງ <span className="font-mono">{warehouse}</span> ·
                location <span className="font-mono">{location}</span>
              </span>
            )}
            {scope === "warehouse" && warehouse && (
              <span>
                ກອງ: ສາງ <span className="font-mono">{warehouse}</span>
              </span>
            )}
            {scope === "all" && <span>ບໍ່ກອງສາງ</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {!error && movements.length === 0 && !loading && (
            <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              ບໍ່ມີລາຍການເຄື່ອນໄຫວ
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">ວັນທີ</th>
                <th className="px-4 py-2 font-medium">ເລກທີ</th>
                <th className="px-4 py-2 font-medium">Loc</th>
                <th className="px-4 py-2 text-right font-medium">ຈຳນວນ</th>
                <th className="px-4 py-2 font-medium">ໂດຍ</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const qtyNum = Number.parseFloat(m.qty);
                const sign = m.calc_flag ?? 0;
                const signed = qtyNum * sign;
                return (
                  <tr
                    key={m.roworder}
                    className="border-t border-zinc-100 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                  >
                    <td className="px-4 py-2 align-top">
                      <div className="text-xs">{formatDate(m.doc_date)}</div>
                      {m.doc_time && (
                        <div className="text-[10px] text-zinc-500">
                          {m.doc_time}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="font-mono text-xs">{m.doc_no ?? "—"}</div>
                      {m.doc_ref && (
                        <div className="text-[10px] text-zinc-500">
                          ref: {m.doc_ref}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] text-zinc-500">
                        flag {m.trans_flag ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="font-mono text-xs">
                        {m.wh_code ?? "—"}
                      </div>
                      {m.shelf_code1 && (
                        <div className="text-[10px] text-zinc-500">
                          {m.shelf_code1}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 text-right align-top font-mono text-xs tabular-nums ${
                        signed > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : signed < 0
                            ? "text-red-700 dark:text-red-400"
                            : "text-zinc-500"
                      }`}
                    >
                      {signed > 0 ? "+" : ""}
                      {formatQty(signed)}
                      <div className="text-[10px] font-normal text-zinc-500">
                        {m.unit_code ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-zinc-600 dark:text-zinc-400">
                      {m.user_created ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 text-xs dark:border-zinc-800">
          <div className="text-zinc-500 dark:text-zinc-400">
            ສະແດງ {movements.length.toLocaleString("en-US")} /{" "}
            {total.toLocaleString("en-US")}
          </div>
          {movements.length < total && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="rounded-lg border border-zinc-300 px-3 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {loading ? "ກຳລັງໂຫຼດ..." : "ໂຫຼດເພີ່ມ"}
            </button>
          )}
          {movements.length >= total && loading && (
            <span className="text-zinc-500">ກຳລັງໂຫຼດ...</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
