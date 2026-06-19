import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice as UiNotice } from "@/components/ui/Card";
import { AlertIcon, BuildingIcon, CalendarIcon, MapPinIcon, PackageIcon } from "@/components/ui/Icons";

const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";
const RECEIVE_TYPE = "ໃບຮັບສິນຄ້າ";

type BalRow = {
  sn: string; qty: string; item_code: string; item_name: string | null; unit_code: string | null;
  wh_code: string; wh_name: string | null; item_brand: string | null; status_name: string | null;
};
type RegRow = {
  isn: string | null; rack: string | null; location: string | null; pallet: string | null;
  registered_at: string | null;
};
type HisRow = {
  wh_code: string; type: string | null; doc_no: string | null; doc_date: string | null;
  qty: string; calc_in_type: string | null; doc_ref: string | null;
};

function ageDays(from: string | null): number | null {
  if (!from) return null;
  const d = new Date(from + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export default async function SerialDetailPage({ params }: { params: Promise<{ sn: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const { sn: rawSn } = await params;
  const sn = decodeURIComponent(rawSn);
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  // Balance (scoped) + registry (sn_inventory holds location + isn + registered date)
  const balArgs: unknown[] = [sn];
  let balScope = "";
  if (Array.isArray(accessible)) {
    balArgs.push(accessible);
    balScope = `AND b.wh_code = ANY($${balArgs.length})`;
  }
  const [balance, reg] = await Promise.all([
    query<BalRow>(
      `SELECT b.sn, b.qty::text AS qty, b.item_code, b.item_name, b.unit_code,
              b.wh_code, b.wh_name, b.item_brand, b.status_name
       FROM public.odg_sn_balance b WHERE b.sn = $1 ${balScope} ORDER BY b.wh_code`,
      balArgs,
    ),
    query<RegRow>(
      `SELECT isn, rack, location, pallet, to_char(create_date_time_now, 'YYYY-MM-DD') AS registered_at
       FROM public.sn_inventory WHERE sn = $1 LIMIT 1`,
      [sn],
    ),
  ]);

  const head = balance[0];
  const registry = reg[0] ?? null;
  const isn = registry?.isn ?? null;

  // History is keyed by ISN in odg_sn_trans_detail (not the maker serial).
  // Provenance crosses warehouses, so we don't scope history by warehouse.
  const history = await query<HisRow>(
    `SELECT t.warehouse AS wh_code, t.type, t.doc_no, to_char(t.doc_date,'YYYY-MM-DD') AS doc_date,
            t.qty::text AS qty, t.calc_in_type, t.doc_ref
     FROM public.odg_sn_trans_detail t
     WHERE t.sn = ANY($1)
     ORDER BY t.doc_date ASC NULLS LAST, t.doc_no ASC`,
    [[sn, isn].filter(Boolean)],
  );

  const itemName = head?.item_name ?? null;
  const itemCode = head?.item_code ?? null;
  const inStock = balance.some((b) => b.status_name === STATUS_INSTOCK);
  const currentWh = head?.wh_code ?? null;

  // Provenance from history (ascending order)
  const ins = history.filter((h) => h.calc_in_type === "1" || h.calc_in_type === "1.0");
  const firstIn = ins[0] ?? null; // earliest stock-in (entry into the company)
  const receive = history.find((h) => h.type === RECEIVE_TYPE) ?? null;
  const transferInCurrent = currentWh
    ? [...history].reverse().find((h) => h.wh_code === currentWh && (h.calc_in_type === "1" || h.calc_in_type === "1.0"))
    : null;
  const entryDate = firstIn?.doc_date ?? registry?.registered_at ?? null;
  const age = ageDays(entryDate);

  return (
    <div className="w-full space-y-4">
      <Link href="/serials" className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        Serial Number
      </Link>

      <header className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Serial</div>
            <div className="break-all font-mono text-xl font-bold text-zinc-900 dark:text-zinc-50">{sn}</div>
            {itemCode && (
              <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-mono text-xs font-semibold text-violet-700 dark:text-violet-300">{itemCode}</span>
                {itemName ? ` · ${itemName}` : ""}
              </div>
            )}
            {isn && <div className="mt-1 text-[11px] text-zinc-500">ISN: <span className="font-mono">{isn}</span></div>}
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${inStock ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
            <span className={`h-2 w-2 rounded-full ${inStock ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {inStock ? "ຄົງເຫຼືອໃນສາງ" : (balance[0]?.status_name ?? "ບໍ່ໃນສາງ")}
          </span>
        </div>
      </header>

      {/* Provenance */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="ມື້ເຂົ້າສະຕ໋ອກ" value={entryDate ?? "—"} sub={firstIn?.type ?? null} icon={<CalendarIcon className="h-4 w-4" />} />
        <InfoCard label="ອາຍຸ (ນັບແຕ່ມື້ເຂົ້າ)" value={age === null ? "—" : `${age.toLocaleString("en-US")} ມື້`} icon={<CalendarIcon className="h-4 w-4" />} />
        <InfoCard
          label={currentWh ? `ມື້ຍ້າຍມາສາງ ${currentWh}` : "ມື້ຍ້າຍມາສາງ"}
          value={transferInCurrent?.doc_date ?? entryDate ?? "—"}
          sub={transferInCurrent ? `${transferInCurrent.type ?? ""} · ${transferInCurrent.doc_no ?? ""}` : null}
          icon={<BuildingIcon className="h-4 w-4" />}
        />
        <InfoCard
          label="ໃບຮັບ / ເອກະສານເຂົ້າ"
          value={(receive?.doc_no ?? firstIn?.doc_no) ?? "—"}
          sub={receive ? RECEIVE_TYPE : (firstIn?.type ?? null)}
          icon={<PackageIcon className="h-4 w-4" />}
        />
      </section>

      {/* Location + balance */}
      <section className="grid gap-3 sm:grid-cols-2">
        {registry && (registry.rack || registry.location || registry.pallet) && (
          <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <MapPinIcon className="h-4 w-4 text-violet-500" /> ບ່ອນຈັດເກັບ
            </div>
            <div className="mt-1.5 font-mono text-sm text-zinc-700 dark:text-zinc-300">
              {[registry.rack, registry.location, registry.pallet ? `plt:${registry.pallet}` : null].filter(Boolean).join(" / ") || "—"}
            </div>
          </div>
        )}
        {balance.map((b) => (
          <div key={b.wh_code} className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <BuildingIcon className="h-4 w-4 text-violet-500" /> {b.wh_code}{b.wh_name ? ` · ${b.wh_name}` : ""}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>{b.item_brand ?? "—"}</span>
              <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">{b.qty} {b.unit_code ?? ""}</span>
            </div>
          </div>
        ))}
      </section>

      {/* History timeline */}
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">ປະຫວັດການເຄື່ອນໄຫວ</h3>
          <p className="text-xs text-zinc-500">{history.length} ລາຍການ</p>
        </div>
        {history.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">ບໍ່ມີປະຫວັດການເຄື່ອນໄຫວ</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[...history].reverse().map((h, i) => {
              const isIn = h.calc_in_type === "1" || h.calc_in_type === "1.0";
              return (
                <li key={`${h.doc_no}-${i}`} className="flex items-center gap-3 px-5 py-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isIn ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"}`}>
                    {isIn ? "↓" : "↑"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{h.type ?? "—"}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500">
                      <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{h.doc_date ?? "—"}</span>
                      <span className="font-mono">{h.doc_no ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{h.wh_code}</span>
                      {h.doc_ref && <span>ref: {h.doc_ref}</span>}
                    </div>
                  </div>
                  <span className={`shrink-0 font-mono text-sm font-bold ${isIn ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{isIn ? "+" : "−"}{h.qty}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function InfoCard({ label, value, sub, icon }: { label: string; value: string; sub?: string | null; icon: React.ReactNode }) {
  return (
    <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span className="text-violet-500">{icon}</span>{label}
      </div>
      <div className="mt-1 font-mono text-sm font-bold text-zinc-900 dark:text-zinc-50">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-zinc-500" title={sub}>{sub}</div>}
    </div>
  );
}
