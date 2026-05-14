import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Session } from "@/lib/session-shared";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get("wms_session")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export type GuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

export async function requireManager(): Promise<GuardResult> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" },
        { status: 401 },
      ),
    };
  }
  if (session.role !== "manager") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ສິດເຂົ້າເຖິງສະເພາະຜູ້ຈັດການ" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
