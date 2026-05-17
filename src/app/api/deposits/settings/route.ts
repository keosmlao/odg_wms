import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireManager } from "@/lib/session";
import { getDepositSettings } from "@/lib/deposit-server";

const ALLOWED_KEYS = new Set([
  "free_days_max",
  "tier1_days_max",
  "tier1_pct",
  "tier2_days_max",
  "tier2_pct",
  "tier3_days_max",
  "tier3_pct",
  "tier4_pct",
  "min_charge",
  "max_charge",
  "currency",
]);

export async function GET() {
  const settings = await getDepositSettings();
  return NextResponse.json({ ok: true, settings });
}

/**
 * Update deposit settings. Manager-only. Body: { key: value } map.
 */
export async function PATCH(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const entries = Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k));
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "ບໍ່ມີຄ່າທີ່ໃຫ້ປ່ຽນ" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, raw] of entries) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      await client.query(
        `INSERT INTO public.wms_deposit_setting (key, value, updated_at, updated_by)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = EXCLUDED.updated_at,
               updated_by = EXCLUDED.updated_by`,
        [key, value, guard.session.employee_id],
      );
    }
    await client.query("COMMIT");
    const settings = await getDepositSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("update deposit settings failed:", err);
    return NextResponse.json(
      { error: "ບັນທຶກບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
