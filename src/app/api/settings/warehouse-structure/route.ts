import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireManager } from "@/lib/session";

/**
 * Lazy structure loader for the warehouse settings page: the racks and
 * locations of ONE warehouse, fetched only when that warehouse is expanded.
 * Keeps the initial page render light (no eager load of all ~3.5k locations).
 *
 * GET ?wh=<code>  → { racks: [...], locations: [...], canvas: {...} | null }
 * PUT             → ບັນທຶກຂະໜາດ: 1 ລາຍການ (ສາງ / rack / location) ຫຼື
 *                   ທຸກ location ໃນ rack ດຽວ (level=rack-locations) — ເບິ່ງ migration 037
 */
export type RackRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  is_active: number | null;
};

export type LocationRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  location_id: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  floor: number | null;
  is_active: number | null;
};

/** ຂະໜາດຂັ້ນສາງ — ພື້ນມາຈາກ 036, ຄວາມສູງມາຈາກ 037. */
export type CanvasRow = {
  width_cm: string | null;
  depth_cm: string | null;
  height_cm: string | null;
};

async function resolveLocationTable() {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'odg_location1'
     ) AS exists`,
  );
  return rows[0]?.exists ? "odg_location1" : "odg_wms_location1";
}

/** ຕາຕະລາງ/ຖັນ ຍັງບໍ່ຖືກສ້າງ (migration ຄ້າງ) — ບໍ່ແມ່ນ error ຂອງ query. */
function isMissingSchema(err: unknown): boolean {
  const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : "";
  return code === "42P01" || code === "42703";
}

export async function GET(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const wh = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາລະບຸສາງ" }, { status: 400 });

  const locationTable = await resolveLocationTable();

  // ຖັນຂະໜາດຂອງ rack ມາຈາກ 037 — ຍັງບໍ່ໄດ້ run ກໍ່ຍັງໃຫ້ໜ້າຈໍໃຊ້ໄດ້ (ບໍ່ມີຂະໜາດ).
  const rackQuery = async (): Promise<RackRow[]> => {
    try {
      return await query<RackRow>(
        `SELECT roworder, code, name_1,
                width::text, length::text, height::text, is_active
         FROM public.odg_wms_location
         WHERE wh_code = $1
         ORDER BY code, roworder`,
        [wh],
      );
    } catch (err) {
      if (!isMissingSchema(err)) throw err;
      const rows = await query<Omit<RackRow, "width" | "length" | "height">>(
        `SELECT roworder, code, name_1, is_active
         FROM public.odg_wms_location
         WHERE wh_code = $1
         ORDER BY code, roworder`,
        [wh],
      );
      return rows.map((r) => ({ ...r, width: null, length: null, height: null }));
    }
  };

  const [racks, locations] = await Promise.all([
    rackQuery(),
    query<LocationRow>(
      `SELECT roworder, code, name_1, location_id,
              width::text, length::text, height::text, floor, is_active
       FROM public.${locationTable}
       WHERE wh_code = $1
       ORDER BY location_id, code, roworder`,
      [wh],
    ),
  ]);

  // ຂະໜາດສາງເປັນຂໍ້ມູນເສີມ — ຍັງບໍ່ໄດ້ run 036/037 ກໍ່ໃຫ້ໜ້າຈໍໃຊ້ໄດ້ຢູ່.
  let canvas: CanvasRow | null = null;
  try {
    const rows = await query<CanvasRow>(
      `SELECT width_cm::text, depth_cm::text, height_cm::text
       FROM public.odg_wms_layout_canvas WHERE wh_code = $1`,
      [wh],
    );
    canvas = rows[0] ?? null;
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
  }

  return NextResponse.json({ racks, locations, canvas });
}

/** ຮັບໄດ້ທັງເລກ, ສະຕຣິງ, ວ່າງ (= ລຶບຄ່າ). ຄ່າຕິດລົບ/ບໍ່ແມ່ນເລກ = ບໍ່ຜ່ານ. */
function parseDim(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  if (n > 1_000_000) return { ok: false }; // 10 ກມ. — ພິມຜິດແນ່ນອນ
  return { ok: true, value: n === 0 ? null : Math.round(n * 100) / 100 };
}

type PutBody = {
  level?: unknown;
  wh?: unknown;
  roworder?: unknown;
  width?: unknown;
  length?: unknown;
  height?: unknown;
  /** ສະເພາະ level=rack-locations: empty = ສະເພາະທີ່ຂະໜາດຍັງບໍ່ຄົບ, all = ທັບທັງໝົດ */
  mode?: unknown;
};

const LEVELS = ["warehouse", "rack", "location", "rack-locations"] as const;
type Level = (typeof LEVELS)[number];

export async function PUT(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const level = body.level as Level;
  if (!LEVELS.includes(level)) {
    return NextResponse.json({ error: "ລະດັບບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = typeof body.wh === "string" ? body.wh.trim() : "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາລະບຸສາງ" }, { status: 400 });

  const dims = { width: parseDim(body.width), length: parseDim(body.length), height: parseDim(body.height) };
  if (!dims.width.ok || !dims.length.ok || !dims.height.ok) {
    return NextResponse.json({ error: "ຂະໜາດຕ້ອງເປັນເລກບວກ (ຊມ.)" }, { status: 400 });
  }
  const [w, l, h] = [dims.width.value, dims.length.value, dims.height.value];

  try {
    if (level === "warehouse") {
      // ພື້ນສາງເປັນ NOT NULL > 0 (036) ຈຶ່ງຕ້ອງມີທັງກ້ວງ ແລະ ເລິກ ຈຶ່ງບັນທຶກໄດ້.
      if (!(w && w > 0) || !(l && l > 0)) {
        return NextResponse.json(
          { error: "ຂະໜາດສາງຕ້ອງມີທັງຄວາມກ້ວງ ແລະ ຄວາມເລິກ" },
          { status: 400 },
        );
      }
      await query(
        `INSERT INTO public.odg_wms_layout_canvas (wh_code, width_cm, depth_cm, height_cm, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, now(), $5)
         ON CONFLICT (wh_code) DO UPDATE
           SET width_cm = EXCLUDED.width_cm,
               depth_cm = EXCLUDED.depth_cm,
               height_cm = EXCLUDED.height_cm,
               updated_at = now(),
               updated_by = EXCLUDED.updated_by`,
        [wh, w, l, h, guard.session.employee_code ?? null],
      );
      return NextResponse.json({ ok: true, canvas: { width_cm: String(w), depth_cm: String(l), height_cm: h == null ? null : String(h) } });
    }

    const roworder = Number(body.roworder);
    if (!Number.isInteger(roworder)) {
      return NextResponse.json({ error: "ບໍ່ພົບແຖວທີ່ຈະແກ້" }, { status: 400 });
    }

    // ໃສ່ຂະໜາດດຽວກັນໃຫ້ທຸກ location ໃນ rack — ບ່ອນເກັບໃນ rack ດຽວກັນມັກເທົ່າກັນ
    // ຈຶ່ງບໍ່ຄວນໃຫ້ພິມເທື່ອລະຊ່ອງ (3,502 location).
    if (level === "rack-locations") {
      if (!(w && w > 0) || !(l && l > 0)) {
        return NextResponse.json(
          { error: "ຕ້ອງມີທັງຄວາມກ້ວງ ແລະ ຄວາມເລິກ ຈຶ່ງໃສ່ເປັນຊຸດໄດ້" },
          { status: 400 },
        );
      }
      const onlyIncomplete = body.mode !== "all";
      const rack = await query<{ code: string | null }>(
        `SELECT code FROM public.odg_wms_location WHERE roworder = $1 AND wh_code = $2`,
        [roworder, wh],
      );
      const rackCode = rack[0]?.code?.trim();
      if (!rackCode) return NextResponse.json({ error: "ບໍ່ພົບ rack" }, { status: 404 });

      const res = await pool.query(
        `UPDATE public.${await resolveLocationTable()}
            SET width = $3, length = $4, height = $5
          WHERE wh_code = $1 AND location_id = $2` +
          (onlyIncomplete ? ` AND (width IS NULL OR length IS NULL OR height IS NULL)` : ""),
        [wh, rackCode, w, l, h],
      );
      return NextResponse.json({ ok: true, updated: res.rowCount ?? 0, rackCode });
    }

    const table = level === "rack" ? "odg_wms_location" : await resolveLocationTable();
    // wh_code ຢູ່ໃນ WHERE ນຳ — ກັນການແກ້ຂ້າມສາງຖ້າ roworder ຖືກສົ່ງມາຜິດ.
    const res = await pool.query(
      `UPDATE public.${table} SET width = $3, length = $4, height = $5
       WHERE roworder = $1 AND wh_code = $2`,
      [roworder, wh, w, l, h],
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: "ບໍ່ພົບແຖວທີ່ຈະແກ້" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingSchema(err)) {
      return NextResponse.json(
        { error: "ຍັງບໍ່ໄດ້ run migration 037_wms_dimension_levels.sql" },
        { status: 503 },
      );
    }
    throw err;
  }
}
