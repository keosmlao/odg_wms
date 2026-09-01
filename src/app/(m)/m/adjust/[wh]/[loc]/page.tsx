import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import CountClient from "./CountClient";

/**
 * ໜ້ານັບຂອງ location ໜຶ່ງ — ຍິງສິນຄ້າເພີ່ມເຂົ້າ ແລ້ວກົດປັບປຸງ.
 */
export default async function LocationCountPage({
  params,
}: {
  params: Promise<{ wh: string; loc: string }>;
}) {
  const { wh: whRaw, loc: locRaw } = await params;
  const wh = decodeURIComponent(whRaw);
  const locCode = decodeURIComponent(locRaw);

  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <div className="p-5 text-center text-sm font-semibold text-amber-700">ບໍ່ມີສິດເຂົ້າເຖິງ WMS</div>;
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return <div className="p-5 text-center text-sm font-semibold text-amber-700">ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້</div>;
  }

  const rows = await query<{ code: string; name_1: string | null; location_id: string | null }>(
    `SELECT code, name_1, location_id FROM public.odg_wms_location1
     WHERE code = $1 AND wh_code = $2 AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    [locCode, wh],
  );
  const loc = rows[0];
  if (!loc) notFound();

  return (
    <CountClient
      wh={wh}
      locCode={loc.code}
      locName={loc.name_1}
      rack={loc.location_id ?? ""}
    />
  );
}
