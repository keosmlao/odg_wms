import "server-only";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";
import {
  DEFAULT_SETTINGS,
  type DepositRow,
  type DepositSettings,
} from "@/lib/deposit";

function num(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the current global deposit settings. Missing keys fall back to
 * DEFAULT_SETTINGS values so the system always has a usable tier set
 * even after a fresh install.
 */
export async function getDepositSettings(): Promise<DepositSettings> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM public.wms_deposit_setting`,
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    fee_model: "tiered_percent",
    free_days_max: Math.round(
      num(m.get("free_days_max") ?? null, DEFAULT_SETTINGS.free_days_max),
    ),
    tier1_days_max: Math.round(
      num(m.get("tier1_days_max") ?? null, DEFAULT_SETTINGS.tier1_days_max),
    ),
    tier1_pct: num(m.get("tier1_pct") ?? null, DEFAULT_SETTINGS.tier1_pct),
    tier2_days_max: Math.round(
      num(m.get("tier2_days_max") ?? null, DEFAULT_SETTINGS.tier2_days_max),
    ),
    tier2_pct: num(m.get("tier2_pct") ?? null, DEFAULT_SETTINGS.tier2_pct),
    tier3_days_max: Math.round(
      num(m.get("tier3_days_max") ?? null, DEFAULT_SETTINGS.tier3_days_max),
    ),
    tier3_pct: num(m.get("tier3_pct") ?? null, DEFAULT_SETTINGS.tier3_pct),
    tier4_pct: num(m.get("tier4_pct") ?? null, DEFAULT_SETTINGS.tier4_pct),
    min_charge: num(m.get("min_charge") ?? null, DEFAULT_SETTINGS.min_charge),
    max_charge: num(m.get("max_charge") ?? null, DEFAULT_SETTINGS.max_charge),
    currency: m.get("currency") ?? DEFAULT_SETTINGS.currency,
  };
}

export type DepositGuard =
  | { ok: true; session: Session; row: DepositRow }
  | { ok: false; response: NextResponse };

export async function requireDepositAccess(
  depositId: number,
): Promise<DepositGuard> {
  const userSession = await getSession();
  if (!userSession) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" },
        { status: 401 },
      ),
    };
  }
  if (!userSession.role) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" },
        { status: 403 },
      ),
    };
  }

  const rows = await query<DepositRow>(
    `SELECT
       deposit_id, deposit_code, wh_code, cust_code, cust_name,
       start_date::text AS start_date,
       end_date::text   AS end_date,
       status,
       fee_model,
       free_days_max,
       tier1_days_max, tier1_pct::text AS tier1_pct,
       tier2_days_max, tier2_pct::text AS tier2_pct,
       tier3_days_max, tier3_pct::text AS tier3_pct,
       tier4_pct::text  AS tier4_pct,
       min_charge::text AS min_charge,
       max_charge::text AS max_charge,
       currency,
       total_items,
       total_qty::text   AS total_qty,
       total_value::text AS total_value,
       settled_fee::text AS settled_fee,
       settled_days,
       note,
       created_by,
       created_at::text  AS created_at,
       settled_by,
       settled_at::text  AS settled_at
     FROM public.wms_deposit
     WHERE deposit_id = $1`,
    [depositId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ພົບການຮັບຝາກ" },
        { status: 404 },
      ),
    };
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(row.wh_code)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session: userSession, row };
}

/** Generate the next deposit_code for a given date. Format: DP-YYYYMM-NNN */
export async function nextDepositCode(startDate: string): Promise<string> {
  const d = new Date(startDate);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `DP-${ym}-`;
  const rows = await query<{ max: string | null }>(
    `SELECT MAX(deposit_code) AS max
     FROM public.wms_deposit
     WHERE deposit_code LIKE $1`,
    [`${prefix}%`],
  );
  const last = rows[0]?.max ?? null;
  const lastN = last ? Number.parseInt(last.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastN + 1).padStart(3, "0")}`;
}
