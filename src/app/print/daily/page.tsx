import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import PrintLetterhead from "@/components/PrintLetterhead";
import AutoPrint from "../wms/[doc]/AutoPrint";
import { flagsFromParam, PENDING_OUT_TYPES } from "@/lib/pendingOut";
import { billFlow, dailyStock, docLifecycle } from "@/lib/dailyMovement";

/**
 * ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ as a printable A4 document — both the stock card and
 * the bill flow, whichever the ?view= says, with the signature block the warehouse
 * files at day end.
 *
 * Query: ?wh=&from=&to=&type=&view=stock|bills&auto=1
 */
const MAX_DAYS = 92;
const CARRY_LOOKBACK_DAYS = 180;

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

export default async function PrintDailyPage({
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
  let from = sp.from?.trim() || shift(to, -6);
  if (from > to) [from, to] = [to, from];
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));
  const flags = flagsFromParam(sp.type ?? null);
  const view = sp.view === "bills" ? "bills" : "stock";

  const accessible = accessibleWarehouses(session);
  const denied =
    !session.role ? "ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
    : !wh ? "ກະລຸນາລະບຸສາງ"
    : Array.isArray(accessible) && !accessible.includes(wh) ? "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
    : null;

  const filter = { wh, from, to, flags };
  const stock = denied ? [] : await dailyStock(filter);
  const docs = denied ? [] : await docLifecycle(filter, CARRY_LOOKBACK_DAYS);
  const bills = denied ? [] : billFlow(docs, from, to);
  const whRow = wh
    ? (await query<{ name: string | null }>(`SELECT name_1 AS name FROM public.ic_warehouse WHERE code = $1`, [wh]))[0]
    : undefined;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const reportRef = `DM-${wh || "----"}-${to.replace(/-/g, "")}`;
  const printedBy = session.fullname_lo?.trim() || session.nickname?.trim() || session.employee_code || "—";
  const typeLabels = PENDING_OUT_TYPES.filter((t) => flags.includes(t.flag)).map((t) => t.label).join(", ");
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

          <div className="mb-1 text-center text-base font-bold">ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ</div>
          <div className="mb-3 text-center text-[11px] text-slate-500">
            {view === "stock" ? "ຈຳນວນສິນຄ້າ — ຍອດຍົກມາ · ເປີດບິນ · ຮັບເຂົ້າ · ຈ່າຍອອກ · ຍົກໄປ" : "ຈຳນວນໃບ — ຄ້າງຍົກມາ · ເປີດບິນ · ຈ່າຍຄົບ · ຄ້າງຍົກໄປ"}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ສາງ:</b> {wh}{whRow?.name ? ` ${whRow.name}` : ""}</div>
            <div><b>ວັນທີ່ພິມ:</b> {`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`}</div>
            <div><b>ຊ່ວງລາຍງານ:</b> {fmtDate(from)} — {fmtDate(to)}</div>
            <div><b>ຜູ້ພິມ:</b> {printedBy}</div>
            <div className="col-span-2"><b>ປະເພດເອກະສານ:</b> {typeLabels}</div>
          </div>

          {view === "stock" ? (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <colgroup>
                <col className="w-[16%]" /><col className="w-[17%]" /><col className="w-[17%]" />
                <col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className={th}>ວັນທີ່</th>
                  <th className={`${th} text-right`}>ຍອດຍົກມາ</th>
                  <th className={`${th} text-right`}>ເປີດບິນ (ໃບ)</th>
                  <th className={`${th} text-right`}>ຮັບເຂົ້າ</th>
                  <th className={`${th} text-right`}>ຈ່າຍອອກ</th>
                  <th className={`${th} text-right`}>ຍົກໄປ</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((d) => (
                  <tr key={d.date}>
                    <td className={`${th} font-mono`}>{fmtDate(d.date)}</td>
                    <td className={`${th} text-right font-mono`}>{fmt(d.opening)}</td>
                    <td className={`${th} text-right font-mono`}>{fmt(d.bill_qty)}{d.bill_docs ? ` (${d.bill_docs})` : ""}</td>
                    <td className={`${th} text-right font-mono`}>{d.qty_in ? fmt(d.qty_in) : "—"}</td>
                    <td className={`${th} text-right font-mono`}>{d.qty_out ? fmt(d.qty_out) : "—"}</td>
                    <td className={`${th} text-right font-mono font-bold`}>{fmt(d.closing)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className={th}>ລວມ</td>
                  <td className={`${th} text-right font-mono`}>{fmt(stock[0]?.opening ?? 0)}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(stock.reduce((s, d) => s + d.bill_qty, 0))} ({stock.reduce((s, d) => s + d.bill_docs, 0)})</td>
                  <td className={`${th} text-right font-mono`}>{fmt(stock.reduce((s, d) => s + d.qty_in, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(stock.reduce((s, d) => s + d.qty_out, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(stock[stock.length - 1]?.closing ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <colgroup>
                <col className="w-[20%]" /><col className="w-[20%]" /><col className="w-[20%]" />
                <col className="w-[20%]" /><col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className={th}>ວັນທີ່</th>
                  <th className={`${th} text-right`}>ໃບຄ້າງຍົກມາ</th>
                  <th className={`${th} text-right`}>ເປີດບິນ</th>
                  <th className={`${th} text-right`}>ຈ່າຍຄົບ</th>
                  <th className={`${th} text-right`}>ຄ້າງຍົກໄປ</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((d) => (
                  <tr key={d.date}>
                    <td className={`${th} font-mono`}>{fmtDate(d.date)}</td>
                    <td className={`${th} text-right font-mono`}>{d.carry_in}</td>
                    <td className={`${th} text-right font-mono`}>{d.opened}</td>
                    <td className={`${th} text-right font-mono`}>{d.closed}</td>
                    <td className={`${th} text-right font-mono font-bold ${d.carry_out > d.carry_in ? "text-red-600" : ""}`}>{d.carry_out}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className={th}>ລວມ</td>
                  <td className={`${th} text-right font-mono`}>{bills[0]?.carry_in ?? 0}</td>
                  <td className={`${th} text-right font-mono`}>{bills.reduce((s, d) => s + d.opened, 0)}</td>
                  <td className={`${th} text-right font-mono`}>{bills.reduce((s, d) => s + d.closed, 0)}</td>
                  <td className={`${th} text-right font-mono`}>{bills[bills.length - 1]?.carry_out ?? 0}</td>
                </tr>
              </tbody>
            </table>
          )}

          <p className="mt-2 text-[9px] text-slate-500">
            ⓘ ຍົກໄປ = ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ · ບໍ່ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງ ·
            ຄ້າງຍົກໄປ = ຄ້າງຍົກມາ + ເປີດບິນ − ຈ່າຍຄົບ · ບໍ່ນັບບໍລິການ ແລະ ບິນຮັບຄືນ/ຍົກເລີກ
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
