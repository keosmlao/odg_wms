import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { Session, WmsRole } from "@/lib/session-shared";

type LiveRow = {
  role: WmsRole | null;
  warehouses: string[];
  employment_status: string | null;
};

/** ຕົວຕົນຈາກ cookie ເທົ່ານັ້ນ — role/ສາງ ໃນນັ້ນຖືວ່າລ້າສະໄໝ. */
async function sessionCookie(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get("wms_session")?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return typeof parsed?.employee_id === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * ສິດຂອງຜູ້ໃຊ້ຖືກອ່ານ **ສົດຈາກຖານຂໍ້ມູນທຸກຄັ້ງ** ບໍ່ແມ່ນຈາກ cookie.
 *
 * cookie ຖືກຕັ້ງຕອນ login ແລະ ຢູ່ໄດ້ 8 ຊົ່ວໂມງ — ຖ້າເຊື່ອ role/ສາງ ໃນນັ້ນ ຜູ້ທີ່
 * ຫາກໍ່ຖືກມອບສິດຈະໃຊ້ບໍ່ໄດ້ຈົນກວ່າຈະ login ໃໝ່ ແລະ ຜູ້ທີ່ຖືກຖອນສິດຈະຍັງເຮັດວຽກ
 * ຕໍ່ໄດ້. ອ່ານສົດຈຶ່ງເຮັດໃຫ້ "ມອບສິດແລ້ວ = ໃຊ້ໄດ້ທັນທີ" ແລະ ຖອນສິດກໍ່ມີຜົນທັນທີ.
 * ເປັນແນວດຽວກັນກັບ permissionsFor() ທີ່ບໍ່ເຄີຍເຊື່ອ cookie ຢູ່ແລ້ວ.
 *
 * `cache()` ເຮັດໃຫ້ຍິງ query ພຽງເທື່ອດຽວຕໍ່ 1 request ເຖິງວ່າຈະຖືກເອີ້ນຫຼາຍບ່ອນ.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieSession = await sessionCookie();
  if (!cookieSession) return null;

  let live: LiveRow | undefined;
  try {
    const rows = await query<LiveRow>(
      `SELECT
         r.role,
         COALESCE(
           (SELECT array_agg(w.warehouse_code ORDER BY w.warehouse_code)
            FROM public.wms_user_warehouse w
            WHERE w.employee_id = e.employee_id),
           ARRAY[]::varchar[]
         ) AS warehouses,
         e.employment_status
       FROM public.odg_employee e
       LEFT JOIN public.wms_user_role r ON r.employee_id = e.employee_id
       WHERE e.employee_id = $1`,
      [cookieSession.employee_id],
    );
    live = rows[0];
  } catch {
    // DB ບໍ່ຕອບ — ຢ່າເຕະທຸກຄົນອອກ, ໃຊ້ຄ່າໃນ cookie ໄປກ່ອນ (ພຶດຕິກຳເກົ່າ).
    return cookieSession;
  }

  // ພະນັກງານຖືກລຶບ ຫຼື ອອກວຽກແລ້ວ → session ໝົດອາຍຸທັນທີ.
  if (!live) return null;
  if (live.employment_status && live.employment_status !== "ACTIVE") return null;

  return {
    ...cookieSession,
    role: live.role ?? null,
    warehouses: live.warehouses ?? [],
  };
});

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
