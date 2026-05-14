import "server-only";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";

export type SessionStatus = "open" | "pending_approval" | "closed";

export type SessionRow = {
  session_id: number;
  session_code: string;
  wh_code: string;
  name: string | null;
  note: string | null;
  status: SessionStatus;
  count_date: string;
  blind: boolean;
  created_by: number | null;
  created_at: string;
  submitted_by: number | null;
  submitted_at: string | null;
  approved_by: number | null;
  approval_note: string | null;
  closed_by: number | null;
  closed_at: string | null;
};

export const SESSION_SELECT_FIELDS = `
  session_id, session_code, wh_code, name, note, status,
  count_date::text AS count_date,
  blind,
  created_by, created_at::text AS created_at,
  submitted_by, submitted_at::text AS submitted_at,
  approved_by, approval_note,
  closed_by, closed_at::text AS closed_at
`;

export type SessionGuard =
  | { ok: true; session: Session; row: SessionRow }
  | { ok: false; response: NextResponse };

export async function requireSessionAccess(
  sessionId: number,
  opts: { mustBeOpen?: boolean } = {},
): Promise<SessionGuard> {
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

  const rows = await query<SessionRow>(
    `SELECT ${SESSION_SELECT_FIELDS}
     FROM public.wms_stocktake_session
     WHERE session_id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ພົບຮອບກວດນັບ" },
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

  if (opts.mustBeOpen && row.status !== "open") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            row.status === "pending_approval"
              ? "ຮອບກວດນັບກຳລັງລໍຖ້າອະນຸມັດ — ບໍ່ສາມາດແກ້ໄຂໄດ້"
              : "ຮອບກວດນັບປິດແລ້ວ — ບໍ່ສາມາດແກ້ໄຂໄດ້",
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, session: userSession, row };
}

/**
 * Generate the next session_code for the given count_date. Format: ST-YYYYMM-NNN
 */
export async function nextSessionCode(countDate: string): Promise<string> {
  const d = new Date(countDate);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `ST-${ym}-`;
  const rows = await query<{ max: string | null }>(
    `SELECT MAX(session_code) AS max
     FROM public.wms_stocktake_session
     WHERE session_code LIKE $1`,
    [`${prefix}%`],
  );
  const last = rows[0]?.max ?? null;
  const lastN = last ? Number.parseInt(last.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastN + 1).padStart(3, "0")}`;
}

export function asNumericString(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
