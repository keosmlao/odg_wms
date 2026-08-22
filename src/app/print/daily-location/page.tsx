import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import PrintLetterhead from "@/components/PrintLetterhead";
import AutoPrint from "../wms/[doc]/AutoPrint";
import { locTotals, locationFlow, type LocRow } from "@/lib/locationMovement";

/**
 * ລາຍງານເຄື່ອນໄຫວປະຈຳວັນ ຕາມບ່ອນເກັບ ເປັນເອກະສານ A4 ພ້ອມຊ່ອງເຊັນ.
 *
 * Query: ?wh=&from=&to=&idle=1&auto=1
 */
const MAX_DAYS = 92;

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function PrintDailyLocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const wh = sp.wh?.trim() ?? "";
  const today = new Date().toISOString().slice(0, 10);
  let to = sp.to?.trim() || today;
  let from = sp.from?.trim() || to;
  if (from > to) [from, to] = [to, from];
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));
  const includeIdle = sp.idle === "1";

  const accessible = accessibleWarehouses(session);
  const denied =
    !session.role ? "ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
    : !wh ? "ກະລຸນາລະບຸສາງ"
    : Array.isArray(accessible) && !accessible.includes(wh) ? "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
    : null;

  const rows: LocRow[] = denied ? [] : await locationFlow({ wh, from, to, includeIdle });
  const totals = locTotals(rows);
  const whRow = wh
    ? (await query<{ name: string | null }>(`SELECT name_1 AS name FROM public.ic_warehouse WHERE code = $1`, [wh]))[0]
    : undefined;

  // ຈັດເປັນກຸ່ມຕາມຊັ້ນວາງ ໃຫ້ອ່ານງ່າຍຄືກັນກັບໜ້າຈໍ.
  const groups = new Map<string, { rack: string; rack_name: string | null; rows: LocRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.rack);
    if (g) g.rows.push(r);
    else groups.set(r.rack, { rack: r.rack, rack_name: r.rack_name, rows: [r] });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const reportRef = `DML-${wh || "----"}-${to.replace(/-/g, "")}`;
  const printedBy = session.fullname_lo?.trim() || session.nickname?.trim() || session.employee_code || "—";
  const th = "border border-slate-300 px-1.5 py-1";

  return (
    <div className="mx-auto flex max-w-[190mm] flex-col bg-white p-5 text-slate-900" style={{ fontFamily: "'Noto Sans Lao', sans-serif", minHeight: "100vh" }}>
      <style>{`@media print { .no-print { display:none !important } @page { size: A4; margin: 8mm } thead { display: table-header-group } tr { break-inside: avoid } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {denied ? (
        <p className="text-center text-rose-600">{denied}</p>
      ) : (
        <div className="flex flex-1 flex-col">
          <PrintLetterhead docNo={reportRef} />

          <div className="mb-1 text-center text-base font-bold">ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ ຕາມບ່ອນເກັບ</div>
          <div className="mb-3 text-center text-[11px] text-slate-500">ຍອດຍົກມາ · ຮັບເຂົ້າ · ຈ່າຍອອກ · ຄົງເຫຼືອ</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ສາງ:</b> {wh}{whRow?.name ? ` ${whRow.name}` : ""}</div>
            <div><b>ວັນທີ່ພິມ:</b> {`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`}</div>
            <div><b>ຊ່ວງລາຍງານ:</b> {fmtDate(from)} — {fmtDate(to)}</div>
            <div><b>ຜູ້ພິມ:</b> {printedBy}</div>
            <div className="col-span-2"><b>ບ່ອນເກັບ:</b> {rows.length} ບ່ອນ / {groups.size} ຊັ້ນວາງ {includeIdle ? "(ລວມບ່ອນທີ່ບໍ່ເຄື່ອນໄຫວ)" : "(ສະເພາະທີ່ເຄື່ອນໄຫວ)"}</div>
          </div>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col className="w-[34%]" /><col className="w-[15%]" /><col className="w-[15%]" />
              <col className="w-[15%]" /><col className="w-[15%]" /><col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className={th}>ບ່ອນເກັບ</th>
                <th className={`${th} text-right`}>ຍອດຍົກມາ</th>
                <th className={`${th} text-right`}>ຮັບເຂົ້າ</th>
                <th className={`${th} text-right`}>ຈ່າຍອອກ</th>
                <th className={`${th} text-right`}>ຄົງເຫຼືອ</th>
                <th className={`${th} text-right`}>ລາຍການ</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.values()].map((g) => [
                <tr key={`r-${g.rack}`} className="bg-slate-50 font-bold">
                  <td className={th}>
                    {g.rack || "ບໍ່ລະບຸຊັ້ນວາງ"}{g.rack_name ? ` — ${g.rack_name}` : ""}
                  </td>
                  <td className={`${th} text-right font-mono`}>{fmt(g.rows.reduce((s, r) => s + r.opening, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(g.rows.reduce((s, r) => s + r.qty_in, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(g.rows.reduce((s, r) => s + r.qty_out, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(g.rows.reduce((s, r) => s + r.closing, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{g.rows.length}</td>
                </tr>,
                ...g.rows.map((r) => (
                  <tr key={`${g.rack}|${r.loc}`}>
                    <td className={`${th} pl-4`}>{r.loc || "ບໍ່ລະບຸບ່ອນເກັບ"}{r.loc_name ? ` — ${r.loc_name}` : ""}</td>
                    <td className={`${th} text-right font-mono`}>{fmt(r.opening)}</td>
                    <td className={`${th} text-right font-mono`}>{r.qty_in ? fmt(r.qty_in) : "—"}</td>
                    <td className={`${th} text-right font-mono`}>{r.qty_out ? fmt(r.qty_out) : "—"}</td>
                    <td className={`${th} text-right font-mono font-bold ${r.closing < 0 ? "text-red-600" : ""}`}>{fmt(r.closing)}</td>
                    <td className={`${th} text-right font-mono`}>{r.items || "—"}</td>
                  </tr>
                )),
              ])}
              <tr className="bg-slate-50 font-bold">
                <td className={th}>ລວມ</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.opening)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.qty_in)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.qty_out)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.closing)}</td>
                <td className={`${th} text-right font-mono`}>{totals.locations}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-2 text-[9px] text-slate-500">
            ⓘ ຄົງເຫຼືອ = ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ (ຕໍ່ບ່ອນເກັບ) · ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງນຳ
            (ຮັບເຂົ້າຈາກການຍ້າຍ {fmt(totals.move_in)} · ຈ່າຍອອກຈາກການຍ້າຍ {fmt(totals.move_out)})
          </p>

          <div className="mt-auto grid grid-cols-3 gap-10 pt-10 text-center text-xs" style={{ breakInside: "avoid" }}>
            {["ຜູ້ຈັດທຳ", "ຫົວໜ້າສາງ", "ຜູ້ອະນຸມັດ"].map((s) => (
              <div key={s}>
                <div className="mb-10 border-b border-slate-400" />
                <div>{s}</div>
                <div className="text-[9px] text-slate-400">ວັນທີ່ ......./......./.......</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
