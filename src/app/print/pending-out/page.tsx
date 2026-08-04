import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import PrintLetterhead from "@/components/PrintLetterhead";
import AutoPrint from "../wms/[doc]/AutoPrint";
import {
  AGING_BUCKETS,
  PENDING_OUT_TYPES,
  bucketOf,
  flagsFromParam,
  formatWait,
  groupByDoc,
  groupByItem,
  itemStockOnHand,
  pendingOutLines,
} from "@/lib/pendingOut";

/**
 * ລາຍງານສິນຄ້າຄ້າງຈ່າຍອອກສາງ as a printable A4 document — the same figures as
 * /movements/pending-out, laid out as a signed report rather than a screen.
 *
 * Query: ?wh=&days=&type=&view=docs|items&q=&bucket=&auto=1
 * The q / bucket params mirror the on-screen filters so the printed document
 * matches exactly what the user was looking at when they pressed ພິມ.
 */
const MAX_PRINT_ROWS = 1000;
/** ຄ້າງເກີນ 5 ມື້ = ຊ້າເກີນໄປ — ພິມເປັນສີແດງ ພ້ອມເຄື່ອງໝາຍ ▲ (ພິມຂາວດຳກໍ່ຍັງເຫັນ). */
const ALERT_SECONDS = 5 * 86400;

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function fmtStamp(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : fmtDate(s);
}

