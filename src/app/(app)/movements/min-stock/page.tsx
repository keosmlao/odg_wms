import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { enabledMinStockWarehouses, minStockAlerts, minStockSummary } from "@/lib/minStock";
import { Hero, Notice, Chip, KpiCard, EmptyState } from "@/components/ui/Card";
import { AlertIcon, PackageIcon, TrendIcon, BuildingIcon } from "@/components/ui/Icons";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * ລາຍງານ stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ — ສະເພາະສາງທີ່ເປີດຄຸມໃນ /settings/min-stock.
 * ຮຸນແຮງສຸດຢູ່ເທິງ (ຕ່ຳກວ່າຂັ້ນຕ່ຳ ຕາມສັດສ່ວນທີ່ຂາດ).
 */
export default async function MinStockReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const accessible = accessibleWarehouses(session); // null = ທຸກສາງ
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const sp = await searchParams;
  const whFilter = one(sp.wh);
  const only = one(sp.only) === "below" ? "below" : one(sp.only) === "above" ? "above" : "all";

  // ສາງທີ່ເປີດຄຸມ ∩ ສາງທີ່ຜູ້ໃຊ້ເຂົ້າເຖິງໄດ້ ∩ ຕົວກັ່ນຕອງ
  const enabled = await enabledMinStockWarehouses(accessible);
  const scope = whFilter ? enabled.filter((c) => c === whFilter) : enabled;

  const [summary, alerts, whNames] = await Promise.all([
    minStockSummary(scope),
    minStockAlerts(scope, { only, limit: 500 }),
    enabled.length
      ? query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
          [enabled],
        )
      : Promise.resolve([]),
  ]);

  return (
    <div className="w-full space-y-5">
      <Hero
        title="stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ"
        description="ສິນຄ້າທີ່ຄົງເຫຼືອຕ່ຳກວ່າຂັ້ນຕ່ຳ (ຕ້ອງເຕີມ) ຫຼື ເກີນຂັ້ນສູງ (ຄ້າງຫຼາຍ)"
        icon={<TrendIcon className="h-6 w-6" />}
        tone="amber"
        chips={
          <>
            <Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>
            <Chip>
              <BuildingIcon className="h-3.5 w-3.5" />
              {summary.warehouses} ສາງທີ່ຄຸມ
            </Chip>
          </>
        }
      />

      {enabled.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-8 w-8" />}
          title="ຍັງບໍ່ມີສາງໃດເປີດຄຸມ stock ຂັ້ນຕ່ຳ"
          description="ຜູ້ຈັດການເປີດການຄຸມ ແລະ ຕັ້ງຄ່າ min/max ໄດ້ທີ່ ການຕັ້ງຄ່າ › stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ"
          action={
            session.role === "manager" ? (
              <Link
                href="/settings/min-stock"
                className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg"
              >
                ໄປໜ້າຕັ້ງຄ່າ
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<AlertIcon className="h-4 w-4" />}
              label="ຕ່ຳກວ່າຂັ້ນຕ່ຳ"
              value={summary.below}
              sub="ຕ້ອງເຕີມສິນຄ້າ"
              tone="red"
              highlight
            />
            <KpiCard
              icon={<TrendIcon className="h-4 w-4" />}
              label="ເກີນຂັ້ນສູງ"
              value={summary.above}
              sub="ຄ້າງເກີນແຜນ"
              tone="amber"
              highlight
            />
            <KpiCard icon={<PackageIcon className="h-4 w-4" />} label="ລາຍການທີ່ຄຸມ" value={summary.rules} />
            <KpiCard icon={<BuildingIcon className="h-4 w-4" />} label="ສາງທີ່ຄຸມ" value={summary.warehouses} />
          </section>

          <form
            method="get"
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <select
              name="wh"
              defaultValue={whFilter}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">ທຸກສາງທີ່ຄຸມ</option>
              {whNames.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} · {w.name ?? ""}
                </option>
              ))}
            </select>
            <select
              name="only"
              defaultValue={only}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="all">ທັງໝົດ (ຕ່ຳ + ເກີນ)</option>
              <option value="below">ສະເພາະຕ່ຳກວ່າຂັ້ນຕ່ຳ</option>
              <option value="above">ສະເພາະເກີນຂັ້ນສູງ</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              ກັ່ນຕອງ
            </button>
            {session.role === "manager" && (
              <Link
                href="/settings/min-stock"
                className="ml-auto text-xs font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
              >
                ຕັ້ງຄ່າ min/max
              </Link>
            )}
          </form>

          {alerts.length === 0 ? (
            <EmptyState
              icon={<PackageIcon className="h-8 w-8" />}
              title="ບໍ່ມີລາຍການທີ່ຕ້ອງເຕືອນ"
              description="ທຸກລາຍການທີ່ຄຸມຢູ່ໃນລະດັບທີ່ກຳນົດໄວ້"
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2">ສະຖານະ</th>
                      <th className="px-3 py-2">ສາງ</th>
                      <th className="px-3 py-2">ສິນຄ້າ</th>
                      <th className="px-3 py-2 text-right">ຄົງເຫຼືອ</th>
                      <th className="px-3 py-2 text-right">ຂັ້ນຕ່ຳ</th>
                      <th className="px-3 py-2 text-right">ຂັ້ນສູງ</th>
                      <th className="px-3 py-2 text-right">ຕ້ອງເຕີມ / ເກີນ</th>
                      <th className="px-3 py-2">ໝາຍເຫດ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((r) => (
                      <tr key={`${r.wh_code}|${r.item_code}`} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2">
                          {r.status === "below" ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                              ຕ່ຳກວ່າ
                            </span>
                          ) : (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              ເກີນ
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="font-mono font-bold">{r.wh_code}</span>
                          <div className="max-w-[10rem] truncate">{r.wh_name ?? ""}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">{r.item_code}</div>
                          <div className="max-w-md truncate text-zinc-800 dark:text-zinc-200" title={r.item_name ?? ""}>
                            {r.item_name ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                          {fmt(r.on_hand)}
                          <span className="ml-1 text-[10px] font-normal text-zinc-400">{r.unit_code ?? ""}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                          {fmt(r.min_qty)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                          {r.max_qty === null ? "—" : fmt(r.max_qty)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                          {r.status === "below" ? (
                            <span className="text-rose-600 dark:text-rose-400">+{fmt(r.shortfall)}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">−{fmt(r.excess)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{r.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {alerts.length >= 500 && (
                <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                  ສະແດງ 500 ລາຍການທຳອິດ — ກັ່ນຕອງຕາມສາງເພື່ອເບິ່ງທີ່ເຫຼືອ
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
