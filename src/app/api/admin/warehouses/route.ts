import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";
import {
  type SnFlags,
  isSnFlag,
  setManyWarehousesSnFlag,
  setWarehouseKind,
  warehouseKindError,
} from "@/lib/warehouseConfig";
import {
  type WarehouseKind,
  isWarehouseKind,
  toWarehouseKind,
} from "@/lib/warehouseKind";

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
  /** ສາງຫຼັກ ຫຼື ສາງຍ່ອຍ (WMS-only — ບໍ່ຢູ່ໃນ master ຂອງ ERP). */
  kind: WarehouseKind;
  /** ສາງແມ່ທັງໝົດ — ສາງຍ່ອຍໜຶ່ງຂຶ້ນກັບໄດ້ຫຼາຍສາງຫຼັກ (migration 042). */
  parent_codes: string[];
  /**
   * ວັນທີສາງນີ້ເລີ່ມຈ່າຍຜ່ານ WMS (YYYY-MM-DD) — ບິນຄ້າງຈ່າຍທີ່ລົງວັນທີ
   * ກ່ອນໜ້ານີ້ຈະບໍ່ຂຶ້ນລາຍການ. null = ບໍ່ຈຳກັດ (migration 043).
   */
  wms_start_date: string | null;
};

const SELECT_FIELDS = `
  code, name_1, name_2, address, telephone, fax,
  branch_code, wh_manager, status, latitude, longitude
`;

type WhRow = Omit<Warehouse, "sn" | "kind" | "parent_codes"> & {
  wh_kind: string | null;
  parent_codes: string[] | null;
  sn_receive: boolean;
  sn_issue: boolean;
  sn_issue_pick: boolean;
  sn_transfer: boolean;
  sn_pallet: boolean;
  sn_adjust: boolean;
  sn_return: boolean;
};

function rowToWarehouse(r: WhRow): Warehouse {
  const { sn_receive, sn_issue, sn_issue_pick, sn_transfer, sn_pallet, sn_adjust, sn_return, wh_kind, parent_codes, ...rest } = r;
  const kind = toWarehouseKind(wh_kind);
  return {
    ...rest,
    kind,
    // ສາງຫຼັກມີແມ່ບໍ່ໄດ້ — ລ້າງໃຫ້ ເຜື່ອຂໍ້ມູນເກົ່າຄ້າງໄວ້
    parent_codes: kind === "sub" ? (parent_codes ?? []) : [],
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
    return NextResponse.json({ error: "ຕ້ອງລະບຸ value (true/false)" }, { status: 400 });
  }

  let codes: string[];
  if (body.all === true) {
    codes = (
      await query<{ code: string }>(`SELECT code FROM public.ic_warehouse`)
    ).map((r) => r.code);
  } else if (Array.isArray(body.codes)) {
    codes = body.codes.filter((c): c is string => typeof c === "string" && c.length > 0);
  } else {
    return NextResponse.json({ error: "ຕ້ອງລະບຸ codes[] ຫຼື all:true" }, { status: 400 });
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
            COALESCE(c.sn_return, true)   AS sn_return,
            COALESCE(c.wh_kind, 'main')   AS wh_kind,
            to_char(c.wms_start_date, 'YYYY-MM-DD') AS wms_start_date,
            COALESCE(p.parent_codes, '{}') AS parent_codes
     FROM public.ic_warehouse w
     LEFT JOIN public.odg_wms_warehouse_config c ON c.wh_code = w.code
     LEFT JOIN (
       SELECT wh_code, array_agg(parent_code ORDER BY parent_code) AS parent_codes
       FROM public.odg_wms_warehouse_parent GROUP BY wh_code
     ) p ON p.wh_code = w.code
     ORDER BY w.code`,
  );
  return NextResponse.json({ warehouses: rows.map(rowToWarehouse) });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** ລາຍການລະຫັດຈາກ body — ຮັບແຕ່ string ທີ່ບໍ່ວ່າງ ແລະ ບໍ່ຊ້ຳ. */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
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

  const kind: WarehouseKind = isWarehouseKind(body.kind) ? body.kind : "main";
  const parentCodes = kind === "sub" ? strList(body.parent_codes) : [];
  const kindErr = await warehouseKindError(code, kind, parentCodes);
  if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });

  try {
    const rows = await query<Omit<Warehouse, "sn" | "kind" | "parent_codes">>(
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
    // ຂຽນແຖວ config ສະເພາະສາງຍ່ອຍ — ສາງຫຼັກຄືຄ່າເລີ່ມຕົ້ນຢູ່ແລ້ວ ຈຶ່ງບໍ່ຕ້ອງມີແຖວ.
    if (kind === "sub") {
      await setWarehouseKind(code, kind, parentCodes, guard.session.employee_code ?? null);
    }
    return NextResponse.json({
      ok: true,
      warehouse: { ...rows[0], sn, kind, parent_codes: parentCodes },
    });
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
      { error: e.message?.startsWith("ຍັງບໍ່ໄດ້ run") ? e.message : "ບັນທຶກບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  }
}