export default async function PrintPendingOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const wh = sp.wh?.trim() ?? "";
  const days = Math.min(Math.max(Number.parseInt(sp.days ?? "30", 10) || 30, 1), 1095);
  const flags = flagsFromParam(sp.type ?? null);
  const view = sp.view === "items" ? "items" : "docs";
  const q = (sp.q ?? "").trim().toLowerCase();
  const bucket = sp.bucket?.trim() || null;

  const accessible = accessibleWarehouses(session);
  const denied =
    !session.role
      ? "ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      : !wh
        ? "ກະລຸນາລະບຸສາງ"
        : Array.isArray(accessible) && !accessible.includes(wh)
          ? "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
          : null;

  const lines = denied ? [] : await pendingOutLines({ wh, flags, days });
  const onHand = denied ? new Map<string, number>() : await itemStockOnHand(wh, [...new Set(lines.map((l) => l.item_code))]);

  const whRow = wh
    ? (await query<{ name: string | null }>(`SELECT name_1 AS name FROM public.ic_warehouse WHERE code = $1`, [wh]))[0]
    : undefined;

  // Same filtering the screen applies, so the document matches the view it came from.
  const allDocs = groupByDoc(lines);
  const linesByDoc = new Map<string, typeof lines>();
  for (const l of lines) {
    const k = `${l.doc_no}|${l.trans_flag}|${l.wh_code}`;
    const arr = linesByDoc.get(k);
    if (arr) arr.push(l);
    else linesByDoc.set(k, [l]);
  }
  const docs = allDocs.filter((d) => {
    if (bucket && bucketOf(d.aging_days) !== bucket) return false;
    if (!q) return true;
    if (
      d.doc_no.toLowerCase().includes(q) ||
      (d.cust_name ?? "").toLowerCase().includes(q) ||
      (d.cust_code ?? "").toLowerCase().includes(q)
    ) return true;
    return (linesByDoc.get(`${d.doc_no}|${d.trans_flag}|${d.wh_code}`) ?? []).some(
      (l) => l.item_code.toLowerCase().includes(q) || (l.item_name ?? "").toLowerCase().includes(q),
    );
  });
  const items = groupByItem(lines, onHand).filter((it) => {
    if (bucket && bucketOf(it.oldest_days) !== bucket) return false;
    if (!q) return true;
    return it.item_code.toLowerCase().includes(q) || (it.item_name ?? "").toLowerCase().includes(q);
  });

  const rowCount = view === "docs" ? docs.length : items.length;
  const shownDocs = docs.slice(0, MAX_PRINT_ROWS);
  const shownItems = items.slice(0, MAX_PRINT_ROWS);
  const truncated = rowCount > MAX_PRINT_ROWS;

  const totalRemaining = (view === "docs" ? docs : items).reduce((s, r) => s + r.remaining, 0);
  const totalShortfall = items.reduce((s, i) => s + i.shortfall, 0);
  const oldest = docs.reduce((m, d) => Math.max(m, d.aging_days), 0);
  const alertDocs = docs.filter((d) => d.aging_seconds >= ALERT_SECONDS).length;
  const typeLabels = PENDING_OUT_TYPES.filter((t) => flags.includes(t.flag)).map((t) => t.label).join(", ");
  const bucketLabel = bucket ? (AGING_BUCKETS.find((b) => b.id === bucket)?.label ?? bucket) : null;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const reportRef = `PO-${wh || "----"}-${stamp}`;
  const printedBy = session.fullname_lo?.trim() || session.nickname?.trim() || session.employee_code || "—";

  const th = "border border-slate-300 px-1.5 py-1";

  return (
    <div
      className="mx-auto flex max-w-[190mm] flex-col bg-white p-5 text-slate-900"
      style={{ fontFamily: "'Noto Sans Lao', sans-serif", minHeight: "100vh" }}
    >
      {/* print-color-adjust: ຮັກສາສີແດງຂອງລາຍການຄ້າງເກີນ 5 ມື້ ຕອນພິມ */}
      <style>{`@media print { .no-print { display:none !important } @page { size: A4 landscape; margin: 8mm } thead { display: table-header-group } tr { break-inside: avoid } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      {denied ? (
        <p className="text-center text-rose-600">{denied}</p>
      ) : (
        <div className="flex flex-1 flex-col">
          <PrintLetterhead docNo={reportRef} />

          <div className="mb-1 text-center text-base font-bold">ລາຍງານສິນຄ້າຄ້າງຈ່າຍອອກສາງ</div>
          <div className="mb-3 text-center text-[11px] text-slate-500">
            {view === "docs" ? "ຕາມໃບເອກະສານ" : "ຕາມສິນຄ້າ"}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
            <div><b>ສາງ:</b> {wh}{whRow?.name ? ` ${whRow.name}` : ""}</div>
            <div><b>ວັນທີ່ພິມ:</b> {`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`}</div>
            <div><b>ຊ່ວງເອກະສານ:</b> ຍ້ອນຫຼັງ {days} ມື້</div>
            <div><b>ຜູ້ພິມ:</b> {printedBy}</div>
            <div><b>ປະເພດເອກະສານ:</b> {typeLabels}</div>
            <div><b>ໄລຍະຄ້າງ:</b> {bucketLabel ?? "ທັງໝົດ"}</div>
            {q && <div className="col-span-2"><b>ຄຳຄົ້ນຫາ:</b> {sp.q}</div>}
          </div>

          {/* ສະຫຼຸບ */}
          <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
            <div className="border border-slate-300 px-2 py-1.5">
              <div className="text-[10px] text-slate-500">ໃບຄ້າງຈ່າຍ</div>
              <div className="font-mono text-sm font-bold">{fmt(docs.length)}</div>
            </div>
            <div className="border border-slate-300 px-2 py-1.5">
              <div className="text-[10px] text-slate-500">ລະຫັດສິນຄ້າ</div>
              <div className="font-mono text-sm font-bold">{fmt(items.length)}</div>
            </div>
            <div className="border border-slate-300 px-2 py-1.5">
              <div className="text-[10px] text-slate-500">ຈຳນວນຄ້າງຈ່າຍ</div>
              <div className="font-mono text-sm font-bold">{fmt(view === "docs" ? docs.reduce((s, d) => s + d.remaining, 0) : totalRemaining)}</div>
            </div>
            <div className="border border-slate-300 px-2 py-1.5">
              <div className="text-[10px] text-slate-500">ຄ້າງເກີນ 5 ມື້ (ໃບ)</div>
              <div className={`font-mono text-sm font-bold ${alertDocs > 0 ? "text-red-600" : ""}`}>
                {fmt(alertDocs)} <span className="text-[10px] font-normal text-slate-500">/ ດົນສຸດ {fmt(oldest)} ມື້</span>
              </div>
            </div>
          </div>

          {/* ສະຫຼຸບຕາມໄລຍະເວລາທີ່ຄ້າງ — ນັບຈາກວັນທີ່ໃບຮອດມື້ນີ້ */}
          {rowCount > 0 && (
            <table className="mb-3 w-full table-fixed border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className={th}>ໄລຍະເວລາທີ່ຄ້າງ</th>
                  {AGING_BUCKETS.map((b) => (<th key={b.id} className={`${th} text-right`}>{b.label}</th>))}
                  <th className={`${th} text-right`}>ລວມ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={th}>ຈຳນວນໃບ</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b.id} className={`${th} text-right font-mono`}>{fmt(docs.filter((d) => bucketOf(d.aging_days) === b.id).length)}</td>
                  ))}
                  <td className={`${th} text-right font-mono font-bold`}>{fmt(docs.length)}</td>
                </tr>
                <tr>
                  <td className={th}>ຈຳນວນຄ້າງຈ່າຍ</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b.id} className={`${th} text-right font-mono`}>
                      {fmt(docs.filter((d) => bucketOf(d.aging_days) === b.id).reduce((s, d) => s + d.remaining, 0))}
                    </td>
                  ))}
                  <td className={`${th} text-right font-mono font-bold`}>{fmt(docs.reduce((s, d) => s + d.remaining, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}

          {rowCount === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">ບໍ່ມີລາຍການຄ້າງຈ່າຍ</p>
          ) : view === "docs" ? (
            <table className="w-full table-fixed border-collapse text-[10px]">
              <colgroup>
                <col className="w-[3%]" /><col className="w-[6%]" /><col className="w-[12%]" />
                <col className="w-[15%]" /><col className="w-[18%]" /><col className="w-[11%]" /><col className="w-[5%]" />
                <col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className={th}>#</th>
                  <th className={th}>ປະເພດ</th>
                  <th className={th}>ເລກທີ່ໃບ</th>
                  <th className={th}>ວັນທີ່ / ຄ້າງມາແລ້ວ</th>
                  <th className={th}>ລູກຄ້າ / ປາຍທາງ</th>
                  <th className={th}>ຂົນສົ່ງ</th>
                  <th className={`${th} text-right`}>ລາຍການ</th>
                  <th className={`${th} text-right`}>ສັ່ງ</th>
                  <th className={`${th} text-right`}>ຈ່າຍແລ້ວ</th>
                  <th className={`${th} text-right`}>ຄ້າງຈ່າຍ</th>
                  <th className={th}>ໄລຍະ</th>
                </tr>
              </thead>
              <tbody>
                {shownDocs.map((d, i) => {
                  // ເກີນວັນທີ່ຕ້ອງການແລ້ວ — ໝາຍດາວໄວ້ໃຫ້ເຫັນທັນທີ
                  const overdue = d.want_date ? new Date(d.want_date) < now : false;
                  return (
                    <tr key={`${d.doc_no}|${d.trans_flag}|${d.wh_code}`}>
                      <td className={`${th} text-center`}>{i + 1}</td>
                      <td className={th}>{d.type_label}</td>
                      <td className={`${th} font-mono font-bold`} style={{ overflowWrap: "anywhere" }}>{d.doc_no}</td>
                      <td className={`${th} font-mono leading-tight`}>
                        <div>{fmtStamp(d.doc_ts) === "—" ? fmtDate(d.doc_date) : fmtStamp(d.doc_ts)}</div>
                        <div className={d.aging_seconds >= ALERT_SECONDS ? "font-bold text-red-600" : "font-bold"}>
                          {d.aging_seconds >= ALERT_SECONDS ? "▲ " : ""}ຄ້າງ {formatWait(d.aging_seconds)}
                        </div>
                        {d.want_date && <div className="text-slate-500">ຕ້ອງການ {fmtDate(d.want_date)}{overdue ? " *" : ""}</div>}
                      </td>
                      <td className={`${th} align-top leading-tight`} style={{ overflowWrap: "anywhere" }}>
                        {d.cust_name ?? d.cust_code ?? "—"}
                        {d.note && <div className="font-bold">[{d.note}]</div>}
                      </td>
                      <td className={`${th} align-top leading-tight`} style={{ overflowWrap: "anywhere" }}>{d.transport_name ?? "—"}</td>
                      <td className={`${th} text-right font-mono`}>{d.lines}</td>
                      <td className={`${th} text-right font-mono`}>{fmt(d.ordered)}</td>
                      <td className={`${th} text-right font-mono`}>{fmt(d.issued)}</td>
                      <td className={`${th} text-right font-mono font-bold`}>{fmt(d.remaining)}</td>
                      <td className={th}>{AGING_BUCKETS.find((b) => b.id === bucketOf(d.aging_days))?.label}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 font-bold">
                  <td className={`${th} text-center`} colSpan={7}>ລວມ {fmt(docs.length)} ໃບ</td>
                  <td className={`${th} text-right font-mono`}>{fmt(docs.reduce((s, d) => s + d.ordered, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(docs.reduce((s, d) => s + d.issued, 0))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(docs.reduce((s, d) => s + d.remaining, 0))}</td>
                  <td className={th} />
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed border-collapse text-[10px]">
              <colgroup>
                <col className="w-[4%]" /><col className="w-[13%]" /><col className="w-[32%]" />
                <col className="w-[6%]" /><col className="w-[5%]" /><col className="w-[9%]" />
                <col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[6%]" /><col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className={th}>#</th>
                  <th className={th}>ລະຫັດສິນຄ້າ</th>
                  <th className={th}>ລາຍການສິນຄ້າ</th>
                  <th className={th}>ໜ່ວຍ</th>
                  <th className={`${th} text-right`}>ໃບ</th>
                  <th className={`${th} text-right`}>ຄ້າງຈ່າຍ</th>
                  <th className={`${th} text-right`}>stock ໃນສາງ</th>
                  <th className={`${th} text-right`}>ຂາດ</th>
                  <th className={th}>ຄ້າງດົນສຸດ</th>
                  <th className={th}>ໄລຍະ</th>
                </tr>
              </thead>
              <tbody>
                {shownItems.map((it, i) => (
                  <tr key={it.item_code}>
                    <td className={`${th} text-center`}>{i + 1}</td>
                    <td className={`${th} font-mono font-bold`} style={{ overflowWrap: "anywhere" }}>{it.item_code}</td>
                    <td className={`${th} align-top leading-tight`} style={{ overflowWrap: "anywhere" }}>{it.item_name ?? "—"}</td>
                    <td className={th}>{it.unit_code ?? ""}</td>
                    <td className={`${th} text-right font-mono`}>{it.docs}</td>
                    <td className={`${th} text-right font-mono font-bold`}>{fmt(it.remaining)}</td>
                    <td className={`${th} text-right font-mono`}>{fmt(it.on_hand)}</td>
                    <td className={`${th} text-right font-mono`}>{it.shortfall > 0.0001 ? fmt(it.shortfall) : "—"}</td>
                    <td className={`${th} font-mono font-bold ${it.oldest_seconds >= ALERT_SECONDS ? "text-red-600" : ""}`}>
                      {it.oldest_seconds >= ALERT_SECONDS ? "▲ " : ""}{formatWait(it.oldest_seconds)}
                    </td>
                    <td className={th}>{AGING_BUCKETS.find((b) => b.id === bucketOf(it.oldest_days))?.label}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className={`${th} text-center`} colSpan={5}>ລວມ {fmt(items.length)} ລາຍການ</td>
                  <td className={`${th} text-right font-mono`}>{fmt(totalRemaining)}</td>
                  <td className={th} />
                  <td className={`${th} text-right font-mono`}>{fmt(totalShortfall)}</td>
                  <td className={th} colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}

          {truncated && (
            <p className="mt-2 text-[10px] text-rose-600">
              ⚠ ສະແດງພຽງ {MAX_PRINT_ROWS} ແຖວທຳອິດ ຈາກ {fmt(rowCount)} ແຖວ — ກະລຸນາຫຼຸດຊ່ວງວັນທີ່ ຫຼື ໃຊ້ Excel ສຳລັບຂໍ້ມູນເຕັມ
            </p>
          )}

          <p className="mt-2 text-[9px] text-slate-500">
            ⓘ ຄ້າງຈ່າຍ = ຈຳນວນສັ່ງ (ຫັກຍົກເລີກ) − ຈ່າຍອອກແລ້ວ − ຈຳນວນທີ່ຢູ່ໃນໃບເກັບທີ່ຍັງບໍ່ຢືນຢັນ ·
            ບໍ່ນັບບໍລິການ (ລະຫັດຂຶ້ນຕົ້ນດ້ວຍ 9 ແລະ notcount) ·
            ຄ້າງມາແລ້ວ = ນັບແຕ່ເວລາສ້າງໃບ ຮອດເວລາພິມ (ລະອຽດເຖິງວິນາທີ)
            {" · "}<span className="font-bold text-red-600">▲ = ຄ້າງເກີນ 5 ມື້</span>
            {view === "docs" ? " · * = ເກີນວັນທີ່ຕ້ອງການແລ້ວ" : " · ຄ້າງດົນສຸດ = ໃບເກົ່າສຸດທີ່ຍັງລໍສິນຄ້ານີ້"}
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
