import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import AutoPrint from "../../wms/[doc]/AutoPrint";
import { tripHeader } from "@/lib/tripPick";

/**
 * ໃບເກັບສິນຄ້າ "ລວມທັງຖ້ຽວ" — ລວມທຸກໃບ pick ທີ່ອອກຈາກໃບຈັດຖ້ຽວ 1 ໃບ
 * (wms_pick_trip) ມາຮຽງຕາມບ່ອນຈັດເກັບ ໃຫ້ຄົນເກັບຍ່າງເກັບເທື່ອດຽວ, ແລ້ວແຍກໃຫ້
 * ເຫັນວ່າ ແຕ່ລະບ່ອນ ເກັບໃຫ້ບິນໃດແດ່ (ຕອນຢືນຢັນຈ່າຍ ຍັງເປັນໃບໃຜໃບມັນຄືເກົ່າ).
 *
 * /print/pick-trip/<trip_doc_no>?wh=<code>&auto=1
 */
function parseNode(shelf: string | null): string {
  const [rack = "", location = "", pallet = ""] = (shelf ?? "").split("|");
  return [rack, location, pallet].filter(Boolean).join(" / ") || "(ສາງ)";
}

export default async function PrintTripPickPage({
  params,
  searchParams,
}: {
  params: Promise<{ trip: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { trip } = await params;
  const sp = await searchParams;
  const tripNo = decodeURIComponent(trip).trim();
  const wh = (sp.wh ?? "").trim();

  const header = await tripHeader(tripNo);

  const rows = await query<{
    doc_no: string;
    bill_no: string | null;
    status: number | null;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    qty: string;
    shelf_code: string | null;
    wh_code: string | null;
    wh_name: string | null;
  }>(
    `SELECT o.doc_no,
            -- ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) ເກັບບິນໄວ້ລະດັບແຖວ; ໃບເກົ່າໃຊ້ ref ຂອງ header
            COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), pt.bill_no, o.ref_doc_no) AS bill_no,
            o.status, d.item_code, d.item_name, d.unit_code,
            d.qty::numeric::text AS qty, d.shelf_code,
            o.warehouse_code AS wh_code, w.name_1 AS wh_name
     FROM public.wms_pick_trip pt
     JOIN public.wms_product_out o ON o.doc_no = pt.doc_no
     JOIN public.wms_product_out_detail d ON d.doc_no = pt.doc_no
     LEFT JOIN public.ic_warehouse w ON w.code = o.warehouse_code
     WHERE pt.trip_doc_no = $1
       AND ($2 = '' OR o.warehouse_code = $2)
     ORDER BY d.shelf_code, d.item_code, pt.bill_no`,
    [tripNo, wh],
  );

  const serials = await query<{ doc_no: string; item_code: string; serial_number: string }>(
    `SELECT s.ref_out_doc AS doc_no, s.item_code, s.serial_number
     FROM public.wms_pick_trip pt
     JOIN public.wms_product_out_serial_detail s ON s.ref_out_doc = pt.doc_no
     WHERE pt.trip_doc_no = $1
     ORDER BY s.serial_number`,
    [tripNo],
  );
  const snByDocItem = new Map<string, string[]>();
  for (const s of serials) {
    const k = `${s.doc_no}|${s.item_code}`;
    const a = snByDocItem.get(k) ?? [];
    a.push(s.serial_number);
    snByDocItem.set(k, a);
  }

  // ລວມແຖວ (ບ່ອນຈັດເກັບ + ສິນຄ້າ) ໃຫ້ຄົນເກັບຍ່າງເທື່ອດຽວ ຫຍິບອອກມາລວມ —
  // ບໍ່ແຍກຕາມບິນ, ພຽງບອກວ່າແຖວນີ້ເປັນຂອງບິນໃດແດ່.
  type Walk = {
    loc: string;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    qty: number;
    bills: string[];
    sns: string[];
  };
  const walkMap = new Map<string, Walk>();
  for (const r of rows) {
    const loc = parseNode(r.shelf_code);
    const key = `${loc}|${r.item_code}`;
    const entry = walkMap.get(key) ?? {
      loc, item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code, qty: 0, bills: [], sns: [],
    };
    entry.qty += Number.parseFloat(r.qty) || 0;
    const bill = r.bill_no ?? r.doc_no;
    if (bill && !entry.bills.includes(bill)) entry.bills.push(bill);
    for (const sn of snByDocItem.get(`${r.doc_no}|${r.item_code}`) ?? []) {
      if (!entry.sns.includes(sn)) entry.sns.push(sn);
    }
    walkMap.set(key, entry);
  }
  const walk = [...walkMap.values()].sort((a, b) => a.loc.localeCompare(b.loc) || a.item_code.localeCompare(b.item_code));
  const slips = [...new Set(rows.map((r) => r.doc_no))];
  const whName = rows[0]?.wh_name ?? null;
  const whCode = rows[0]?.wh_code ?? wh;
  const totalQty = walk.reduce((s, w) => s + w.qty, 0);

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif" }}>
      <style>{`@media print { .no-print { display:none !important } @page { margin: 12mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {walk.length === 0 ? (
        <p className="text-center text-rose-600">ບໍ່ພົບໃບສັ່ງຈ່າຍຂອງຖ້ຽວ {tripNo}</p>
      ) : (
        <>
          <div className="mb-1 text-center text-lg font-black">ODIEN GROUP</div>
          <div className="mb-4 text-center text-base font-bold">ໃບເກັບສິນຄ້າ ຕາມໃບຈັດຖ້ຽວ (ສຳລັບ forklift)</div>

          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><b>ໃບຈັດຖ້ຽວ:</b> <span className="font-mono">{tripNo}</span></div>
            <div><b>ສາງ:</b> {whCode} {whName ?? ""}</div>
            <div><b>ລົດ:</b> {header?.car_name ?? header?.car ?? "—"}</div>
            <div><b>ຄົນຂັບ:</b> {header?.driver_name ?? header?.driver ?? "—"}{header?.driver_tel ? ` · ${header.driver_tel}` : ""}</div>
            <div><b>ສາຍ/ຮອບ:</b> {header?.route_name ?? "—"}{header?.round_name ? ` · ${header.round_name}` : ""}</div>
            <div><b>ວັນທີ່ຖ້ຽວ:</b> {header?.date_logistic ?? header?.doc_date ?? "—"}</div>
            <div className="col-span-2"><b>ໃບ pick ໃນຖ້ຽວ:</b> <span className="font-mono text-xs">{slips.join(", ")}</span></div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="w-8 border border-slate-300 px-2 py-1">#</th>
                <th className="border border-slate-300 px-2 py-1">ບ່ອນເກັບ (walk order)</th>
                <th className="border border-slate-300 px-2 py-1">ສິນຄ້າ</th>
                <th className="w-36 border border-slate-300 px-2 py-1">ບິນຂາຍ</th>
                <th className="w-24 border border-slate-300 px-2 py-1 text-right">ລວມ</th>
                <th className="w-10 border border-slate-300 px-2 py-1 text-center">✓</th>
              </tr>
            </thead>
            <tbody>
              {walk.map((r, i) => (
                <tr key={`${r.loc}-${r.item_code}`} className="align-top">
                  <td className="border border-slate-300 px-2 py-1.5 text-center">{i + 1}</td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono font-bold">{r.loc}</td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    <div className="font-mono text-xs font-bold">{r.item_code}</div>
                    <div>{r.item_name}</div>
                    {r.sns.length > 0 && <div className="mt-0.5 text-[10px] text-slate-500">SN: {r.sns.join(", ")}</div>}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono text-xs">{r.bills.join(", ") || "—"}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-base font-bold">{r.qty} {r.unit_code ?? ""}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center text-lg">☐</td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="border border-slate-300 px-2 py-1.5" colSpan={4}><b>ລວມທັງໝົດ</b> ({walk.length} ລາຍການ · {slips.length} ໃບ pick)</td>
                <td className="border border-slate-300 px-2 py-1.5 text-right font-mono text-base font-bold">{totalQty}</td>
                <td className="border border-slate-300 px-2 py-1.5" />
              </tr>
            </tbody>
          </table>

          <div className="mt-12 grid grid-cols-4 gap-4 text-center text-sm">
            {["ຜູ້ເກັບ (forklift)", "ຜູ້ຈ່າຍເຄື່ອງອອກສາງ", "ຜູ້ກວດສອບ", "ຄົນຂັບ / ຜູ້ຮັບຂຶ້ນລົດ"].map((s) => (
              <div key={s}>
                <div className="mb-10 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[10px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
          <p className="no-print mt-6 text-center text-xs text-slate-400">
            * ເກັບຕາມໃບນີ້ເທື່ອດຽວທັງຖ້ຽວ — ກັບມາຢືນຢັນ &quot;② ຢືນຢັນຈ່າຍ&quot; ເປັນລາຍໃບ pick ເພື່ອຕັດ stock ຈິງ
          </p>
        </>
      )}
    </div>
  );
}
