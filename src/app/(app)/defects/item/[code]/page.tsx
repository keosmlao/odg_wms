import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { loadDefectEntries } from "@/lib/defects";
import { DEFECT_STATUS } from "@/lib/defects-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
import BackButton from "@/components/BackButton";
import PrintButton from "@/components/ui/PrintButton";
import DefectItemClient from "./DefectItemClient";
import { loadDefectOptions } from "../../_components/options";

/**
 * Detail page for one defective item: every entry behind a row of the balance
 * report, as a compact one-line-per-entry table.
 *
 * This replaces the side drawer the report used to open. A full page gives room
 * for a real table, a shareable URL, and printing — the drawer gave a tall card
 * per entry, which meant ~10 screens of scrolling for a 41-unit item.
 *
 * /defects/item/<ic_code>?wh=<warehouse>&status=0|1
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `ເຄື່ອງມີຕຳນິ · ${decodeURIComponent(code)}` };
}

type ItemHeader = {
  ic_name: string | null;
  item_brand: string | null;
  unit_code: string | null;
};

export default async function DefectItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ wh?: string; status?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }

  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const sp = await searchParams;
  const wh = sp.wh?.trim() ?? "";
  const status = sp.status === "1" ? DEFECT_STATUS.dispatched : DEFECT_STATUS.pending;

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
      />
    );
  }
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return (
      <Notice
        tone="red"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
        description={`ສາງ ${wh} ບໍ່ໄດ້ມອບໝາຍໃຫ້ບັນຊີຂອງທ່ານ`}
      />
    );
  }

  const [rows, { warehouses }, header] = await Promise.all([
    loadDefectEntries({ code, wh, status, scope: accessible }),
    loadDefectOptions(session),
    query<ItemHeader>(
      `SELECT name_1 AS ic_name, item_brand,
              COALESCE(NULLIF(unit_standard, ''), unit_cost) AS unit_code
       FROM public.ic_inventory WHERE code = $1`,
      [code],
    ),
  ]);

  // No entries and no such item at all → a bad URL, not an empty state.
  if (rows.length === 0 && header.length === 0) notFound();

  const item = header[0] ?? {
    ic_name: rows[0]?.ic_name ?? null,
    item_brand: rows[0]?.item_brand ?? null,
    unit_code: rows[0]?.unit_code ?? null,
  };
  const totalQty = rows.reduce((sum, r) => sum + (Number.parseFloat(r.qty) || 0), 0);
  const gradeCount = (g: string) => rows.filter((r) => r.grade === g).length;
  const whName = wh ? (warehouses.find((w) => w.code === wh)?.name ?? "") : "";
  const statusLabel = status === DEFECT_STATUS.dispatched ? "ເບີກຈ່າຍແລ້ວ" : "ຍັງບໍ່ເບີກຈ່າຍ";

  const backHref = status === DEFECT_STATUS.dispatched ? "/defects/dispatched" : "/defects";
  const exportParams = new URLSearchParams({ status: String(status), code });
  if (wh) exportParams.set("wh", wh);

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <BackButton href={backHref} label="ກັບໄປລາຍງານ" />
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/defects/export?${exportParams}`}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800"
          >
            Excel
          </a>
          <PrintButton />
        </div>
      </div>

      {/* .print-sheet — globals.css hides all other chrome when printing. */}
      <div className="print-sheet space-y-4">
        <header className="shadow-card relative overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-rose-500/10 via-orange-500/5 to-transparent blur-3xl dark:from-rose-500/15" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-xs font-bold text-rose-700 dark:text-rose-400">{code}</div>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {item.ic_name ?? "—"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                {item.item_brand && <span>{item.item_brand}</span>}
                <span>
                  ສາງ{" "}
                  {wh ? (
                    <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{wh}</span>
                  ) : (
                    "ທຸກສາງ"
                  )}{" "}
                  {whName}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    status === DEFECT_STATUS.dispatched
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}
                >
                  {statusLabel}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 gap-6 text-right">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">ລາຍການ</div>
                <div className="font-mono text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {rows.length}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">ຈຳນວນລວມ</div>
                <div className="font-mono text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {totalQty.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  <span className="ml-1 text-[11px] font-normal text-zinc-400">{item.unit_code}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">ເກຣດ</div>
                <div className="mt-1.5 flex gap-1">
                  {(["A", "B", "C"] as const).map((g) =>
                    gradeCount(g) > 0 ? (
                      <span
                        key={g}
                        className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        {g}·{gradeCount(g)}
                      </span>
                    ) : null,
                  )}
                  {rows.every((r) => !r.grade) && <span className="text-xs text-zinc-400">—</span>}
                </div>
              </div>
            </div>
          </div>
        </header>

        {rows.length === 0 ? (
          <Notice
            tone="navy"
            icon={<AlertIcon className="h-5 w-5" />}
            title={`ບໍ່ມີລາຍການ "${statusLabel}" ຂອງສິນຄ້ານີ້`}
            description={wh ? `ໃນສາງ ${wh}` : undefined}
            action={
              <Link
                href={backHref}
                className="text-xs font-semibold text-blue-700 underline dark:text-blue-300"
              >
                ກັບໄປລາຍງານ
              </Link>
            }
          />
        ) : (
          <DefectItemClient
            code={code}
            wh={wh}
            status={status}
            initialRows={rows}
            warehouses={warehouses}
          />
        )}
      </div>
    </div>
  );
}
