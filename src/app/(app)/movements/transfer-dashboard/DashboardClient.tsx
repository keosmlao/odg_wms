"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";

type Row = {
  doc_no: string; doc_date: string | null; want_date: string | null; status: number | null;
  wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null;
  req: string; to_transit: string; in_transit: string; received: string;
  created_at: string | null; issued_at: string | null; received_at: string | null;
};

/** ບັນທັດສິນຄ້າ ທີ່ກົງກັບຄຳຄົ້ນຫາ (ຈາກ /transfer-dashboard/items). */
type ItemHit = {
  doc_no: string; item_code: string; item_name: string | null; unit_code: string | null;
  req: string; to_transit: string; in_transit: string; received: string;
};

const n = (s: string) => Number.parseFloat(s) || 0;
/** trim trailing zeros so 10.000 shows as 10 */
const q3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
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
  // ສະແດງເປັນຊຸດ. API ດຶງມາເຖິງ 500 ໃບ ແລະ ແຕ່ລະໃບ render ເປັນ stepper 5 ຂັ້ນ —
  // 386 ໃບ = ~80,000px ຂອງໜ້າຈໍ ແລະ DOM ໜັກຈົນໜ້າຢຸດ. ນັບຫົວຕາຕະລາງຈາກ
  // ຊຸດເຕັມຄືເກົ່າ (ຕົວເລກ "ຕິດຕາມ 386 ລາຍການ" ຕ້ອງຖືກ) ແຕ່ render ເທື່ອລະ 20.
  const PAGE = 20;
  const [visible, setVisible] = useState(PAGE);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [itemHits, setItemHits] = useState<Map<string, ItemHit[]>>(() => new Map());
  const [itemBusy, setItemBusy] = useState(false);
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

  // ຄົ້ນຫາ ລະຫັດ/ຊື່ ສິນຄ້າ → ໃບໂອນທີ່ຍັງມີສິນຄ້ານັ້ນຄ້າງຢູ່ (debounced server lookup).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItemHits(new Map()); setItemBusy(false); return; }
    let alive = true;
    setItemBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/movements/transfer-dashboard/items?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        const m = new Map<string, ItemHit[]>();
        for (const it of (Array.isArray(j.matches) ? j.matches : []) as ItemHit[]) {
          const arr = m.get(it.doc_no);
          if (arr) arr.push(it); else m.set(it.doc_no, [it]);
        }
        setItemHits(m);
      } catch { if (alive) setItemHits(new Map()); }
      if (alive) setItemBusy(false);
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

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


  // ຄົ້ນຫາໄດ້ທັງ ເລກທີ່ໃບໂອນ / ຊື່ສາງ ແລະ ລະຫັດ-ຊື່ ສິນຄ້າ (ຈາກ itemHits).
  const bySearch = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((d) =>
      `${d.doc_no} ${d.wh_from_name ?? ""} ${d.wh_to_name ?? ""}`.toLowerCase().includes(term) || itemHits.has(d.doc_no));
  }, [rows, q, itemHits]);
  // ບໍ່ມີການເລືອກສາງແລ້ວ — ລວມທຸກສາງທີ່ຜູ້ໃຊ້ຮັບຜິດຊອບ, ຕິດປ້າຍສາງໃສ່ແຕ່ລະລາຍການ
  // ແລ້ວແຍກກຸ່ມຕາມສາງ. ໃບໜຶ່ງອາດປະກົດ 2 ເທື່ອ (ຕົ້ນທາງ + ປາຍທາງ) ຄືເກົ່າ.
  const combined = useMemo(() => {
    const items: { d: Row; role: "out" | "in"; wh: string }[] = [];
    const ok = (c: string | null) => c != null && (mine === null || mine.includes(c));
    for (const d of bySearch) {
      if (ok(d.wh_from)) items.push({ d, role: "out", wh: d.wh_from! });
      if (ok(d.wh_to)) items.push({ d, role: "in", wh: d.wh_to! });
    }
    return items.sort((a, b) => (b.d.doc_date ?? "").localeCompare(a.d.doc_date ?? ""));
  }, [bySearch, mine]);
  const nOut = combined.filter((x) => x.role === "out").length;
  const nIn = combined.filter((x) => x.role === "in").length;
  const whGroups = useMemo(
    () => groupByWarehouse(combined, (x) => x.wh, whOptions.map(([code]) => ({ code }))),
    [combined, whOptions],
  );
  // ຄົ້ນຫາໃໝ່ = ລາຍການໃໝ່ → ເລີ່ມນັບຈາກ 20 ອີກເທື່ອ
  useEffect(() => {
    setVisible(PAGE);
  }, [q, rows]);

  // ເລື່ອນຮອດທ້າຍ → ສະແດງເພີ່ມ. ຂໍ້ມູນຢູ່ໃນມືແລ້ວ ຈຶ່ງບໍ່ມີ request —
  // ສິ່ງທີ່ແພງຄືການ render ບໍ່ແມ່ນການດຶງ.
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + PAGE);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const nItemDocs = useMemo(
    () => new Set(combined.filter((x) => itemHits.has(x.d.doc_no)).map((x) => x.d.doc_no)).size,
    [combined, itemHits],
  );

  return (
    <div className="space-y-5">
      {/* ປຸ່ມລັດ workflow */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/movements/transfer-request" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-aqua-700 to-brand-800 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-98">📝 ອອກໃບຂໍໂອນ</Link>
        <span className="text-slate-300">›</span>
        {[
          { label: "ອະນຸມັດ", href: "/movements/transfer-approve", icon: "✅" },
          { label: "ຈ່າຍອອກ", href: "/movements/issue", icon: "📤" },
          { label: "ຮັບໂອນເຂົ້າ", href: "/movements/transfer-receive", icon: "📥" },
          { label: "ຮັບຄືນ", href: "/movements/transfer-return", icon: "↩️" },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-aqua-50 hover:text-aqua-700 hover:ring-aqua-200"><span>{a.icon}</span>{a.label}</Link>
        ))}
      </div>

      {/* ທຸກສາງ (ບໍ່ມີການເລືອກ) + ຄົ້ນຫາ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
          🏢 ທຸກສາງ
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{whOptions.length}</span>
        </span>
        {(
          <div className="min-w-[200px] flex-1 sm:max-w-md">
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ຄົ້ນຫາ ໃບຂໍໂອນ / ລະຫັດສິນຄ້າ / ຊື່ສິນຄ້າ…"
                className="w-full rounded-xl bg-white px-4 py-2.5 pr-16 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-aqua-500" />
              {itemBusy && <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">…</span>}
              {q && <button type="button" onClick={() => setQ("")} title="ລ້າງ"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>}
            </div>
            <p className="mt-1 px-1 text-[11px] text-slate-400">ພິມ ລະຫັດ/ຊື່ ສິນຄ້າ ເພື່ອເບິ່ງວ່າ ຄ້າງຢູ່ໃບໂອນໃດ (ຢ່າງໜ້ອຍ 2 ຕົວອັກສອນ)</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">ກຳລັງໂຫລດ…</div>
      ) : combined.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
          {q.trim() ? (itemBusy ? "ກຳລັງຄົ້ນຫາ…" : `ບໍ່ພົບ ໃບຂໍໂອນ ທີ່ຍັງບໍ່ສຳເລັດ ສຳລັບ “${q.trim()}”`) : "ບໍ່ມີ ໃບຂໍໂອນ ທີ່ກຳລັງດຳເນີນການ ໃນທຸກສາງທີ່ທ່ານຮັບຜິດຊອບ"}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            ຕິດຕາມ {combined.length} ລາຍການ
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">📤 ຈ່າຍ (ຕົ້ນທາງ) {nOut}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">📥 ຮັບ (ປາຍທາງ) {nIn}</span>
            {nItemDocs > 0 && <span className="rounded-full bg-aqua-50 px-2 py-0.5 text-aqua-700">🔎 ພົບສິນຄ້າໃນ {nItemDocs} ໃບໂອນ</span>}
          </div>
          {(() => {
            // ງົບ render ໄຫຼຜ່ານກຸ່ມຕໍ່ໆກັນ: ກຸ່ມທຳອິດໃຊ້ໄປເທົ່າໃດ ກຸ່ມຕໍ່ໄປໄດ້ສ່ວນທີ່ເຫຼືອ.
            // ຫົວກຸ່ມຍັງບອກຈຳນວນເຕັມສະເໝີ ຄົນຈຶ່ງຮູ້ວ່າຍັງມີອີກເທົ່າໃດຢູ່ຂ້າງລຸ່ມ.
            let budget = visible;
            return whGroups.map((g) => {
              const take = Math.max(0, Math.min(budget, g.rows.length));
              budget -= take;
              return (
                <WarehouseGroup
                  key={g.code}
                  code={g.code}
                  name={(whOptions.find(([c]) => c === g.code)?.[1] ?? "").split(" · ")[1] ?? null}
                  count={g.rows.length}
                  countLabel="ລາຍການ"
                  tone="aqua"
                >
                  <div className="space-y-3">
                    {g.rows.slice(0, take).map(({ d, role }) => (
                      <TrackCard key={`${g.code}-${role}-${d.doc_no}`} d={d} role={role} now={now} today={today} hits={itemHits.get(d.doc_no)} />
                    ))}
                    {take < g.rows.length && (
                      <p className="py-1 text-center text-[11px] text-slate-400">
                        ຍັງມີອີກ {g.rows.length - take} ລາຍການ — ເລື່ອນລົງເພື່ອສະແດງ
                      </p>
                    )}
                  </div>
                </WarehouseGroup>
              );
            });
          })()}

          {/* ຕົວຈັບການເລື່ອນ + ປຸ່ມສຳຮອງ ສຳລັບ browser ທີ່ບໍ່ຮອງຮັບ observer */}
          {visible < combined.length ? (
            <div ref={moreRef} className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                ສະແດງເພີ່ມອີກ {Math.min(PAGE, combined.length - visible)} ລາຍການ
                <span className="ml-1 font-normal text-slate-400">({visible} / {combined.length})</span>
              </button>
            </div>
          ) : (
            combined.length > PAGE && (
              <p className="py-2 text-center text-[11px] text-slate-400">ຄົບທຸກລາຍການແລ້ວ ({combined.length})</p>
            )
          )}
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
  // ຈ່າຍຄົບແລ້ວ ກຳລັງຄ້າງທາງ → ລໍ ປາຍທາງຮັບ (ບໍ່ແມ່ນວຽກຕົ້ນທາງ); ມີທາງເລືອກ ຮັບຄືນ
  return null;
}

