import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { ChevronRightIcon } from "@/components/ui/Icons";
import StocktakeLayout from "../../_components/StocktakeLayout";
import {
  stEyebrow,
  stMuted,
  stNavLink,
  stPanel,
  stPanelPad,
  stTitleLg,
} from "../../_components/stocktake-theme";
import UnitMismatchTable, { type MismatchGroup } from "./UnitMismatchTable";
import BulkFixButton from "./BulkFixButton";

type SessionInfo = {
  session_id: number;
  session_code: string;
  wh_code: string;
  status: "open" | "pending_approval" | "closed";
  name: string | null;
};

type LineRow = {
  line_id: number;
  item_code: string;
  item_name: string | null;
  label_code: string;
  qty: string;
  counted_unit: string | null;
  sml_unit: string | null;
  counted_at: string;
};

type HistoryRow = {
  log_id: number;
  line_id: number;
  item_code: string;
  old_unit_code: string | null;
  new_unit_code: string | null;
  changed_at: string;
  changed_by_name: string | null;
  note: string | null;
};

export default async function UnitMismatchPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return (
      <StocktakeLayout>
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            ບໍ່ມີສິດເຂົ້າເຖິງ WMS
          </p>
        </div>
      </StocktakeLayout>
    );
  }
  const { sessionId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(sid)) notFound();

  const info = (
    await query<SessionInfo>(
      `SELECT session_id, session_code, wh_code, status, name
       FROM public.wms_stocktake_session
       WHERE session_id = $1`,
      [sid],
    )
  )[0];
  if (!info) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(info.wh_code)) {
    return (
      <StocktakeLayout>
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm font-medium text-red-900 dark:text-red-200">
            ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້
          </p>
        </div>
      </StocktakeLayout>
    );
  }

  const [lines, history] = await Promise.all([
    query<LineRow>(
      `SELECT
         ln.line_id,
         ln.item_code,
         ln.item_name,
         lb.label_code,
         ln.qty::text          AS qty,
         ln.unit_code          AS counted_unit,
         ss.unit_code          AS sml_unit,
         ln.counted_at::text   AS counted_at
       FROM public.wms_stocktake_line ln
       JOIN public.wms_stocktake_label lb
         ON lb.label_id = ln.label_id
       LEFT JOIN public.wms_stocktake_snapshot ss
         ON ss.session_id = ln.session_id AND ss.item_code = ln.item_code
       WHERE ln.session_id = $1
         AND ss.unit_code IS NOT NULL
         AND ln.unit_code IS NOT NULL
         AND UPPER(TRIM(ln.unit_code)) <> UPPER(TRIM(ss.unit_code))
       ORDER BY ln.item_code, lb.label_code, ln.line_id`,
      [sid],
    ),
    query<HistoryRow>(
      `SELECT
         l.log_id, l.line_id, l.item_code,
         l.old_unit_code, l.new_unit_code,
         l.changed_at::text  AS changed_at,
         e.fullname_lo       AS changed_by_name,
         l.note
       FROM public.wms_stocktake_unit_log l
       LEFT JOIN public.odg_employee e ON e.employee_id = l.changed_by
       WHERE l.session_id = $1
       ORDER BY l.changed_at DESC, l.log_id DESC
       LIMIT 200`,
      [sid],
    ),
  ]);

  // Group by item_code so each item shows once with all its mismatched lines.
  const grouped = new Map<string, MismatchGroup>();
  for (const ln of lines) {
    let g = grouped.get(ln.item_code);
    if (!g) {
      g = {
        item_code: ln.item_code,
        item_name: ln.item_name,
        sml_unit: ln.sml_unit,
        lines: [],
      };
      grouped.set(ln.item_code, g);
    }
    g.lines.push({
      line_id: ln.line_id,
      label_code: ln.label_code,
      qty: ln.qty,
      counted_unit: ln.counted_unit,
      counted_at: ln.counted_at,
    });
  }
  const groups = Array.from(grouped.values());

  const historyByLine = new Map<number, HistoryRow[]>();
  for (const h of history) {
    const arr = historyByLine.get(h.line_id) ?? [];
    arr.push(h);
    historyByLine.set(h.line_id, arr);
  }
  const historyByItem = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const arr = historyByItem.get(h.item_code) ?? [];
    arr.push(h);
    historyByItem.set(h.item_code, arr);
  }

  const isOpen = info.status === "open";
  const totalMismatchLines = lines.length;

  return (
    <StocktakeLayout>
      <nav className={`mb-3 flex flex-wrap items-center gap-2 ${stMuted}`}>
        <Link href="/stocktake" className={stNavLink}>
          ກວດນັບສິນຄ້າ
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <Link href={`/stocktake/${sid}`} className={stNavLink}>
          <span className="font-mono">{info.session_code}</span>
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          ກວດສອບຫົວໜ່ວຍ
        </span>
      </nav>

      <section className={`${stPanel} ${stPanelPad} mb-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={stEyebrow}>ກວດສອບຫົວໜ່ວຍສິນຄ້າ</p>
            <h1 className={`mt-1 ${stTitleLg}`}>ຫົວໜ່ວຍບໍ່ກົງກັບ SML</h1>
            <p className={`mt-1 ${stMuted}`}>
              ສະແດງສະເພາະລາຍການນັບທີ່ <b>counted_unit ≠ sml_unit</b>.
              ກົດແກ້ໄຂເພື່ອປັບໃບກວດນັບໃຫ້ກົງ.
            </p>
            {history.length > 0 && (
              <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                ✓ ມີການແກ້ໄຂແລ້ວ {history.length.toLocaleString("en-US")} ລາຍການ
                — ໃບກວດນັບໄດ້ update ແລ້ວ
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div>
              <div className="font-mono text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                {totalMismatchLines}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                ລາຍການບໍ່ກົງ ({groups.length} ສິນຄ້າ)
              </div>
            </div>
            <Link
              href={`/stocktake/${sid}/report?scope=counted&filter=variance`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition hover:bg-brand-700"
            >
              ສົມທຽບໃໝ່
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={`/stocktake/${sid}/summary`}
              className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ສະຫຼຸບເຕັມ →
            </Link>
          </div>
        </div>

        {!isOpen && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-800/60">
            ຮອບກວດນັບ{info.status === "pending_approval" ? "ກຳລັງລໍຖ້າອະນຸມັດ" : "ປິດແລ້ວ"} —
            ບໍ່ສາມາດແກ້ໄຂຫົວໜ່ວຍໄດ້.
          </div>
        )}
      </section>

      {isOpen && groups.length > 0 && (
        <BulkFixButton
          sessionId={sid}
          groups={groups.map((g) => ({
            item_code: g.item_code,
            sml_unit: g.sml_unit,
            line_ids: g.lines.map((l) => l.line_id),
          }))}
        />
      )}

      <UnitMismatchTable
        sessionId={sid}
        canEdit={isOpen}
        groups={groups}
        historyByLine={Object.fromEntries(historyByLine.entries())}
        historyByItem={Object.fromEntries(historyByItem.entries())}
      />
    </StocktakeLayout>
  );
}
