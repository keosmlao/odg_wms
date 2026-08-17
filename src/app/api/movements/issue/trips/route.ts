import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";
import { listTrips } from "@/lib/tripPick";

/**
 * ລາຍການ "ໃບຈັດຖ້ຽວ" ຂອງຂົນສົ່ງ (odg_tms) ທີ່ຍັງມີສິນຄ້າຄ້າງຈ່າຍໃນສາງນີ້ —
 * ຕົ້ນທາງຂອງໃບສັ່ງຈ່າຍ ແບບ "1 ຖ້ຽວ = ຫຼາຍບິນ".
 *
 * Query: ?wh=<code>&q=&days=&limit=&all=1&started=1
 *   all=1     → ລວມຖ້ຽວທີ່ຈ່າຍໝົດແລ້ວນຳ (ຄ່າເລີ່ມຕົ້ນເອົາສະເພາະທີ່ຍັງຄ້າງ).
 *   started=1 → ລວມຖ້ຽວທີ່ອອກລົດ/ປິດວຽກໄປແລ້ວນຳ. ຄ່າເລີ່ມຕົ້ນສະແດງສະເພາະ
 *               ຖ້ຽວທີ່ "ຍັງບໍ່ທັນເລີ່ມຈັດສົ່ງ" — ຖ້ຽວທີ່ອອກໄປແລ້ວ ເກັບເຄື່ອງໃສ່ບໍ່ໄດ້ອີກ.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const warehouses = await scopedWarehouses(session, url.searchParams.get("wh"));
  if (warehouses.length === 0) return NextResponse.json({ warehouses: [], trips: [] });

  const common = {
    q: url.searchParams.get("q") ?? "",
    days: Number.parseInt(url.searchParams.get("days") ?? "14", 10) || 14,
    limit: Number.parseInt(url.searchParams.get("limit") ?? "40", 10) || 40,
    onlyPending: url.searchParams.get("all") !== "1",
    onlyNotStarted: url.searchParams.get("started") !== "1",
  };

  // ຖ້ຽວແມ່ນ "ຕໍ່ສາງ" (ຄ້າງເກັບຂອງບິນນັບຈາກສາງນັ້ນ) → ດຶງເທື່ອລະສາງ ແລ້ວຕິດປ້າຍ wh_code.
  const perWh = await Promise.all(
    warehouses.map(async (w) => (await listTrips({ ...common, wh: w.code })).map((t) => ({ ...t, wh_code: w.code }))),
  );

  return NextResponse.json({ warehouses, trips: perWh.flat() });
}
