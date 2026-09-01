import { redirect } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Chip, Card, Notice } from "@/components/ui/Card";
import { AlertIcon, TrendIcon } from "@/components/ui/Icons";
import { makePeriod, warehousePerformance, type Delta } from "@/lib/warehousePerformance";
import PerformanceFilters, { type WarehouseOption } from "./PerformanceFilters";

/** ຕົວເລກສົດທຸກຄັ້ງ — ລາຍງານປະສິດທິພາບບໍ່ຄວນມາຈາກ cache ຂອງ build. */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmt1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));

export default async function PerformancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const warehouses =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  const sp = await searchParams;
  const def = defaultRange();
  const from = ISO.test(one(sp.from)) ? one(sp.from) : def.from;
  const to = ISO.test(one(sp.to)) ? one(sp.to) : def.to;
  const wh = one(sp.wh);

  // ສາງດຽວ ຕ້ອງຢູ່ໃນສິດຂອງຜູ້ໃຊ້ຢູ່ແລ້ວ — ບໍ່ດັ່ງນັ້ນຖອຍໄປໃຊ້ຂອບເຂດເຕັມຂອງລາວ.
  const allowed = wh && warehouses.some((w) => w.code === wh);
  const scope = allowed ? [wh] : accessible;

  const period = makePeriod(from <= to ? from : to, from <= to ? to : from);
  const r = await warehousePerformance(scope, period);

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ປະສິດທິພາບການບໍລິຫານສາງ"
        description="KPI ມາດຕະຖານ 5 ດ້ານ — ຂາເຂົ້າ · ຂາອອກ · ຄົງຄັງ · ແຮງງານ · ພື້ນທີ່. ທຽບກັບຊ່ວງກ່ອນໜ້າທີ່ຍາວເທົ່າກັນ."
        icon={<TrendIcon className="h-6 w-6" />}
        tone="navy"
        chips={
          <>
            <Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>
            <Chip>
              {r.period.from} → {r.period.to} ({r.period.days} ມື້)
            </Chip>
            <Chip>ທຽບ {r.prev.from} → {r.prev.to}</Chip>
          </>
        }
      />

      <PerformanceFilters warehouses={warehouses} wh={allowed ? wh : ""} from={from} to={to} />

      {/* ── ຜົນງານລວມ ── */}
      <Section title="ຜົນງານລວມ (Throughput)" hint="ບໍ່ນັບການຍ້າຍບ່ອນພາຍໃນສາງ — ຄືກັນກັບໜ້າ ເຄື່ອນໄຫວປະຈຳວັນ">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="ຮັບເຂົ້າ (ຈຳນວນ)" d={r.throughput.in_qty} />
          <Kpi label="ຈ່າຍອອກ (ຈຳນວນ)" d={r.throughput.out_qty} />
          <Kpi label="ໃບຮັບເຂົ້າ" d={r.throughput.in_docs} />
          <Kpi label="ໃບຈ່າຍອອກ" d={r.throughput.out_docs} />
        </div>
      </Section>

      {/* ── ຂາເຂົ້າ / ຂາອອກ ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="ຂາເຂົ້າ (Inbound)">
          <dl className="space-y-2 text-sm">
            <Row
              label="ໄລຍະ PO → ຮັບເຂົ້າ (ມັດທະຍະຖານ)"
              value={`${fmt1(r.inbound.lead.p50)} ມື້`}
              sub={`p90 ${fmt1(r.inbound.lead.p90)} ມື້ · ${fmt(r.inbound.lead.docs)} ໃບ`}
            />
            <Row label="ໃບຄ້າງຮັບ" value={fmt(r.inbound.backlog.docs)} sub={`ຈຳນວນຄ້າງ ${fmt(r.inbound.backlog.qty)}`} />
            <Row
              label="ອາຍຸກອງຄ້າງ"
              value={`${fmt1(r.inbound.backlog.avg_days)} ມື້ (ສະເລ່ຍ)`}
              sub={`ເກົ່າສຸດ ${fmt(r.inbound.backlog.oldest_days)} ມື້`}
              tone={r.inbound.backlog.avg_days > 7 ? "warn" : undefined}
            />
            <Row
              label="ຄ້າງເກີນ 7 ມື້"
              value={fmt(r.inbound.backlog.over_7d)}
              tone={r.inbound.backlog.over_7d > 0 ? "warn" : "ok"}
            />
          </dl>
        </Section>

        <Section title="ຂາອອກ (Outbound)">
          <dl className="space-y-2 text-sm">
            <Row
              label="ໄລຍະ ໃບ → ຈ່າຍອອກ (ມັດທະຍະຖານ)"
              value={`${fmt1(r.outbound.cycle.p50)} ມື້`}
              sub={`p90 ${fmt1(r.outbound.cycle.p90)} ມື້ · ${fmt(r.outbound.cycle.docs)} ໃບ`}
            />
            <Row label="ໃບຄ້າງຈ່າຍ" value={fmt(r.outbound.backlog.docs)} sub={`ຈຳນວນຄ້າງ ${fmt(r.outbound.backlog.qty)}`} />
            <Row
              label="ອາຍຸກອງຄ້າງ"
              value={`${fmt1(r.outbound.backlog.avg_days)} ມື້ (ສະເລ່ຍ)`}
              sub={`ເກົ່າສຸດ ${fmt(r.outbound.backlog.oldest_days)} ມື້`}
              tone={r.outbound.backlog.avg_days > 7 ? "warn" : undefined}
            />
            <Row
              label="ຄ້າງເກີນ 7 ມື້"
              value={fmt(r.outbound.backlog.over_7d)}
              tone={r.outbound.backlog.over_7d > 0 ? "warn" : "ok"}
            />
            <Row
              label="ບັນທຶກ ຈ່າຍ/ຮັບ ບໍ່ຄົບ"
              value={fmt(r.outbound.short_notes)}
              sub="ຈຳນວນ (ໃບ × ສິນຄ້າ) ທີ່ມີເຫດຜົນກຳກັບ"
            />
          </dl>
        </Section>
      </div>

      {/* ── ຄົງຄັງ ── */}
      <Section
        title="ຄວາມຖືກຕ້ອງຂອງຄົງຄັງ (Inventory)"
        hint="IRA ນັບສະເພາະຮອບກວດນັບທີ່ປິດແລ້ວ — ຮອບທີ່ຍັງເປີດຢູ່ນັບບໍ່ທັນຄົບທຸກບ່ອນ ຈຶ່ງເອົາມາຄິດບໍ່ໄດ້"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="ສິນຄ້າຕາຍ (>90 ມື້)" value={fmt(r.inventory.dead_items)} sub={`ຈຳນວນ ${fmt(r.inventory.dead_qty)}`} tone={r.inventory.dead_items > 0 ? "warn" : "ok"} />
          <Stat label="SN ບໍ່ກົງກັບ stock" value={fmt(r.inventory.sn_mismatch)} sub="ຈຸດເກັບທີ່ບໍ່ກົງ" tone={r.inventory.sn_mismatch > 0 ? "warn" : "ok"} />
          <Stat label="ຕ່ຳກວ່າຂັ້ນຕ່ຳ" value={fmt(r.inventory.below_min)} sub={`ຕັ້ງກົດໄວ້ ${fmt(r.inventory.min_rules)} ລາຍການ · ${fmt(r.inventory.min_warehouses)} ສາງ`} tone={r.inventory.below_min > 0 ? "warn" : undefined} />
          <Stat label="ເກີນຂັ້ນສູງ" value={fmt(r.inventory.above_max)} />
        </div>

        <div className="mt-3">
          {r.inventory.ira.length === 0 ? (
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <b>ຍັງບໍ່ມີ IRA</b> — ຍັງບໍ່ມີຮອບກວດນັບທີ່ປິດແລ້ວໃນສາງທີ່ເລືອກ. ມາດຕະຖານຄື cycle count
              ໝູນວຽນ (ສິນຄ້າກຸ່ມ A ນັບເດືອນລະເທື່ອ) ແລ້ວ<b>ປິດຮອບ</b>ທຸກຄັ້ງ ຈຶ່ງຈະວັດຄວາມຖືກຕ້ອງໄດ້.{" "}
              <Link href="/stocktake" className="font-semibold underline">
                ໄປໜ້າກວດນັບ
              </Link>
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1.5">ສາງ</th>
                  <th className="py-1.5">ນັບວັນທີ</th>
                  <th className="py-1.5 text-right">ລາຍການທີ່ນັບ</th>
                  <th className="py-1.5 text-right">ກົງ</th>
                  <th className="py-1.5 text-right">IRA</th>
                </tr>
              </thead>
              <tbody>
                {r.inventory.ira.map((x) => (
                  <tr key={x.wh_code} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 font-mono text-xs">{x.wh_code}</td>
                    <td className="py-1.5 text-xs text-zinc-500">{x.count_date ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(x.items_counted)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(x.matched)}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${x.accuracy >= 95 ? "text-emerald-600" : x.accuracy >= 90 ? "text-amber-600" : "text-rose-600"}`}>
                      {x.accuracy}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-zinc-400">
            ຄວາມຕ່າງ ERP ↔ WMS ເປັນລາຍສິນຄ້າ ເບິ່ງໄດ້ທີ່{" "}
            <Link href="/movements/accuracy" className="underline">
              ໜ້າຄວາມຖືກຕ້ອງ stock
            </Link>{" "}
            (ຄິດຊ້າ ~30 ວິ ຈຶ່ງບໍ່ລວມໄວ້ໃນນີ້)
          </p>
        </div>
      </Section>

      {/* ── ແຮງງານ ── */}
      <Section title="ແຮງງານ (Productivity)" hint="ນັບຈາກແຖວການເຄື່ອນໄຫວທີ່ແຕ່ລະບັນຊີບັນທຶກ">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="ຜູ້ປະຕິບັດງານ" value={fmt(r.labor.users)} sub="ບັນຊີທີ່ມີການເຄື່ອນໄຫວ" />
          <Kpi label="ແຖວທັງໝົດ" d={r.labor.lines} />
          <Stat label="ແຖວ / ມື້" value={fmt(r.labor.lines_per_day)} />
          <Stat label="ແຖວ / ຄົນ / ມື້" value={fmt(r.labor.lines_per_user_day)} />
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">ອັນດັບຜູ້ປະຕິບັດງານ</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1">ບັນຊີ</th>
                  <th className="py-1 text-right">ແຖວ</th>
                  <th className="py-1 text-right">ໃບ</th>
                  <th className="py-1 text-right">ມື້</th>
                  <th className="py-1 text-right">ແຖວ/ມື້</th>
                </tr>
              </thead>
              <tbody>
                {r.labor.top.map((o) => (
                  <tr key={o.user_created} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 font-mono text-xs">{o.user_created}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(o.lines)}</td>
                    <td className="py-1 text-right tabular-nums text-zinc-500">{fmt(o.docs)}</td>
                    <td className="py-1 text-right tabular-nums text-zinc-500">{fmt(o.days)}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {o.days > 0 ? fmt(Math.round(o.lines / o.days)) : "—"}
                    </td>
                  </tr>
                ))}
                {r.labor.top.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-xs text-zinc-400">
                      ບໍ່ມີການເຄື່ອນໄຫວໃນຊ່ວງນີ້
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">ຊ່ວງເວລາທີ່ໜັກແໜ້ນ (ຊົ່ວໂມງ)</div>
            <HourBars data={r.labor.by_hour} />
          </div>
        </div>
      </Section>

      {/* ── ພື້ນທີ່ ── */}
      <Section title="ພື້ນທີ່ຈັດເກັບ (Space)">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Location ມີສິນຄ້າ"
            value={`${fmt(r.space.used)} / ${fmt(r.space.locations)}`}
            sub={`ວ່າງ ${fmt(r.space.empty)} ບ່ອນ`}
          />
          <Stat
            label="% ບ່ອນທີ່ໃຊ້ຢູ່"
            value={r.space.locations > 0 ? `${Math.round((r.space.used / r.space.locations) * 100)}%` : "—"}
          />
          <Stat
            label="Location ທີ່ວັດຂະໜາດແລ້ວ"
            value={`${fmt(r.space.with_dims)} / ${fmt(r.space.locations)}`}
            tone={r.space.with_dims < r.space.locations ? "warn" : "ok"}
          />
          <Stat
            label="Rack ທີ່ວັດຂະໜາດແລ້ວ"
            value={`${fmt(r.space.racks_with_dims)} / ${fmt(r.space.racks)}`}
            tone={r.space.racks_with_dims < r.space.racks ? "warn" : "ok"}
            sub="ຕັ້ງໄດ້ໃນໜ້າຈັດການສາງ"
          />
        </div>
      </Section>

      {/* ── ຕໍ່ສາງ ── */}
      <Section title="ທຽບລະຫວ່າງສາງ">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1.5">ສາງ</th>
              <th className="py-1.5 text-right">ຮັບເຂົ້າ</th>
              <th className="py-1.5 text-right">ຈ່າຍອອກ</th>
              <th className="py-1.5 text-right">ແຖວ</th>
              <th className="py-1.5 text-right">ໃບ</th>
              <th className="py-1.5 text-right">ຄົນ</th>
            </tr>
          </thead>
          <tbody>
            {r.warehouses.map((w) => (
              <tr key={w.wh_code} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5">
                  <span className="font-mono text-xs font-semibold">{w.wh_code}</span>{" "}
                  <span className="text-zinc-600 dark:text-zinc-300">{w.wh_name ?? "—"}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmt(w.in_qty)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(w.out_qty)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(w.lines)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-500">{fmt(w.docs)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-500">{fmt(w.users)}</td>
              </tr>
            ))}
            {r.warehouses.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-xs text-zinc-400">
                  ບໍ່ມີການເຄື່ອນໄຫວໃນຊ່ວງນີ້
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ─────────────────────────── ຊິ້ນສ່ວນຂອງໜ້າ ───────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

/** ຕົວເລກພ້ອມ % ປ່ຽນແປງທຽບຊ່ວງກ່ອນ. */
function Kpi({ label, d }: { label: string; d: Delta }) {
  const diff = d.prev === 0 ? (d.now === 0 ? 0 : 100) : ((d.now - d.prev) / d.prev) * 100;
  const up = diff > 0.5;
  const down = diff < -0.5;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt(d.now)}</div>
      <div className="mt-0.5 text-[11px] tabular-nums">
        <span className={up ? "text-emerald-600" : down ? "text-rose-600" : "text-zinc-400"}>
          {up ? "▲" : down ? "▼" : "="} {Math.abs(Math.round(diff))}%
        </span>{" "}
        <span className="text-zinc-400">ທຽບ {fmt(d.prev)}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}

function Row({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-1.5 last:border-b-0 dark:border-zinc-800">
      <dt className="text-zinc-600 dark:text-zinc-300">
        {label}
        {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
      </dt>
      <dd className={`shrink-0 font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

/** ກຣາຟແທ່ງງ່າຍໆ ດ້ວຍ CSS — ບໍ່ຕ້ອງດຶງ library ກຣາຟມາທັງກ້ອນສຳລັບ 24 ແທ່ງ. */
function HourBars({ data }: { data: { hour: number; lines: number }[] }) {
  const max = Math.max(...data.map((d) => d.lines), 1);
  const busiest = data.reduce((a, b) => (b.lines > a.lines ? b : a), data[0]);
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5">
        {data.map((d) => (
          <div
            key={d.hour}
            title={`${String(d.hour).padStart(2, "0")}:00 — ${fmt(d.lines)} ແຖວ`}
            className="flex-1 rounded-t bg-zinc-300 transition hover:bg-zinc-500 dark:bg-zinc-700 dark:hover:bg-zinc-500"
            style={{ height: `${Math.max((d.lines / max) * 100, d.lines > 0 ? 4 : 1)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      {busiest && busiest.lines > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          ໜັກສຸດ {String(busiest.hour).padStart(2, "0")}:00 — {fmt(busiest.lines)} ແຖວ
        </p>
      )}
    </div>
  );
}
