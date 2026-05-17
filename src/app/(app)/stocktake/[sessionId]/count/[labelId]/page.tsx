import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
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
  );
}
