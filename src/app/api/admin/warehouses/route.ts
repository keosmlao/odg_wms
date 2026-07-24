import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";
import {
  type SnFlags,
  isSnFlag,
  setManyWarehousesSnFlag,
} from "@/lib/warehouseConfig";

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
  sn: SnFlags;
};

const SELECT_FIELDS = `
  code, name_1, name_2, address, telephone, fax,
  branch_code, wh_manager, status, latitude, longitude
`;

type WhRow = Omit<Warehouse, "sn"> & {
  sn_receive: boolean;
  sn_issue: boolean;
  sn_issue_pick: boolean;
  sn_transfer: boolean;
  sn_pallet: boolean;
  sn_adjust: boolean;
  sn_return: boolean;
};

function rowToWarehouse(r: WhRow): Warehouse {
  const { sn_receive, sn_issue, sn_issue_pick, sn_transfer, sn_pallet, sn_adjust, sn_return, ...rest } = r;
  return {
    ...rest,
    sn: {
      receive: sn_receive ?? true,
      issue: sn_issue ?? true,
      issue_pick: sn_issue_pick ?? true,
      transfer: sn_transfer ?? true,
      pallet: sn_pallet ?? true,
      adjust: sn_adjust ?? true,
      return: sn_return ?? true,
    },
  };
}

/** Bulk-set one SN menu flag. Body: { flag, value:boolean, all?:true, codes?:string[] }. */
export async function PATCH(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!isSnFlag(body.flag)) {
    return NextResponse.json({ error: "flag ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (typeof body.value !== "boolean") {
    return NextResponse.json({ error: "ຕ້ອງระบุ value (true/false)" }, { status: 400 });
  }

  let codes: string[];
  if (body.all === true) {
    codes = (
      await query<{ code: string }>(`SELECT code FROM public.ic_warehouse`)
    ).map((r) => r.code);
  } else if (Array.isArray(body.codes)) {
    codes = body.codes.filter((c): c is string => typeof c === "string" && c.length > 0);
  } else {
    return NextResponse.json({ error: "ຕ້ອງระบุ codes[] ຫຼື all:true" }, { status: 400 });
  }

  const updated = await setManyWarehousesSnFlag(
    codes,
    body.flag,
    body.value,
    guard.session.employee_code ?? null,
  );
  return NextResponse.json({ ok: true, updated, flag: body.flag, value: body.value });
}

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const rows = await query<WhRow>(
    `SELECT ${SELECT_FIELDS.split(",").map((f) => `w.${f.trim()}`).join(", ")},
            COALESCE(c.sn_receive, true)     AS sn_receive,
            COALESCE(c.sn_issue, true)       AS sn_issue,
            COALESCE(c.sn_issue_pick, true)  AS sn_issue_pick,
            COALESCE(c.sn_transfer, true)    AS sn_transfer,
            COALESCE(c.sn_pallet, true)   AS sn_pallet,
            COALESCE(c.sn_adjust, true)   AS sn_adjust,
            COALESCE(c.sn_return, true)   AS sn_return
     FROM public.ic_warehouse w
     LEFT JOIN public.odg_wms_warehouse_config c ON c.wh_code = w.code
     ORDER BY w.code`,
  );
  return NextResponse.json({ warehouses: rows.map(rowToWarehouse) });
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
    const rows = await query<Omit<Warehouse, "sn">>(
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
    // New warehouses default to SN-on for every menu (no config row needed).
    const sn: SnFlags = { receive: true, issue: true, issue_pick: true, transfer: true, pallet: true, adjust: true, return: true };
    return NextResponse.json({ ok: true, warehouse: { ...rows[0], sn } });
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
