import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * In-stock serials of one item, sourced from `sn_inventory` (status = 0 means
 * still on hand), with provenance dates derived from the serial-movement view
 * (keyed by ISN):
 *   - first_in   : earliest stock-in date  → age since purchase/entry
 *   - arrived_wh : latest in-movement into THIS warehouse → time at this warehouse
 *
 * Query: ?item=<item_code>&wh=<wh_code>   (both required)
 *   Optional location scope (exact match, "" = stored at that level only). When
 *   `location` is present the result is narrowed to that exact storage node so
 *   the serial count matches the location's stock balance:
 *     &rack=<shelf>&location=<shelf1>&pallet=<pallet>
 * Returns: { items:[{ sn, factory_sn, isn, wh_code, item_brand, status_name,
 *            first_in, arrived_wh }] }
 *
 * A unit carries up to two identifiers and BOTH are returned:
 *   - factory_sn : the manufacturer's serial. NULL for ~17k in-stock units that
 *                  were only ever labelled internally.
 *   - isn        : this company's own running serial.
 *   - sn         : the canonical id = COALESCE(factory_sn, isn). This is what
 *                  /serials/[sn] and sn_trans match on, so it is the value to
 *                  link with — never render it as "the SN", it may be an ISN.
 */
const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const item = (url.searchParams.get("item") ?? "").trim();
  const wh = (url.searchParams.get("wh") ?? "").trim();
  if (!item || !wh) {
    return NextResponse.json({ error: "ຕ້ອງມີ item ແລະ wh" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ items: [] });
  }
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // Optional exact-location scoping. Presence of `location` (even empty) opts in
  // — mirrors balance-node semantics where "" means "stored at the level above
  // only" (e.g. rack-level, not on any pallet).
  const args: unknown[] = [item, wh];
  const filters = ["si.item_code = $1", "si.wh_code = $2", "si.status = 0"];
  if (url.searchParams.has("location")) {
    args.push(
      (url.searchParams.get("rack") ?? "").trim(),
      (url.searchParams.get("location") ?? "").trim(),
      (url.searchParams.get("pallet") ?? "").trim(),
    );
    filters.push("COALESCE(NULLIF(TRIM(si.rack), ''), '') = $3");
    filters.push("COALESCE(NULLIF(TRIM(si.location), ''), '') = $4");
    filters.push("COALESCE(NULLIF(TRIM(si.pallet), ''), '') = $5");
  }

  const items = await query<{
    sn: string;
    factory_sn: string | null;
    isn: string | null;
    wh_code: string;
    item_brand: string | null;
    status_name: string | null;
    first_in: string | null;
    arrived_wh: string | null;
  }>(
    `WITH bal AS (
       SELECT NULLIF(TRIM(si.sn), '')  AS factory_sn,
              NULLIF(TRIM(si.isn), '') AS isn,
              si.wh_code, b.item_brand
       FROM public.sn_inventory si
       LEFT JOIN public.odg_sn_balance b ON b.sn = si.sn
       WHERE ${filters.join(" AND ")}
     ),
     tr AS (
       SELECT t.sn AS isn,
         min(t.doc_date) FILTER (WHERE t.calc_in_type::text = '1') AS first_in,
         max(t.doc_date) FILTER (WHERE t.calc_in_type::text = '1' AND t.warehouse = $2) AS arrived_wh
       FROM public.odg_sn_trans_detail t
       WHERE t.sn IN (SELECT isn FROM bal WHERE isn IS NOT NULL)
       GROUP BY t.sn
     )
     SELECT COALESCE(bal.factory_sn, bal.isn) AS sn,
            bal.factory_sn, bal.isn,
            bal.wh_code, bal.item_brand, '${STATUS_INSTOCK}' AS status_name,
            to_char(tr.first_in, 'YYYY-MM-DD')   AS first_in,
            to_char(tr.arrived_wh, 'YYYY-MM-DD') AS arrived_wh
     FROM bal
     LEFT JOIN tr ON tr.isn = bal.isn
     -- ISN ascending = oldest unit first (FIFO), the order the rest of the app uses.
     ORDER BY COALESCE(bal.isn, bal.factory_sn)
     LIMIT 500`,
    args,
  );

  return NextResponse.json({ items });
}
