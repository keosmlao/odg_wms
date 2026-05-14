import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";

export type Warehouse = {
  code: string;
  name_1: string | null;
  name_2: string | null;
  address: string | null;
  telephone: string | null;
  fax: string | null;
  branch_code: string | null;
  wh_manager: string | null;
  status: number | null;
  latitude: string | null;
  longitude: string | null;
};

const SELECT_FIELDS = `
  code, name_1, name_2, address, telephone, fax,
  branch_code, wh_manager, status, latitude, longitude
`;

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const rows = await query<Warehouse>(
    `SELECT ${SELECT_FIELDS} FROM public.ic_warehouse ORDER BY code`,
  );
  return NextResponse.json({ warehouses: rows });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nullableStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const code = str(body.code);
  if (!code) {
    return NextResponse.json({ error: "ກະລຸນາປ້ອນລະຫັດສາງ" }, { status: 400 });
  }
  if (code.length > 20) {
    return NextResponse.json(
      { error: "ລະຫັດສາງຍາວເກີນ 20 ຕົວ" },
      { status: 400 },
    );
  }

  const status = body.status === 0 || body.status === false ? 0 : 1;

  try {
    const rows = await query<Warehouse>(
      `INSERT INTO public.ic_warehouse
         (code, name_1, name_2, address, telephone, fax,
          branch_code, wh_manager, status, latitude, longitude)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${SELECT_FIELDS}`,
      [
        code,
        nullableStr(body.name_1),
        nullableStr(body.name_2),
        nullableStr(body.address),
        nullableStr(body.telephone),
        nullableStr(body.fax),
        nullableStr(body.branch_code),
        nullableStr(body.wh_manager),
        status,
        numericOrNull(body.latitude),
        numericOrNull(body.longitude),
      ],
    );
    return NextResponse.json({ ok: true, warehouse: rows[0] });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "23505") {
      return NextResponse.json(
        { error: "ລະຫັດສາງນີ້ມີຢູ່ແລ້ວ" },
        { status: 409 },
      );
    }
    console.error("create warehouse failed:", err);
    return NextResponse.json(
      { error: "ບັນທຶກບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  }
}