/** ບັນທັດສິນຄ້າທີ່ກົງກັບການຄົ້ນຫາ — ບອກວ່າສິນຄ້ານັ້ນຄ້າງຢູ່ຂັ້ນຕອນໃດ ໃນໃບໂອນນີ້. */
function ItemHits({ hits }: { hits: ItemHit[] }) {
  return (
    <div className="mt-3 rounded-xl bg-aqua-50/70 p-2.5 ring-1 ring-aqua-100">
      <div className="mb-1.5 text-[10px] font-bold text-aqua-700">🔎 ສິນຄ້າທີ່ຄົ້ນຫາ ໃນໃບນີ້</div>
      <div className="space-y-1">
        {hits.map((it) => {
          const req = n(it.req), toT = n(it.to_transit), inT = n(it.in_transit), rcv = n(it.received);
          const unit = it.unit_code ? ` ${it.unit_code}` : "";
          return (
            <div key={it.item_code} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="font-mono font-bold text-slate-700">{it.item_code}</span>
              <span className="text-slate-500">{it.item_name ?? "—"}</span>
              <span className="rounded-md bg-white px-1.5 py-0.5 font-semibold text-slate-500 ring-1 ring-slate-200">ຂໍ {q3(req)}{unit}</span>
              {req - toT > 1e-6 && <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-600">ຍັງບໍ່ຈ່າຍ {q3(req - toT)}</span>}
              {inT > 1e-6 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-600">ຄ້າງລະຫວ່າງທາງ {q3(inT)}</span>}
              {rcv > 1e-6 && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-600">ຮັບແລ້ວ {q3(rcv)}</span>}
              {req - rcv <= 1e-6 && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">ຄົບ ✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrackCard({ d, role, now, today, hits }: { d: Row; role: "out" | "in"; now: number; today: string; hits?: ItemHit[] }) {
  const t = track(d);
  const overdue = !!d.want_date && d.want_date < today && !t.done;
  const act = roleAction(role, d, t);
  const waiting = role === "in" && !t.done && !t.rejected && t.inT <= 1e-6; // dest waiting for source to issue
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${role === "out" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{role === "out" ? "📤 ຈ່າຍ" : "📥 ຮັບ"}</span>
        <span className="font-mono text-sm font-bold text-aqua-700">{d.doc_no}</span>
        <span className="text-xs text-slate-500">{d.wh_from_name ?? d.wh_from} → {d.wh_to_name ?? d.wh_to}</span>
        {t.rejected ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">ຖືກປະຕິເສດ</span>
          : t.done ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">ສຳເລັດ ✓</span>
          : waiting ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">ລໍ ຕົ້ນທາງຈ່າຍ</span>
          : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{STAGES[t.current]?.label ?? "ດຳເນີນການ"}</span>}
        {overdue && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">ເກີນກຳນົດ {fmtD(d.want_date)}</span>}
        <span className="ml-auto flex items-center gap-2">
          {!t.done && t.req - t.rcv > 1e-6 && <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">ຍັງຄ້າງ {t.req - t.rcv}/{t.req}</span>}
          <span className="text-[11px] text-slate-400">{fmtD(d.doc_date)}</span>
          <a href={`/print/transfer-request/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener"
            title="ພິມໃບຂໍໂອນ" className="shrink-0 rounded-lg p-1.5 text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-700">🖨</a>
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

      {hits && hits.length > 0 && <ItemHits hits={hits} />}

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
        else if (!t.rejected && !t.done) segs.push({ label: t.current === 1 ? "ລໍອະນຸມັດມາແລ້ວ" : "ລໍຈ່າຍມາແລ້ວ", val: dur(cr, now), live: true, cls: "text-amber-600" });
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
        // ຕົ້ນທາງ: ຈ່າຍຄົບແລ້ວ ຂອງຢູ່ໃນທາງ → ລໍປາຍທາງຮັບ (text) + ທາງເລືອກ ຮັບຄືນ
        const outWaiting = role === "out" && !t.done && !t.rejected && t.inT > 1e-6 && t.req - t.toT <= 1e-6;
        if (act) return <div className="mt-3 flex justify-end"><Link href={act.href} className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ${act.cls}`}>{act.label}</Link></div>;
        if (outWaiting) return (
          <div className="mt-3 flex items-center justify-end gap-3">
            <span className="text-xs font-semibold text-amber-600">⏳ ລໍ ປາຍທາງ ຮັບເຂົ້າ…</span>
            <Link href={`/movements/transfer-return?doc=${encodeURIComponent(d.doc_no)}`} className="rounded-lg bg-aqua-50 px-3 py-1.5 text-xs font-bold text-aqua-600 ring-1 ring-aqua-200 hover:bg-aqua-100">↩ ຮັບຄືນ</Link>
          </div>
        );
        return null;
      })()}
    </div>
  );
}
