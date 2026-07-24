import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { MOVE_REASONS } from "@/lib/moveReasons";
import { IN_TRANSIT_WH } from "@/lib/erpPost";
import AutoPrint from "./AutoPrint";

const REASON_LABEL = Object.fromEntries(MOVE_REASONS.map((r) => [r.code, r.label]));

/**
 * Standalone printable slip for any WMS movement (DP doc): goods-issue pick slip,
 * transfer-receive slip, or return slip. Renders from→to, qty and serials with
 * signature lines. Lives outside the (app) layout so it prints without chrome.
 */
type Header = {
  doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null;
  wh_code: string | null; wh_name: string | null; user_created: string | null;
};
type Row = {
  item_code: string; item_name: string | null; unit_code: string | null; qty: string;
  from_wh: string | null; from_loc: string | null; to_wh: string | null; to_loc: string | null;
};

function whLabel(code: string | null, name: string | null) {
  if (!code) return "—";
  return name ? `${code} ${name}` : code;
}

export default async function PrintWmsDocPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { doc } = await params;
  const sp = await searchParams;
  const docNo = decodeURIComponent(doc).trim();

  const head = await query<Header>(
    `SELECT t.doc_no, to_char(t.doc_date,'DD/MM/YYYY') AS doc_date, t.doc_time, t.doc_ref,
            t.wh_code, w.name_1 AS wh_name, t.user_created
     FROM public.odg_wms_trans t
     LEFT JOIN public.ic_warehouse w ON w.code = t.wh_code
     WHERE t.doc_no = $1 LIMIT 1`,
    [docNo],
  );
  const h = head[0];

  // Group the +/- detail legs per item → from (−1) / to (+1).
  const rows = h ? await query<Row>(
    `SELECT d.item_code,
            MAX(d.item_name) AS item_name,
            MAX(d.unit_code) AS unit_code,
            COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = -1), SUM(d.qty) FILTER (WHERE d.calc_flag = 1))::numeric::text AS qty,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = -1) AS from_wh,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = -1) AS from_loc,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = 1) AS to_wh,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = 1) AS to_loc
     FROM public.odg_wms_trans_detail d
     WHERE d.doc_no = $1
     GROUP BY d.item_code ORDER BY d.item_code`,
    [docNo],
  ) : [];

  // One row per physical unit — sn_trans_detail carries the exact rack/location/
  // pallet it moved at (source node for an issue-out leg, landing node for a
  // receive), so we can show "ຈ່າຍອອກ/ຮັບເຂົ້າ ທີ່ຈຸດໃດ" per serial, not just per item.
  const units = h ? await query<{ item_code: string; sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null }>(
    `SELECT item_code, NULLIF(TRIM(sn), '') AS sn, NULLIF(TRIM(isn), '') AS isn,
            NULLIF(TRIM(rack), '') AS rack, NULLIF(TRIM(location), '') AS location, NULLIF(TRIM(pallet), '') AS pallet
     FROM public.sn_trans_detail WHERE doc_no = $1 ORDER BY item_code, COALESCE(sn, isn)`,
    [docNo],
  ) : [];
  const unitsByItem = new Map<string, typeof units>();
  for (const u of units) {
    const a = unitsByItem.get(u.item_code) ?? []; a.push(u); unitsByItem.set(u.item_code, a);
  }
  function unitLoc(u: { rack: string | null; location: string | null; pallet: string | null }): string {
    return [u.rack, u.location, u.pallet].filter(Boolean).join(" / ") || "—";
  }

  // Short-movement reasons (table may not exist yet → degrade silently).
  let notes: { item_code: string; reason_code: string | null; short_qty: string | null }[] = [];
  if (h) {
    try {
      notes = await query<{ item_code: string; reason_code: string | null; short_qty: string | null }>(
        `SELECT item_code, reason_code, short_qty::numeric::text AS short_qty FROM public.odg_wms_move_note WHERE doc_no = $1 ORDER BY item_code`,
        [docNo],
      );
    } catch { notes = []; }
  }

  const isRelocation = rows.some((r) => r.to_wh);
  const title = !h ? "ບໍ່ພົບເອກະສານ" : isRelocation ? "ໃບໂອນ / ຮັບໂອນ ສິນຄ້າ (WMS)" : "ໃບຈ່າຍສິນຄ້າ (WMS Pick Slip)";
  // A receive doc's −1 leg sits AT 9903 (goods leaving in-transit) — so its
  // sn_trans_detail units carry the DESTINATION landing node, not a source one.
  // An issue-out / transfer-out doc's units carry the real SOURCE node.
  const isReceiveDoc = rows.some((r) => r.from_wh === IN_TRANSIT_WH);

  type PrintRow = {
    key: string; item_code: string; item_name: string | null; unit_code: string | null;
    sn: string | null; isn: string | null; loc_from: string; loc_to: string; qty: number;
  };
  const printRows: PrintRow[] = [];
  for (const r of rows) {
    const us = unitsByItem.get(r.item_code) ?? [];
    if (us.length > 0) {
      for (const u of us) {
        const uloc = unitLoc(u);
        printRows.push({
          key: `${r.item_code}-${u.sn ?? u.isn ?? printRows.length}`,
          item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
          sn: u.sn, isn: u.isn,
          loc_from: isReceiveDoc ? (r.from_loc ?? "—") : uloc,
          loc_to: isReceiveDoc ? uloc : (r.to_loc ?? "—"),
          qty: 1,
        });
      }
    } else {
      printRows.push({
        key: r.item_code, item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
        sn: null, isn: null, loc_from: r.from_loc ?? "—", loc_to: r.to_loc ?? "—",
        qty: Number.parseFloat(r.qty || "0"),
      });
    }
  }

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-5 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif" }}>
      <style>{`@media print { .no-print { display:none !important } @page { size: A4; margin: 8mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບເອກະສານ {docNo}</p>
      ) : (
        <>
          <div className="mb-1 text-center text-lg font-black">ODIEN GROUP</div>
          <div className="mb-3 text-center text-base font-bold">{title}</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ເລກທີ່:</b> <span className="font-mono">{h.doc_no}</span></div>
            <div><b>ວັນທີ່:</b> {h.doc_date} {h.doc_time}</div>
            <div><b>ສາງ:</b> {whLabel(h.wh_code, h.wh_name)}</div>
            <div><b>ອ້າງອີງ:</b> {h.doc_ref ?? "—"}</div>
            <div><b>ຜູ້ດຳເນີນ:</b> {h.user_created ?? "—"}</div>
          </div>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col className="w-[4%]" /><col className="w-[16%]" /><col className="w-[13%]" />
              <col className="w-[15%]" /><col className="w-[19%]" />
              {isRelocation && <col className="w-[15%]" />}
              <col className={isRelocation ? "w-[8%]" : "w-[16%]"} /><col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-1.5 py-1">#</th>
                <th className="border border-slate-300 px-1.5 py-1">SN</th>
                <th className="border border-slate-300 px-1.5 py-1">Internal SN</th>
                <th className="border border-slate-300 px-1.5 py-1">ລະຫັດສິນຄ້າ</th>
                <th className="border border-slate-300 px-1.5 py-1">ຊື່</th>
                {isRelocation ? (
                  <>
                    <th className="border border-slate-300 px-1.5 py-1">ຈາກ</th>
                    <th className="border border-slate-300 px-1.5 py-1">ໄປ</th>
                  </>
                ) : (
                  <th className="border border-slate-300 px-1.5 py-1">ບ່ອນເກັບ</th>
                )}
                <th className="border border-slate-300 px-1.5 py-1 text-right">ຈຳນວນ</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((r, i) => (
                <tr key={r.key} className="align-top">
                  <td className="border border-slate-300 px-1.5 py-1 text-center">{i + 1}</td>
                  <td className="border border-slate-300 px-1.5 py-1 truncate font-mono">{r.sn ?? "—"}</td>
                  <td className="border border-slate-300 px-1.5 py-1 truncate font-mono">{r.isn ?? "—"}</td>
                  <td className="border border-slate-300 px-1.5 py-1 truncate font-mono font-bold">{r.item_code}</td>
                  <td className="border border-slate-300 px-1.5 py-1 truncate">{r.item_name}</td>
                  {isRelocation ? (
                    <>
                      <td className="border border-slate-300 px-1.5 py-1 truncate">{r.loc_from}</td>
                      <td className="border border-slate-300 px-1.5 py-1 truncate">{r.loc_to}</td>
                    </>
                  ) : (
                    <td className="border border-slate-300 px-1.5 py-1 truncate">{r.loc_from}</td>
                  )}
                  <td className="border border-slate-300 px-1.5 py-1 text-right font-mono">{r.qty} {r.unit_code ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {notes.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
              <div className="mb-1 font-bold text-amber-800">ໝາຍເຫດ — ຮັບ/ຈ່າຍ ບໍ່ຄົບ</div>
              <ul className="list-disc pl-5">
                {notes.map((n, i) => (
                  <li key={i}><span className="font-mono">{n.item_code}</span> — {REASON_LABEL[n.reason_code ?? ""] ?? n.reason_code}{n.short_qty ? ` (ຂາດ ${Number.parseFloat(n.short_qty)})` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 grid grid-cols-3 gap-6 text-center text-xs">
            {["ຜູ້ຈ່າຍ / ຜູ້ໂອນ", "ຜູ້ຮັບ", "ຜູ້ກວດສອບ"].map((s) => (
              <div key={s}>
                <div className="mb-8 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[9px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
