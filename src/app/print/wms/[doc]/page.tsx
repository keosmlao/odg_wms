import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { MOVE_REASONS } from "@/lib/moveReasons";
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

  const serials = h ? await query<{ item_code: string; sn: string | null; isn: string | null }>(
    `SELECT item_code, sn, isn FROM public.sn_trans_detail WHERE doc_no = $1 ORDER BY item_code`,
    [docNo],
  ) : [];
  const snByItem = new Map<string, string[]>();
  for (const s of serials) {
    const id = (s.sn && s.sn.trim()) || s.isn || "";
    if (!id) continue;
    const a = snByItem.get(s.item_code) ?? []; a.push(id); snByItem.set(s.item_code, a);
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

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif" }}>
      <style>{`@media print { .no-print { display:none !important } @page { margin: 14mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {!h ? (
        <p className="text-center text-rose-600">ບໍ່ພົບເອກະສານ {docNo}</p>
      ) : (
        <>
          <div className="mb-1 text-center text-lg font-black">ODIEN GROUP</div>
          <div className="mb-4 text-center text-base font-bold">{title}</div>

          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><b>ເລກທີ່:</b> <span className="font-mono">{h.doc_no}</span></div>
            <div><b>ວັນທີ່:</b> {h.doc_date} {h.doc_time}</div>
            <div><b>ສາງ:</b> {whLabel(h.wh_code, h.wh_name)}</div>
            <div><b>ອ້າງອີງ:</b> {h.doc_ref ?? "—"}</div>
            <div><b>ຜູ້ດຳເນີນ:</b> {h.user_created ?? "—"}</div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-2 py-1 w-8">#</th>
                <th className="border border-slate-300 px-2 py-1">ສິນຄ້າ</th>
                <th className="border border-slate-300 px-2 py-1">ຈາກ</th>
                {isRelocation && <th className="border border-slate-300 px-2 py-1">ໄປ</th>}
                <th className="border border-slate-300 px-2 py-1 text-right w-20">ຈຳນວນ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sns = snByItem.get(r.item_code) ?? [];
                return (
                  <tr key={r.item_code} className="align-top">
                    <td className="border border-slate-300 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-slate-300 px-2 py-1">
                      <div className="font-mono text-xs font-bold">{r.item_code}</div>
                      <div>{r.item_name}</div>
                      {sns.length > 0 && <div className="mt-0.5 text-[10px] text-slate-500">SN: {sns.join(", ")}</div>}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-xs">{whLabel(r.from_wh, null)}<br />{r.from_loc ?? ""}</td>
                    {isRelocation && <td className="border border-slate-300 px-2 py-1 text-xs">{whLabel(r.to_wh, null)}<br />{r.to_loc ?? ""}</td>}
                    <td className="border border-slate-300 px-2 py-1 text-right font-mono">{Number.parseFloat(r.qty || "0")} {r.unit_code ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {notes.length > 0 && (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <div className="mb-1 font-bold text-amber-800">ໝາຍເຫດ — ຮັບ/ຈ່າຍ ບໍ່ຄົບ</div>
              <ul className="list-disc pl-5">
                {notes.map((n, i) => (
                  <li key={i}><span className="font-mono text-xs">{n.item_code}</span> — {REASON_LABEL[n.reason_code ?? ""] ?? n.reason_code}{n.short_qty ? ` (ຂາດ ${Number.parseFloat(n.short_qty)})` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-12 grid grid-cols-3 gap-6 text-center text-sm">
            {["ຜູ້ຈ່າຍ / ຜູ້ໂອນ", "ຜູ້ຮັບ", "ຜູ້ກວດສອບ"].map((s) => (
              <div key={s}>
                <div className="mb-10 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[10px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
