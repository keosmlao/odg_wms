import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
import StocktakeLayout from "../../../_components/StocktakeLayout";
import {
  stMuted,
  stPanel,
  stTitleMd,
} from "../../../_components/stocktake-theme";
import Counter from "./Counter";

type SessionRow = {
  session_id: number;
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  session_name: string | null;
  status: "open" | "pending_approval" | "closed";
  blind: boolean;
};

type LabelRow = {
  label_id: number;
  label_code: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
};

export type CountedLine = {
  line_id: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
  counted_at: string;
};

export type RackOption = { code: string; name: string | null };
export type LocationOption = {
  code: string;
  name: string | null;
  rack_code: string;
};

export default async function CountPage({
  params,
}: {
  params: Promise<{ sessionId: string; labelId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }
  const { sessionId, labelId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  const lid = Number.parseInt(labelId, 10);
  if (!Number.isFinite(sid) || !Number.isFinite(lid)) notFound();

  const sessionRow = (
    await query<SessionRow>(
      `SELECT s.session_id, s.session_code, s.wh_code,
              w.name_1 AS wh_name,
              s.name AS session_name,
              s.status,
              s.blind
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
       WHERE s.session_id = $1`,
      [sid],
    )
  )[0];
  if (!sessionRow) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(sessionRow.wh_code)) {
    return (
      <Notice
        tone="red"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
      />
    );
  }

  const labelRow = (
    await query<LabelRow>(
      `SELECT label_id, label_code, note, rack_code, location_code
       FROM public.wms_stocktake_label
       WHERE label_id = $1 AND session_id = $2`,
      [lid, sid],
    )
  )[0];
  if (!labelRow) notFound();

  const [lines, racks, locations] = await Promise.all([
    query<CountedLine>(
      `SELECT
         line_id,
         item_code,
         item_name,
         unit_code,
         qty::text AS qty,
         note,
         rack_code,
         location_code,
         counted_at::text AS counted_at
       FROM public.wms_stocktake_line
       WHERE label_id = $1
       ORDER BY counted_at DESC, line_id DESC`,
      [lid],
    ),
    query<RackOption>(
      `SELECT code, name_1 AS name FROM public.odg_wms_location
       WHERE wh_code = $1 ORDER BY code`,
      [sessionRow.wh_code],
    ),
    query<LocationOption>(
      `SELECT code, name_1 AS name, location_id AS rack_code
       FROM public.odg_wms_location1
       WHERE wh_code = $1 ORDER BY code`,
      [sessionRow.wh_code],
    ),
  ]);

  const canRevealBalance =
    user.role === "supervisor" || user.role === "manager";

  return (
    <StocktakeLayout wide>
    <div className="space-y-4 lg:space-y-5">
      {/* ມືຖື: ຫົວຂໍ້ຢູ່ນີ້ — desktop ສະແດງໃນ Counter ເພື່ອບໍ່ຊ້ຳ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:hidden">
        <div>
          <h1 className={stTitleMd}>{labelRow.label_code}</h1>
          <p className={stMuted}>
            {sessionRow.session_name ?? sessionRow.session_code} · {sessionRow.wh_code}
            {sessionRow.wh_name && ` (${sessionRow.wh_name})`}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-xs font-medium ${
            sessionRow.status === "open"
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"
              : "bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"
          }`}
        >
          {sessionRow.status === "open" ? "● ເປີດ" : sessionRow.status === "pending_approval" ? "● ລໍຖ້າ" : "● ປິດ"}
          {sessionRow.blind && " · Blind"}
        </span>
      </div>

      {/* Additional label info (if note or default rack/location) */}
      {(labelRow.note || labelRow.rack_code || labelRow.location_code) && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-sm text-slate-600 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          {labelRow.note && <p className="mb-1">{labelRow.note}</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            {labelRow.rack_code && (
              <span>
                Rack: <strong>{labelRow.rack_code}</strong>
              </span>
            )}
            {labelRow.location_code && (
              <span>
                Location: <strong>{labelRow.location_code}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ມືຖື: ກ່ອງ — desktop: ເປີດເຕັມຄວາມກວ້າງ ແລະໜ້ອຍ ring ເພື່ອໃຫ້ເປັນພື້ນທີ່ກວດນັບ */}
      <div className={`${stPanel} overflow-hidden p-0 shadow-md lg:shadow-lg`}>
        <Counter
          sessionId={sid}
          labelId={lid}
          labelCode={labelRow.label_code}
          labelNote={labelRow.note}
          labelRackCode={labelRow.rack_code}
          labelLocationCode={labelRow.location_code}
          sessionCode={sessionRow.session_code}
          sessionName={sessionRow.session_name}
          whCode={sessionRow.wh_code}
          whName={sessionRow.wh_name}
          sessionOpen={sessionRow.status === "open"}
          sessionStatus={sessionRow.status}
          blind={sessionRow.blind}
          canRevealBalance={canRevealBalance}
          initialLines={lines}
          racks={racks}
          locations={locations}
        />
      </div>
    </div>
    </StocktakeLayout>
  );
}