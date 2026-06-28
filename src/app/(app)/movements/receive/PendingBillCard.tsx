import Link from "next/link";
import { ArrowLeftRightIcon, BuildingIcon, CalendarIcon, PackageIcon, UserIcon, UsersIcon } from "@/components/ui/Icons";
import Countdown from "./Countdown";

export type BillLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  remaining: number;
  pallets: number;
  unitsPerPallet: number;
  stack: number;
};
export type Bill = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  send_date: string | null;
  creator_name: string | null;
  transport_name: string | null;
  lines: BillLine[];
  totalRemaining: number;
  pallets: number;
  phMissing: number;
};

function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

export default function PendingBillCard({ b, days, defaultOpen, countSheetNo = null }: { b: Bill; days: number | null; defaultOpen: boolean; countSheetNo?: string | null }) {
  const within7 = days !== null && days >= 0 && days <= 7;
  const overdue = days !== null && days < 0;
  const palletsCeil = Math.ceil(b.pallets);

  return (
    <details open={defaultOpen} className="group shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
        <span className="shrink-0 text-zinc-400 transition-transform group-open:rotate-90">›</span>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 font-mono text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {(b.wh_code ?? "?").slice(-2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{b.po_no}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ຄ້າງຮັບ</span>
            {within7 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">ມາໃນ {days} ມື້</span>}
            {overdue && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">ກາຍກຳນົດ {Math.abs(days!)} ມື້</span>}
            {countSheetNo && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">ກວດນັບແລ້ວ · {countSheetNo}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {b.doc_date && <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />ອອກເອກະສານ {b.doc_date}</span>}
            {b.send_date && (
              <span className="inline-flex items-center gap-1 font-bold text-red-600 dark:text-red-400">
                <CalendarIcon className="h-3 w-3" />ເຄື່ອງຈະເຂົ້າ {b.send_date} · <Countdown target={b.send_date} />
              </span>
            )}
            <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{b.cust_name ?? b.cust_code ?? "—"}</span>
            {b.wh_code && <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{b.wh_code}{b.wh_name ? ` · ${b.wh_name}` : ""}</span>}
            {b.creator_name && <span className="inline-flex items-center gap-1"><UsersIcon className="h-3 w-3" />ຜູ້ສ້າງ: {b.creator_name}</span>}
            {b.transport_name && <span className="inline-flex items-center gap-1"><ArrowLeftRightIcon className="h-3 w-3" />{b.transport_name}</span>}
            {palletsCeil > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400" title={b.phMissing > 0 ? `${b.phMissing} ລາຍການຈັບຄູ່ PH ບໍ່ໄດ້` : undefined}>
                <PackageIcon className="h-3 w-3" />ຕ້ອງໃຊ້ ~{palletsCeil} ພາເລດ{b.phMissing > 0 ? " *" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase text-zinc-400">ຄ້າງຮັບ</div>
            <div className="font-mono text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(b.totalRemaining)}</div>
            <div className="text-[10px] text-zinc-400">{b.lines.length} ລາຍການ</div>
          </div>
          {countSheetNo ? (
            <Link href={`/movements/receive/count/${encodeURIComponent(countSheetNo)}`} className="rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm">ເປີດໃບກວດນັບ</Link>
          ) : (
            <Link href={`/movements/receive/count/new?po=${encodeURIComponent(b.po_no)}&wh=${encodeURIComponent(b.wh_code)}`} className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm">ສ້າງໃບກວດນັບ</Link>
          )}
        </div>
      </summary>
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
              <th className="px-4 py-2">ສິນຄ້າ</th>
              <th className="px-4 py-2 text-right">ຄ້າງຮັບ</th>
              <th className="px-4 py-2 text-right">ພາເລດ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {b.lines.map((l, idx) => (
              <tr key={`${b.po_no}-${l.item_code}-${idx}`}>
                <td className="px-4 py-2">
                  <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}</div>
                  <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {fmt(l.remaining)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                  {l.pallets > 0 ? `~${l.pallets}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
