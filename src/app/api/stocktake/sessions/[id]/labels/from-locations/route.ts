import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSessionAccess } from "@/lib/stocktake";

type LocationRow = {
  rack_code: string;
  location_code: string;
  location_name: string | null;
  rack_name: string | null;
};

type InsertedLabel = {
  label_id: number;
  label_code: string;
};

/**
 * Generate one stocktake label per (rack, location) in the session's
 * warehouse, using the location master (`odg_wms_location1`).
 *
 * label_code format: `${rack_code}-${location_code}`. Existing labels with
 * the same code are skipped (ON CONFLICT DO NOTHING) — safe to re-run.
 *
 * rack_code + location_code are stored on the label so the counter UI can
 * pre-fill them automatically when adding lines under this label.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const guard = await requireSessionAccess(sessionId, { mustBeOpen: true });
  if (!guard.ok) return guard.response;

  // Pull location master for the warehouse. Join rack master for nicer notes.
  const locations = await query<LocationRow>(
    `SELECT
       l.location_id AS rack_code,
       l.code        AS location_code,
       l.name_1      AS location_name,
       r.name_1      AS rack_name
     FROM public.odg_wms_location1 l
     LEFT JOIN public.odg_wms_location r
            ON r.code = l.location_id AND r.wh_code = l.wh_code
     WHERE l.wh_code = $1
       AND l.code IS NOT NULL
       AND l.code <> ''
     ORDER BY l.location_id, l.code`,
    [guard.row.wh_code],
  );

  if (locations.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ສາງນີ້ຍັງບໍ່ມີ location ໃນ master — ກະລຸນາສ້າງ location ກ່ອນ",
      },
      { status: 400 },
    );
  }

  let inserted = 0;
  const out: InsertedLabel[] = [];
  for (const l of locations) {
    const labelCode = `${l.rack_code}-${l.location_code}`;
    const noteParts: string[] = [];
    if (l.rack_name) noteParts.push(`rack: ${l.rack_name}`);
    if (l.location_name) noteParts.push(l.location_name);
    const note = noteParts.length ? noteParts.join(" / ") : null;

    const rows = await query<InsertedLabel>(
      `INSERT INTO public.wms_stocktake_label
         (session_id, label_code, note, rack_code, location_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, label_code) DO NOTHING
       RETURNING label_id, label_code`,
      [
        sessionId,
        labelCode,
        note,
        l.rack_code,
        l.location_code,
        guard.session.employee_id,
      ],
    );
    if (rows[0]) {
      inserted++;
      out.push(rows[0]);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: locations.length,
    inserted,
    skipped: locations.length - inserted,
    labels: out,
  });
}
