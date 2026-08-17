import "server-only";
import { movementSummary, movementDocs, pendingReceipts, health, topMovers, pendingIssues, type Scope } from "@/lib/reportData";
import { minStockAlerts } from "@/lib/minStock";

/**
 * Assemble the HTML body of a scheduled report from the sections a config
 * enabled. Email clients strip <style> and external CSS, so everything is
 * inline-styled and table-based.
 */
export type ReportSections = { receive: boolean; issue: boolean; pending: boolean; health: boolean; movers: boolean; issue_pending: boolean; min_stock: boolean };

const F = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
}

function kpi(label: string, value: string, sub: string): string {
  return `<td style="padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;vertical-align:top">
    <div style="font-size:12px;color:#64748b;margin-bottom:4px">${esc(label)}</div>
    <div style="font-size:24px;font-weight:700;color:#0f172a">${esc(value)}</div>
    <div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(sub)}</div></td>`;
}

function section(title: string, inner: string): string {
  return `<div style="margin:24px 0 8px"><div style="font-size:15px;font-weight:700;color:#0f172a;border-left:3px solid #16a34a;padding-left:8px;margin-bottom:10px">${esc(title)}</div>${inner}</div>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<div style="font-size:13px;color:#94a3b8;padding:8px 0">${esc(empty)}</div>`;
  const th = headers.map((h) => `<th style="text-align:left;font-size:11px;color:#64748b;font-weight:600;padding:6px 10px;border-bottom:2px solid #e2e8f0">${esc(h)}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="font-size:13px;color:#334155;padding:6px 10px;border-bottom:1px solid #f1f5f9${i > 0 ? ";text-align:right" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export async function buildReportHtml(opts: { name: string; scope: Scope; date: string; sections: ReportSections }): Promise<{ html: string; subject: string; hasContent: boolean }> {
  const { name, scope, date, sections } = opts;
  const blocks: string[] = [];
  const scopeLabel = scope === null ? "ທຸກສາງ" : scope.length ? scope.join(", ") : "ບໍ່ມີສາງ";

  if (sections.receive || sections.issue) {
    const [rcv, iss] = await Promise.all([
      sections.receive ? movementSummary(scope, date, 1) : null,
      sections.issue ? movementSummary(scope, date, -1) : null,
    ]);
    const cells: string[] = [];
    if (rcv) cells.push(kpi("ຮັບເຂົ້າ ມື້ນີ້", F(rcv.total_qty), `${F(rcv.movement_count)} ລາຍການ · ${rcv.warehouse_count} ສາງ`));
    if (iss) cells.push(kpi("ຈ່າຍອອກ ມື້ນີ້", F(iss.total_qty), `${F(iss.movement_count)} ລາຍການ · ${iss.warehouse_count} ສາງ`));
    blocks.push(section("ສະຫຼຸບ ປະຈຳວັນ", `<table style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>${cells.join("")}</tr></table>`));
  }

  if (sections.receive) {
    const docs = await movementDocs(scope, date, 1, 25);
    blocks.push(section("ໃບຮັບເຂົ້າ ປະຈຳວັນ", table(
      ["ເອກະສານ", "ສາງ", "ລາຍການ", "ຈຳນວນ"],
      docs.map((d) => [d.doc_no, d.wh_code, String(d.lines), F(d.qty)]),
      "ບໍ່ມີການຮັບເຂົ້າ",
    )));
  }

  if (sections.issue) {
    const docs = await movementDocs(scope, date, -1, 25);
    blocks.push(section("ໃບຈ່າຍອອກ ປະຈຳວັນ", table(
      ["ເອກະສານ", "ສາງ", "ລາຍການ", "ຈຳນວນ"],
      docs.map((d) => [d.doc_no, d.wh_code, String(d.lines), F(d.qty)]),
      "ບໍ່ມີການຈ່າຍອອກ",
    )));
  }

  if (sections.pending) {
    const rows = await pendingReceipts(scope, 25);
    blocks.push(section("ໃບຮັບທີ່ຍັງຄ້າງ (PO ຄ້າງຮັບ ແຕ່ຕົ້ນປີ — ດົນສຸດກ່ອນ)", table(
      ["PO", "ສາງ", "ວັນທີ", "ຄ້າງ (ວັນ)", "ລາຍການ", "ຍັງຄ້າງ"],
      rows.map((r) => [r.po_no, r.wh_name ?? r.wh_code, r.doc_date ?? "-", String(r.days_waiting), String(r.lines), F(r.remaining)]),
      "ບໍ່ມີໃບຄ້າງຮັບ",
    )));
  }

  if (sections.issue_pending) {
    const rows = await pendingIssues(scope, 25);
    blocks.push(section("ສິນຄ້າຄ້າງຈ່າຍ (ຄ້າງຈ່າຍອອກ ແຕ່ຕົ້ນປີ — ດົນສຸດກ່ອນ)", table(
      ["ເອກະສານ", "ປະເພດ", "ວັນທີ", "ຄ້າງ (ວັນ)", "ລູກຄ້າ", "ຍັງຄ້າງ"],
      rows.map((r) => [r.doc_no, r.type, r.doc_date ?? "-", String(r.days_waiting), r.cust_name ?? "-", F(r.remaining)]),
      "ບໍ່ມີສິນຄ້າຄ້າງຈ່າຍ",
    )));
  }

  if (sections.movers) {
    const rows = await topMovers(scope, date, 7, 10);
    blocks.push(section("ສິນຄ້າເຄື່ອນໄຫວຫຼາຍສຸດ (7 ວັນ)", table(
      ["ລະຫັດ", "ຊື່ສິນຄ້າ", "ຈ່າຍອອກ", "ຄັ້ງ"],
      rows.map((r) => [r.item_code, r.item_name ?? "-", F(r.qout), String(r.outmoves)]),
      "ບໍ່ມີການເຄື່ອນໄຫວ",
    )));
  }

  if (sections.min_stock) {
    // ສະເພາະສາງທີ່ເປີດຄຸມ — ຖ້າຍັງບໍ່ມີສາງໃດເປີດ ຕາຕະລາງຈະຫວ່າງ (ບໍ່ແມ່ນ error).
    const rows = await minStockAlerts(scope, { only: "below", limit: 25 });
    blocks.push(section("ສິນຄ້າຕ່ຳກວ່າ stock ຂັ້ນຕ່ຳ (ຕ້ອງເຕີມ)", table(
      ["ລະຫັດ", "ຊື່ສິນຄ້າ", "ສາງ", "ຄົງເຫຼືອ", "ຂັ້ນຕ່ຳ", "ຕ້ອງເຕີມ"],
      rows.map((r) => [r.item_code, r.item_name ?? "-", r.wh_code, F(r.on_hand), F(r.min_qty), F(r.shortfall)]),
      "ບໍ່ມີສິນຄ້າຕ່ຳກວ່າຂັ້ນຕ່ຳ",
    )));
  }

  if (sections.health) {
    const h = await health(scope);
    const cells = [
      kpi("ສິນຄ້າຄ້າງ (>90 ວັນ)", F(h.dead_items), `${F(h.dead_qty)} ໜ່ວຍ`),
      kpi("SN ບໍ່ກົງ", F(h.sn_mismatch), "ຈຸດທີ່ຕ້ອງກວດ"),
    ];
    blocks.push(section("ສະຖານະສາງ (Health)", `<table style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>${cells.join("")}</tr></table>`));
  }

  const hasContent = blocks.length > 0;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans Lao',sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#16a34a;font-weight:700">WMS · ລາຍງານ</div>
    <h1 style="font-size:22px;margin:4px 0 2px">${esc(name)}</h1>
    <div style="font-size:13px;color:#64748b">${esc(date)} · ${esc(scopeLabel)}</div>
    ${blocks.join("")}
    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">ສ້າງໂດຍລະບົບ WMS ອັດຕະໂນມັດ · ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</div>
  </div>`;
  return { html, subject: `[WMS] ${name} · ${date}`, hasContent };
}
