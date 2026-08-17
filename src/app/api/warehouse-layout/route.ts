import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  autoLayout,
  type AutoLayoutRack,
  type LayoutShape,
  type WarehouseLayout,
} from "@/lib/warehouseLayout";

/**
 * ຜັງພື້ນທີ່ສາງ (migration 036).
 *   GET  ?wh=1404 → ຜັງທີ່ບັນທຶກໄວ້, ບໍ່ມີ = ສ້າງໃຫ້ອັດຕະໂນມັດຈາກລາຍການ location
 *   PUT           → ບັນທຶກຜັງທັບ (ສະເພາະຜູ້ຈັດການ)
 */

type CanvasRow = { width_cm: string; depth_cm: string };
type ShapeRow = {
  kind: string;
  code: string;
  label: string | null;
  x_cm: string;
  y_cm: string;
  w_cm: string;
  d_cm: string;
  h_cm: string | null;
  color: string | null;
  sort: number;
};

const num = (v: string | null): number => (v == null ? 0 : Number.parseFloat(v) || 0);

/** ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ (migration ຄ້າງ) — ບໍ່ແມ່ນ error ຂອງ query. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function buildAutoLayout(wh: string): Promise<WarehouseLayout> {
  const [racks, locations] = await Promise.all([
    query<{ code: string; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.odg_wms_location
       WHERE wh_code = $1 AND COALESCE(is_active, 1) = 1
       ORDER BY roworder, code`,
      [wh],
    ),
    query<{ code: string; name: string | null; rack: string | null; width: string | null; length: string | null; height: string | null }>(
      `SELECT code, name_1 AS name, location_id AS rack, width, length, height
       FROM public.odg_wms_location1
       WHERE wh_code = $1 AND COALESCE(is_active, 1) = 1
       ORDER BY code`,
      [wh],
    ),
  ]);

  const byRack = new Map<string, AutoLayoutRack>();
  for (const r of racks) byRack.set(r.code, { code: r.code, name: r.name, locations: [] });
  for (const l of locations) {
    const rackCode = (l.rack ?? "").trim();
    let rack = byRack.get(rackCode);
    if (!rack) {
      rack = { code: rackCode || "—", name: null, locations: [] };
      byRack.set(rackCode, rack);
    }
    rack.locations.push({
      code: l.code,
      name: l.name,
      widthCm: l.width == null ? null : Number.parseFloat(l.width),
      lengthCm: l.length == null ? null : Number.parseFloat(l.length),
      heightCm: l.height == null ? null : Number.parseFloat(l.height),
    });
  }
  return autoLayout(wh, [...byRack.values()]);
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const wh = params.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // auto=1 → ຈັດຜັງໃໝ່ຈາກສູນ (ບໍ່ແຕະຜັງທີ່ບັນທຶກໄວ້ຈົນກວ່າຜູ້ໃຊ້ຈະກົດບັນທຶກ).
  if (params.get("auto") === "1") {
    return NextResponse.json({ layout: await buildAutoLayout(wh) });
  }

  try {
    const [canvasRows, shapeRows] = await Promise.all([
      query<CanvasRow>(
        `SELECT width_cm, depth_cm FROM public.odg_wms_layout_canvas WHERE wh_code = $1`,
        [wh],
      ),
      query<ShapeRow>(
        `SELECT kind, code, label, x_cm, y_cm, w_cm, d_cm, h_cm, color, sort
         FROM public.odg_wms_layout_shape
         WHERE wh_code = $1
         ORDER BY sort, code`,
        [wh],
      ),
    ]);

    if (shapeRows.length > 0) {
      const shapes: LayoutShape[] = shapeRows.map((r) => ({
        kind: r.kind === "zone" ? "zone" : "location",
        code: r.code,
        label: r.label,
        x: num(r.x_cm),
        y: num(r.y_cm),
        w: num(r.w_cm),
        d: num(r.d_cm),
        h: r.h_cm == null ? null : num(r.h_cm),
        color: r.color,
        sort: r.sort,
      }));
      // ບໍ່ມີແຖວ canvas ກໍ່ຍັງແຕ້ມໄດ້ — ເອົາຂອບເຂດຈາກຮູບທີ່ໄກສຸດ.
      const fallbackW = Math.max(...shapes.map((s) => s.x + s.w), 1000);
      const fallbackD = Math.max(...shapes.map((s) => s.y + s.d), 1000);
      return NextResponse.json({
        layout: {
          whCode: wh,
          width: num(canvasRows[0]?.width_cm ?? null) || fallbackW,
          depth: num(canvasRows[0]?.depth_cm ?? null) || fallbackD,
          shapes,
          source: "db",
        } satisfies WarehouseLayout,
      });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    // migration 036 ຍັງບໍ່ໄດ້ run → ຕົກໄປໃຊ້ຜັງອັດຕະໂນມັດ.
  }

  return NextResponse.json({ layout: await buildAutoLayout(wh) });
}

type ShapeInput = Partial<Record<keyof LayoutShape, unknown>>;

function parseShape(raw: unknown): LayoutShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as ShapeInput;
  const code = typeof s.code === "string" ? s.code.trim() : "";
  if (!code || code.length > 60) return null;
  const n = (v: unknown): number | null => {
    const parsed = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const x = n(s.x);
  const y = n(s.y);
  const w = n(s.w);
  const d = n(s.d);
  if (x == null || y == null || w == null || d == null) return null;
  if (!(w > 0) || !(d > 0)) return null;
  const h = n(s.h);
  const label = typeof s.label === "string" ? s.label.slice(0, 60) : null;
  const color = typeof s.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(s.color) ? s.color : null;
  const sort = n(s.sort);
  return {
    kind: s.kind === "zone" ? "zone" : "location",
    code,
    label,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    d: Math.round(d),
    h: h == null ? null : Math.round(h),
    color,
    sort: sort == null ? 0 : Math.round(sort),
  };
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (session.role !== "manager") {
    return NextResponse.json({ error: "ແກ້ໄຂຜັງໄດ້ສະເພາະຜູ້ຈັດການ" }, { status: 403 });
  }

  let body: { wh?: unknown; width?: unknown; depth?: unknown; shapes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = typeof body.wh === "string" ? body.wh.trim() : "";
  if (!wh) return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const width = Math.round(Number(body.width));
  const depth = Math.round(Number(body.depth));
  if (!(width > 0) || !(depth > 0)) {
    return NextResponse.json({ error: "ຂະໜາດພື້ນສາງບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const rawShapes = Array.isArray(body.shapes) ? body.shapes : [];
  if (rawShapes.length > 2000) {
    return NextResponse.json({ error: "ຮູບຫຼາຍເກີນໄປ" }, { status: 400 });
  }
  const shapes: LayoutShape[] = [];
  const seen = new Set<string>();
  for (const raw of rawShapes) {
    const parsed = parseShape(raw);
    if (!parsed) return NextResponse.json({ error: "ຮູບໃນຜັງບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    if (seen.has(parsed.code)) {
      return NextResponse.json({ error: `ລະຫັດຊ້ຳກັນ: ${parsed.code}` }, { status: 400 });
    }
    seen.add(parsed.code);
    shapes.push(parsed);
  }

  const who = session.employee_code ?? null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.odg_wms_layout_canvas (wh_code, width_cm, depth_cm, updated_at, updated_by)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (wh_code) DO UPDATE
         SET width_cm = EXCLUDED.width_cm,
             depth_cm = EXCLUDED.depth_cm,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by`,
      [wh, width, depth, who],
    );
    // ບັນທຶກທັບທັງຜັງ — ງ່າຍກວ່າ ແລະ ກົງກັບສິ່ງທີ່ຜູ້ໃຊ້ເຫັນເທິງໜ້າຈໍ.
    await client.query(`DELETE FROM public.odg_wms_layout_shape WHERE wh_code = $1`, [wh]);
    for (const s of shapes) {
      await client.query(
        `INSERT INTO public.odg_wms_layout_shape
           (wh_code, kind, code, label, x_cm, y_cm, w_cm, d_cm, h_cm, color, sort, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)`,
        [wh, s.kind, s.code, s.label, s.x, s.y, s.w, s.d, s.h, s.color, s.sort, who],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (isMissingTable(err)) {
      return NextResponse.json(
        { error: "ຍັງບໍ່ໄດ້ run migration 036_wms_layout.sql" },
        { status: 503 },
      );
    }
    throw err;
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, saved: shapes.length });
}
