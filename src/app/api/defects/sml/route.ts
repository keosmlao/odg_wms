import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Stock sitting on a defect shelf according to SML, versus what has actually
 * been registered in the defect book — ລາຍງານຄົງເຫຼືອໃນສາງມີຕຳນິ.
 *
 * `sml_qty` is the SML balance at the shelf; `registered_qty` is the sum of
 * still-unissued defect entries for that item+warehouse; `unregistered_qty` is
 * the gap, i.e. goods physically on the defect shelf that nobody has written up
 * yet. Ported from `Start_Get_Defect_Sml`.
 *
 * One shelf at a time, by design: the SML balance function is expensive
 * (~20s unfiltered), so the shelf code is pushed down into its
 * `location_code_list` argument, which brings a shelf back in well under a
 * second.
 *
 * GET /api/defects/sml?location=<shelf code>
 */

export type DefectSmlRow = {
  ic_code: string;
  ic_name: string | null;
  unit_code: string | null;
  item_brand: string | null;
  warehouse: string;
  warehouse_name: string | null;
  location: string;
  location_name: string | null;
  sml_qty: string;
  registered_qty: string;
  unregistered_qty: string;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const location = new URL(request.url).searchParams.get("location")?.trim() ?? "";
  if (!location) return NextResponse.json({ error: "ກະລຸນາເລືອກບ່ອນຈັດເກັບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" }, { status: 403 });
  }

  // The shelf must be a real defect shelf, and its warehouse must be in scope.
  const shelf = await query<{ wh_code: string }>(
    `SELECT s.whcode AS wh_code
     FROM public.ic_shelf s
     JOIN public.odg_defect_warehouse w ON w.code = s.whcode
     WHERE s.code = $1
     LIMIT 1`,
    [location],
  );
  if (shelf.length === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບບ່ອນຈັດເກັບເຄື່ອງມີຕຳນິນີ້" }, { status: 400 });
  }
  if (Array.isArray(accessible) && !accessible.includes(shelf[0].wh_code)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await query<DefectSmlRow>(
    `WITH sml AS (
       SELECT st.ic_code, st.ic_name, st.ic_unit_code, st.warehouse, st.location,
              ROUND(st.balance_qty, 2) AS balance_qty
       FROM public.sml_ic_function_stock_balance_warehouse_location(
              '2099-12-31'::date, ''::varchar, ''::varchar, $1::varchar) st
       WHERE st.location = $1 AND st.balance_qty > 0
     ),
     registered AS (
       SELECT ic_code, warehouse, SUM(qty) AS qty
       FROM public.odg_product_defect
       WHERE status = $2
       GROUP BY ic_code, warehouse
     )
     SELECT
       sml.ic_code,
       sml.ic_name,
       sml.ic_unit_code                                      AS unit_code,
       ic.item_brand,
       sml.warehouse,
       w.name_1                                              AS warehouse_name,
       sml.location,
       s.name_1                                              AS location_name,
       sml.balance_qty::text                                 AS sml_qty,
       COALESCE(r.qty, 0)::numeric::text                     AS registered_qty,
       ROUND(sml.balance_qty - COALESCE(r.qty, 0), 2)::text   AS unregistered_qty
     FROM sml
     LEFT JOIN public.ic_inventory ic ON ic.code = sml.ic_code
     LEFT JOIN public.ic_warehouse w  ON w.code = sml.warehouse
     LEFT JOIN public.ic_shelf s      ON s.code = sml.location
     LEFT JOIN registered r ON r.ic_code = sml.ic_code AND r.warehouse = sml.warehouse
     ORDER BY sml.ic_code`,
    [location, DEFECT_STATUS.pending],
  );

  const sum = (pick: (r: DefectSmlRow) => string) =>
    rows.reduce((total, r) => total + (Number.parseFloat(pick(r)) || 0), 0);

  return NextResponse.json({
    kpi: {
      items: rows.length,
      sml_qty: sum((r) => r.sml_qty),
      registered_qty: sum((r) => r.registered_qty),
      unregistered_qty: sum((r) => r.unregistered_qty),
    },
    rows,
  });
}
