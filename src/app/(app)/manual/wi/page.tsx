import Link from "next/link";
import { Hero, Chip, EmptyState } from "@/components/ui/Card";
import { BookIcon, SearchIcon } from "@/components/ui/Icons";
import { WI_GROUPS, WORK_INSTRUCTIONS } from "@/lib/manual";
import { ManualSearchBox, ManualTabs, ScreenLink } from "../_components/ManualUI";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** ລາຍການວິທີເຮັດ ຈັດເປັນໝວດຕາມໜ້າວຽກ. */
export default async function WiListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = one(sp.q).toLowerCase();

  const items = q
    ? WORK_INSTRUCTIONS.filter((w) =>
        `${w.code} ${w.title} ${w.group} ${w.screen.label}`.toLowerCase().includes(q),
      )
    : WORK_INSTRUCTIONS;

  const groups = WI_GROUPS.map((g) => ({
    group: g,
    items: items.filter((w) => w.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ວິທີເຮັດ (Work Instruction)"
        description="ຂັ້ນຕອນກົດໃນລະບົບ ຕໍ່ 1 ໜ້າຈໍ — ພິມໄປໃຊ້ໜ້າງານໄດ້"
        icon={<BookIcon className="h-6 w-6" />}
        tone="aqua"
        chips={<Chip tone="primary">{WORK_INSTRUCTIONS.length} ລາຍການ</Chip>}
      />

      <ManualTabs active="wi" />

      <div className="shadow-card flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        <ManualSearchBox action="/manual/wi" defaultValue={one(sp.q)} placeholder="ຄົ້ນຫາວິທີເຮັດ…" />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-8 w-8" />}
          title="ບໍ່ພົບວິທີເຮັດທີ່ຄົ້ນຫາ"
          description="ລອງຄົ້ນດ້ວຍຊື່ໜ້າຈໍ ເຊັ່ນ ຈ່າຍ, ຮັບ, pallet, ນັບ"
        />
      ) : (
        groups.map((g) => (
          <section key={g.group} className="space-y-2">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{g.group}</h2>
            <div className="grid gap-2 lg:grid-cols-2">
              {g.items.map((w) => (
                <div
                  key={w.code}
                  className="shadow-card rounded-2xl bg-white p-3.5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/manual/wi/${w.code}`}
                      className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {w.code}
                    </Link>
                    <Link
                      href={`/manual/wi/${w.code}`}
                      className="text-sm font-bold text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {w.title}
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ScreenLink screen={w.screen} />
                    <span className="text-[11px] text-zinc-400">{w.steps.length} ຂັ້ນຕອນ</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
