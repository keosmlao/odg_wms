"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  doc_no: string; doc_date: string | null; want_date: string | null; status: number | null;
  wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null;
  req: string; to_transit: string; in_transit: string; received: string;
  created_at: string | null; issued_at: string | null; received_at: string | null;
};

const n = (s: string) => Number.parseFloat(s) || 0;
const fmtD = (s: string | null) => (s ? s.split("-").reverse().join("-") : "—");
const ms = (s: string | null) => (s ? new Date(s.replace(" ", "T")).getTime() : NaN);
/** Duration "N ມື້ HH:MM:SS" between two epoch ms. */
function dur(a: number, b: number): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
  let x = Math.max(0, b - a);
  const d = Math.floor(x / 86_400_000); x %= 86_400_000;
  const h = Math.floor(x / 3_600_000); x %= 3_600_000;
  const m = Math.floor(x / 60_000); const s = Math.floor((x % 60_000) / 1000);
  const p = (v: number) => String(v).padStart(2, "0");
  return d > 0 ? `${d} ມື້ ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

type NodeState = "done" | "partial" | "current" | "pending" | "rejected";

/** Lifecycle stage of a transfer request, for the progress tracker. */
function track(d: Row) {
  const req = n(d.req), toT = n(d.to_transit), inT = n(d.in_transit), rcv = n(d.received);
  const st = d.status ?? 0;
  const rejected = st === 2;
  const done = req > 0 && rcv + 1e-6 >= req;
  const full = (v: number) => req > 0 && v + 1e-6 >= req;
  // per-node state: ① ຂໍ ② ອະນຸມັດ ③ ຈ່າຍ→ກາງ ④ ຄ້າງທາງ ⑤ ຮັບເຂົ້າ
  const states: NodeState[] = [
    "done",
    rejected ? "rejected" : st >= 1 ? "done" : "current",
    full(toT) ? "done" : toT > 1e-6 ? "partial" : (st >= 1 && !rejected ? "current" : "pending"),
    done ? "done" : inT > 1e-6 ? "current" : "pending",
    done ? "done" : rcv > 1e-6 ? "partial" : "pending",
  ];
  // primary stage (badge + action shortcut)
  let current = 1;
  if (done) current = 5;
  else if (rejected) current = -1;
  else if (inT > 1e-6) current = 3;
  else if (st === 1) current = 2;
  else current = 1;
  return { req, toT, inT, rcv, st, rejected, done, states, current };
}

const STAGES = [
  { key: "req", label: "ຂໍ", icon: "📝" },
  { key: "appr", label: "ອະນຸມັດ", icon: "✅" },
  { key: "issue", label: "ຈ່າຍ→ກາງ", icon: "📤" },
  { key: "transit", label: "ຄ້າງທາງ", icon: "🚚" },
  { key: "recv", label: "ຮັບເຂົ້າ", icon: "📥" },
];

export default function DashboardClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selWh, setSelWh] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/movements/transfer-dashboard", { cache: "no-store" });
        const j = await r.json();
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setMine(Array.isArray(j.mine) ? j.mine : null);
      } catch { setRows([]); }
      setLoading(false);
    })();
  }, []);

  // Warehouses the user manages (that appear in the data) — for the selector.
  const whOptions = useMemo(() => {
    const m = new Map<string, string>();
    const ok = (c: string | null) => c != null && (mine === null || mine.includes(c));
    for (const d of rows) {
      if (ok(d.wh_from)) m.set(d.wh_from!, d.wh_from_name ? `${d.wh_from} · ${d.wh_from_name}` : d.wh_from!);
      if (ok(d.wh_to)) m.set(d.wh_to!, d.wh_to_name ? `${d.wh_to} · ${d.wh_to_name}` : d.wh_to!);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, mine]);

  // require a warehouse selection; auto-pick if the user owns only one.
  useEffect(() => { if (!selWh && whOptions.length === 1) setSelWh(whOptions[0][0]); }, [whOptions, selWh]);

  const bySearch = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((d) => `${d.doc_no} ${d.wh_from_name ?? ""} ${d.wh_to_name ?? ""}`.toLowerCase().includes(term));
  }, [rows, q]);
  // Combined list — both จ่าย (ต้นทาง) and รับ (ปลายทาง) of the selected warehouse.
  const combined = useMemo(() => {
    const items: { d: Row; role: "out" | "in" }[] = [];
    for (const d of bySearch) {
      if (d.wh_from === selWh) items.push({ d, role: "out" });
      if (d.wh_to === selWh) items.push({ d, role: "in" });
    }
    return items.sort((a, b) => (b.d.doc_date ?? "").localeCompare(a.d.doc_date ?? ""));
  }, [bySearch, selWh]);
  const nOut = combined.filter((x) => x.role === "out").length;
  const nIn = combined.filter((x) => x.role === "in").length;

  return (
    <div className="space-y-5">
      {/* ปุ่มลัด workflow */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/movements/transfer-request" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-98">📝 ອອກໃບຂໍໂອນ</Link>
        <span className="text-slate-300">›</span>
        {[
          { label: "ອະນຸມັດ", href: "/movements/transfer-approve", icon: "✅" },
          { label: "ຈ່າຍອອກ", href: "/movements/issue", icon: "📤" },
          { label: "ຮັບໂອນເຂົ້າ", href: "/movements/transfer-receive", icon: "📥" },
          { label: "ຮັບຄືນ", href: "/movements/transfer-return", icon: "↩️" },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-violet-50 hover:text-violet-700 hover:ring-violet-200"><span>{a.icon}</span>{a.label}</Link>
        ))}
      </div>

      {/* เลือกสาง (บังคับ) + ค้นหา */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={selWh} onChange={(e) => setSelWh(e.target.value)}
          className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">— ເລືອກສາງ —</option>
          {whOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        {selWh && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ຄົ້ນຫາ ໃບຂໍໂອນ…"
          className="min-w-[200px] flex-1 sm:max-w-md rounded-xl bg-white px-4 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-violet-500" />}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">ກຳລັງໂຫລດ…</div>
      ) : !selWh ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center">
          <div className="text-2xl">🏢</div>
          <p className="mt-2 text-sm font-bold text-slate-500">ກະລຸນາເລືອກສາງກ່ອນ</p>
          <p className="mt-1 text-xs text-slate-400">ເລືອກສາງ เพื่อดูงานโอน ໃນฐานะ ຕົ້ນທາງ (จ่าย) ແລະ ປາຍທາງ (รับ)</p>
        </div>
      ) : combined.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">ບໍ່ມີ ໃບຂໍໂອນ ທີ່ກຳລັງດำเนินการ ໃນສางนี้</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            ຕິດຕາມ {combined.length} ລາຍການ
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">📤 ຈ່າຍ (ຕົ້ນທາງ) {nOut}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">📥 ຮັບ (ປາຍທາງ) {nIn}</span>
          </div>
          {combined.map(({ d, role }) => <TrackCard key={`${role}-${d.doc_no}`} d={d} role={role} now={now} today={today} />)}
        </div>
      )}
    </div>
  );
}

/** Action for the selected warehouse based on its ROLE in this transfer. */
function roleAction(role: "out" | "in", d: Row, t: ReturnType<typeof track>) {
  if (t.rejected || t.done) return null;
  const doc = encodeURIComponent(d.doc_no);
  if (role === "in") {
    return t.inT > 1e-6 ? { href: `/movements/transfer-receive?doc=${doc}`, label: "→ ໄປຮັບເຂົ້າ", cls: "bg-emerald-500" } : null;
  }
  if (t.current === 1) return { href: `/movements/transfer-approve?doc=${doc}`, label: "→ ໄປອະນຸມັດ", cls: "bg-amber-500" };
  if (t.req - t.toT > 1e-6 && t.st >= 1) return { href: `/movements/issue?type=transfer&doc=${doc}${d.wh_from ? `&wh=${encodeURIComponent(d.wh_from)}` : ""}`, label: "→ ໄປຈ່າຍ", cls: "bg-red-500" };
  // ຈ່າຍຄົບແລ້ວ ກຳລັງຄ້າງທາງ → ลำ ปลายทางรับ (ไม่ใช่งานต้นทาง); ມີทางเลือก ฮับคืน
  return null;
}

function TrackCard({ d, role, now, today }: { d: Row; role: "out" | "in"; now: number; today: string }) {
  const t = track(d);
  const overdue = !!d.want_date && d.want_date < today && !t.done;
  const act = roleAction(role, d, t);
  const waiting = role === "in" && !t.done && !t.rejected && t.inT <= 1e-6; // dest waiting for source to issue
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${role === "out" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{role === "out" ? "📤 ຈ່າຍ" : "📥 ຮັບ"}</span>
        <span className="font-mono text-sm font-bold text-violet-700">{d.doc_no}</span>
        <span className="text-xs text-slate-500">{d.wh_from_name ?? d.wh_from} → {d.wh_to_name ?? d.wh_to}</span>
        {t.rejected ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">ຖືກປฏิเสธ</span>
          : t.done ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">ສຳເລັດ ✓</span>
          : waiting ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">ລໍ ຕົ້ນທາງຈ່າຍ</span>
          : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{STAGES[t.current]?.label ?? "ດำเนินการ"}</span>}
        {overdue && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">ເກີນກຳນົດ {fmtD(d.want_date)}</span>}
        <span className="ml-auto flex items-center gap-2">
          {!t.done && t.req - t.rcv > 1e-6 && <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">ຍັງຄ້າງ {t.req - t.rcv}/{t.req}</span>}
          <span className="text-[11px] text-slate-400">{fmtD(d.doc_date)}</span>
        </span>
      </div>

      <div className="flex items-stretch">
        {STAGES.map((s, i) => {
          const stt = t.states[i];
          const isDone = stt === "done";
          const active = stt === "current" || stt === "partial";
          const connCls = (idx: number) => (t.states[idx] === "done" ? "bg-emerald-400" : t.states[idx] === "partial" || t.states[idx] === "current" ? "bg-amber-300" : "bg-slate-200");
          const circle = isDone ? "bg-emerald-500 text-white ring-emerald-200"
            : stt === "current" ? "bg-amber-400 text-white ring-amber-200 animate-pulse"
            : stt === "partial" ? "bg-amber-300 text-white ring-amber-200"
            : "bg-slate-100 text-slate-300 ring-slate-200";
          const textCls = isDone ? "text-emerald-700" : active ? "text-amber-600" : "text-slate-400";
          const qtyLabel = i === 0 ? `${t.req}` : i === 2 ? `${t.toT}/${t.req}` : i === 3 ? `${t.inT}` : i === 4 ? `${t.rcv}/${t.req}` : null;
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-1 flex-1 rounded ${i === 0 ? "bg-transparent" : connCls(i - 1)}`} />
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 transition ${circle}`}>{isDone ? "✓" : active ? "●" : "○"}</div>
                <div className={`h-1 flex-1 rounded ${i === STAGES.length - 1 ? "bg-transparent" : connCls(i)}`} />
              </div>
              <div className={`mt-1.5 text-center text-[10px] font-bold ${textCls}`}>{s.icon} {s.label}</div>
              {qtyLabel != null && i !== 1 && <div className={`text-[10px] font-mono ${active ? "font-bold text-amber-600" : "text-slate-500"}`}>{qtyLabel}</div>}
            </div>
          );
        })}
      </div>

      {!t.done && !t.rejected && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5 text-[11px]">
          {t.req - t.toT > 1e-6 && <span className="rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-600">ຍັງບໍ່ຈ່າຍ {t.req - t.toT}</span>}
          {t.inT > 1e-6 && <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-600">ຄ້າງລະຫວ່າງທາງ {t.inT}</span>}
          {t.rcv > 1e-6 && <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">ຮັບແລ້ວ {t.rcv}</span>}
        </div>
      )}

      {(() => {
        const cr = ms(d.created_at), iss = ms(d.issued_at), rec = ms(d.received_at);
        const segs: { label: string; val: string; live?: boolean; cls: string }[] = [];
        if (Number.isFinite(iss)) segs.push({ label: "ຂໍ→ຈ່າຍ", val: dur(cr, iss), cls: "text-slate-500" });
        else if (!t.rejected && !t.done) segs.push({ label: t.current === 1 ? "ລໍอนุมัติมาแล้ว" : "ລໍจ่ายมาแล้ว", val: dur(cr, now), live: true, cls: "text-amber-600" });
        if (Number.isFinite(iss)) {
          if (Number.isFinite(rec) && t.done) segs.push({ label: "ໃນທາງ", val: dur(iss, rec), cls: "text-slate-500" });
          else if (t.inT > 1e-6) segs.push({ label: "ໃນທາງ (ລໍຮັບ)", val: dur(iss, now), live: true, cls: "text-amber-600" });
        }
        if (t.done && Number.isFinite(rec)) segs.push({ label: "ລວມ ຂໍ→ສຳເລັດ", val: dur(cr, rec), cls: "font-bold text-emerald-600" });
        if (segs.length === 0) return null;
        return (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {segs.map((sg, i) => <span key={i} className={`inline-flex items-center gap-1 ${sg.cls}`}>⏱ {sg.label}: <span className="font-mono tabular-nums">{sg.val}</span>{sg.live ? " ⏳" : ""}</span>)}
          </div>
        );
      })()}

      {(() => {
        // ต้นทาง: จ่ายครบแล้ว ของอยู่ในทาง → รอปลายทางรับ (text) + ทางเลือก รับคืน
        const outWaiting = role === "out" && !t.done && !t.rejected && t.inT > 1e-6 && t.req - t.toT <= 1e-6;
        if (act) return <div className="mt-3 flex justify-end"><Link href={act.href} className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ${act.cls}`}>{act.label}</Link></div>;
        if (outWaiting) return (
          <div className="mt-3 flex items-center justify-end gap-3">
            <span className="text-xs font-semibold text-amber-600">⏳ ລໍ ປາຍທາງ ຮັບເຂົ້າ…</span>
            <Link href={`/movements/transfer-return?doc=${encodeURIComponent(d.doc_no)}`} className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-600 ring-1 ring-sky-200 hover:bg-sky-100">↩ ຮັບຄືນ</Link>
          </div>
        );
        return null;
      })()}
    </div>
  );
}
