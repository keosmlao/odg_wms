import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import PrintLetterhead from "@/components/PrintLetterhead";
import AutoPrint from "../wms/[doc]/AutoPrint";
import {
  filterRows, isMonth, monthLabel, monthRange, monthTotals, monthlyItems, type MonthItemRow,
} from "@/lib/monthlyMovement";

/**
 * ລາຍງານເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ ເປັນເອກະສານ A4 ພ້ອມຊ່ອງເຊັນ.
 *
 * Query: ?wh=&month=YYYY-MM&idle=1&q=&brand=&auto=1
 */
function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export default async function PrintMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const wh = sp.wh?.trim() ?? "";
  const month = sp.month?.trim() || new Date().toISOString().slice(0, 7);
  const includeIdle = sp.idle === "1";
  const q = sp.q ?? "";
  const brand = sp.brand ?? "";

  const accessible = accessibleWarehouses(session);
  const denied =
    !session.role ? "ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
    : !wh ? "ກະລຸນາລະບຸສາງ"
    : !isMonth(month) ? "ເດືອນບໍ່ຖືກຕ້ອງ"
    : Array.isArray(accessible) && !accessible.includes(wh) ? "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
    : null;

  const rows: MonthItemRow[] = denied ? [] : filterRows(await monthlyItems({ wh, month, includeIdle }), q, brand);
  const totals = monthTotals(rows);
  const { from, to } = isMonth(month) ? monthRange(month) : { from: "", to: "" };
  const whRow = wh
    ? (await query<{ name: string | null }>(`SELECT name_1 AS name FROM public.ic_warehouse WHERE code = $1`, [wh]))[0]
    : undefined;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const reportRef = `MIM-${wh || "----"}-${month.replace("-", "")}`;
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

          <div className="mb-1 text-center text-base font-bold">ລາຍງານການເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ</div>
          <div className="mb-3 text-center text-[11px] text-slate-500">ຍອດຍົກມາ · ເຂົ້າ · ອອກ · ຄົງເຫຼືອ</div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ສາງ:</b> {wh}{whRow?.name ? ` ${whRow.name}` : ""}</div>
            <div><b>ວັນທີ່ພິມ:</b> {`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`}</div>
            <div><b>ເດືອນ:</b> {monthLabel(month)} ({fmtDate(from)} — {fmtDate(to)})</div>
            <div><b>ຜູ້ພິມ:</b> {printedBy}</div>
            <div className="col-span-2">
              <b>ລາຍການ:</b> {rows.length} ລາຍການ {includeIdle ? "(ລວມສິນຄ້າທີ່ບໍ່ເຄື່ອນໄຫວ)" : "(ສະເພາະທີ່ເຄື່ອນໄຫວ)"}
              {brand ? ` · ຍີ່ຫໍ້: ${brand}` : ""}{q ? ` · ຄົ້ນຫາ: ${q}` : ""}
            </div>
          </div>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
              <col className="w-[13%]" /><col className="w-[31%]" /><col className="w-[12%]" /><col className="w-[8%]" />
              <col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className={th}>ລະຫັດສິນຄ້າ</th>
                <th className={th}>ຊື່ສິນຄ້າ</th>
                <th className={th}>ຍີ່ຫໍ້</th>
                <th className={th}>ຫົວໜ່ວຍ</th>
                <th className={`${th} text-right`}>ຍອດຍົກມາ</th>
                <th className={`${th} text-right`}>ເຂົ້າ</th>
                <th className={`${th} text-right`}>ອອກ</th>
                <th className={`${th} text-right`}>ຄົງເຫຼືອ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_code}>
                  <td className={`${th} font-mono`}>{r.item_code}</td>
                  <td className={th}>{r.item_name ?? "—"}</td>
                  <td className={th}>{r.brand ?? "—"}</td>
                  <td className={th}>{r.unit_code ?? "—"}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(r.opening)}</td>
                  <td className={`${th} text-right font-mono`}>{r.qty_in ? fmt(r.qty_in) : "—"}</td>
                  <td className={`${th} text-right font-mono`}>{r.qty_out ? fmt(r.qty_out) : "—"}</td>
                  <td className={`${th} text-right font-mono font-bold ${r.closing < 0 ? "text-red-600" : ""}`}>{fmt(r.closing)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className={`${th} text-center text-slate-400`} colSpan={8}>ບໍ່ມີການເຄື່ອນໄຫວໃນເດືອນນີ້</td></tr>
              )}
              <tr className="bg-slate-50 font-bold">
                <td className={th}>ລວມ</td>
                <td className={th}>{totals.items} ລາຍການ</td>
                <td className={th} />
                <td className={th} />
                <td className={`${th} text-right font-mono`}>{fmt(totals.opening)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.qty_in)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.qty_out)}</td>
                <td className={`${th} text-right font-mono`}>{fmt(totals.closing)}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-2 text-[9px] text-slate-500">
            ⓘ ຄົງເຫຼືອ = ຍອດຍົກມາ + ເຂົ້າ − ອອກ (ຕໍ່ສິນຄ້າ ໃນສາງນີ້) · ບໍ່ນັບການຍ້າຍບ່ອນເກັບພາຍໃນສາງ
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
