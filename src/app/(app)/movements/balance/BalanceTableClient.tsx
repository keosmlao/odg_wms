"use client";

import { useState } from "react";
import ItemMovementsDrawer from "./ItemMovementsDrawer";
import SerialDrawer from "./SerialDrawer";

export type TableStockRow = {
  wh_code: string;
  rack_code: string;
  location_code: string;
  pallet_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: number;
};

export default function BalanceTableClient({
  rows,
}: {
  rows: TableStockRow[];
}) {
  const [selected, setSelected] = useState<{
    item_code: string;
    item_name: string | null;
    wh_code: string;
    location: string;
  } | null>(null);
  const [snItem, setSnItem] = useState<{ item_code: string; item_name: string | null; wh_code: string; rack_code: string; location_code: string; pallet_code: string } | null>(null);

  function formatQty(value: number) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse min-w-[1000px]">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/70 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
              <th className="p-4 font-semibold">ສາງ (WH)</th>
              <th className="p-4 font-semibold">Rack</th>
              <th className="p-4 font-semibold">Location</th>
              <th className="p-4 font-semibold">Pallet</th>
              <th className="p-4 font-semibold">ລະຫັດສິນຄ້າ (Code)</th>
              <th className="p-4 font-semibold">ຊື່ສິນຄ້າ (Product Name)</th>
              <th className="p-4 text-right font-semibold">ຄົງເຫຼືອ (Qty)</th>
              <th className="p-4 font-semibold">ຫົວໜ່ວຍ (Unit)</th>
              <th className="p-4 text-center font-semibold">Serial</th>
              <th className="p-4 text-center font-semibold">ປະຫວັດ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((row, idx) => (
              <tr
                key={`${row.wh_code}-${row.rack_code}-${row.location_code}-${row.pallet_code}-${row.item_code}-${idx}`}
                className="group transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20"
              >
                <td className="p-4 font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                  {row.wh_code}
                </td>
                <td className="p-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {row.rack_code || <span className="text-zinc-400">—</span>}
                </td>
                <td className="p-4 font-mono text-xs font-semibold text-zinc-950 dark:text-zinc-50">
                  {row.location_code || <span className="text-zinc-400">—</span>}
                </td>
                <td className="p-4">
                  {row.pallet_code ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      {row.pallet_code}
                    </span>
                  ) : (
                    <span className="text-zinc-400 text-xs">—</span>
                  )}
                </td>
                <td className="p-4 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {row.item_code}
                </td>
                <td className="p-4 max-w-sm truncate text-xs text-zinc-700 dark:text-zinc-300" title={row.item_name ?? ""}>
                  {row.item_name ?? "—"}
                </td>
                <td className={`p-4 text-right font-mono font-bold tabular-nums ${
                  row.qty < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"
                }`}>
                  {formatQty(row.qty)}
                </td>
                <td className="p-4 text-xs text-zinc-500 dark:text-zinc-400">
                  {row.unit_code || "—"}
                </td>
                <td className="p-4 text-center">
                  <button
                    type="button"
                    onClick={() => setSnItem({ item_code: row.item_code, item_name: row.item_name, wh_code: row.wh_code, rack_code: row.rack_code, location_code: row.location_code, pallet_code: row.pallet_code })}
                    title="ເບິ່ງ serial number ຂອງສິນຄ້ານີ້"
                    className="inline-flex items-center rounded-md bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 transition hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300"
                  >
                    SN
                  </button>
                </td>
                <td className="p-4 text-center">
                  <button
                    type="button"
                    title="ເບິ່ງປະຫວັດການເຄື່ອນໄຫວ"
                    onClick={() =>
                      setSelected({
                        item_code: row.item_code,
                        item_name: row.item_name,
                        wh_code: row.wh_code,
                        location: row.location_code || row.rack_code || "",
                      })
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4.5 w-4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ItemMovementsDrawer
        open={selected !== null}
        itemCode={selected?.item_code ?? ""}
        itemName={selected?.item_name ?? null}
        warehouse={selected?.wh_code ?? ""}
        location={selected?.location ?? ""}
        onClose={() => setSelected(null)}
      />

      <SerialDrawer
        open={snItem !== null}
        itemCode={snItem?.item_code ?? ""}
        itemName={snItem?.item_name ?? null}
        warehouse={snItem?.wh_code ?? ""}
        scope={snItem ? { rack: snItem.rack_code, location: snItem.location_code, pallet: snItem.pallet_code } : null}
        onClose={() => setSnItem(null)}
      />
    </>
  );
}
