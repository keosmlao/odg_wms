import Link from "next/link";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Chip, EmptyState } from "@/components/ui/Card";
import {
  BookIcon,
  ClipboardIcon,
  FileTextIcon,
  RouteIcon,
  SearchIcon,
  UsersIcon,
} from "@/components/ui/Icons";
import {
  MANUAL_COUNTS,
  MANUAL_EFFECTIVE,
  MANUAL_OWNER_DEPT,
  MANUAL_VERSION,
  ROLES,
  WORKFLOWS,
  searchManual,
  sectionLabel,
} from "@/lib/manual";
import { ManualSearchBox, ManualTabs } from "./_components/ManualUI";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const CARDS = [
  {
    href: "/manual/workflow",
    label: "ຂະບວນການ (Workflow)",
    desc: "ໃຜ ເຮັດຫຍັງ ຕໍ່ຈາກໃຜ ຕັ້ງແຕ່ຕົ້ນຈົນຈົບ",
    count: MANUAL_COUNTS.workflows,
    icon: <RouteIcon className="h-5 w-5" />,
    tone: "bg-brand-100/80 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
  },
  {
    href: "/manual/sop",
    label: "SOP",
    desc: "ລະບຽບການປະຕິບັດງານມາດຕະຖານ ພ້ອມຈຸດຄວບຄຸມ ແລະ KPI",
    count: MANUAL_COUNTS.sops,
    icon: <ClipboardIcon className="h-5 w-5" />,
    tone: "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    href: "/manual/wi",
    label: "ວິທີເຮັດ (WI)",
    desc: "ຂັ້ນຕອນກົດໃນລະບົບ ຕໍ່ 1 ໜ້າຈໍ — ໃຊ້ໜ້າງານໄດ້ທັນທີ",
    count: MANUAL_COUNTS.wis,
    icon: <BookIcon className="h-5 w-5" />,
    tone: "bg-aqua-100/80 text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300",
  },
  {
    href: "/manual/forms",
    label: "ແບບຟອມ & ເອກະສານ",
    desc: "ທະບຽນເອກະສານ, ຮູບແບບເລກທີ່ ແລະ ໄລຍະການເກັບຮັກສາ",
    count: MANUAL_COUNTS.forms,
    icon: <FileTextIcon className="h-5 w-5" />,
    tone: "bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    href: "/manual/roles",
    label: "ໜ້າທີ່ແຕ່ລະຄົນ",
    desc: "ໜ້າວຽກປະຈຳ, ອຳນາດຕັດສິນໃຈ, ຂໍ້ຫ້າມ ແລະ ຕາຕະລາງ RACI",
    count: MANUAL_COUNTS.roles,
    icon: <UsersIcon className="h-5 w-5" />,
    tone: "bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  },
];

/** ໜ້າຫຼັກຂອງຄູ່ມື — ຄົ້ນຫາລວມ + ທາງເຂົ້າແຕ່ລະໝວດ. */
export default async function ManualHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  const sp = await searchParams;
  const q = one(sp.q);
  const hits = q ? searchManual(q) : [];

  const myRoles = session?.role
    ? ROLES.filter((r) => r.systemRole === session.role)
    : [];

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຄູ່ມືການເຮັດວຽກ WMS"
        description="ຂະບວນການ · SOP · ວິທີເຮັດ · ແບບຟອມ ແລະ ໜ້າທີ່ຂອງແຕ່ລະຄົນ ໃນບ່ອນດຽວ"
        icon={<BookIcon className="h-6 w-6" />}
        tone="brand"
        chips={
          <>
            <Chip tone="primary">ສະບັບ {MANUAL_VERSION}</Chip>
            <Chip>ມີຜົນ {MANUAL_EFFECTIVE}</Chip>
            <Chip>ເຈົ້າຂອງ: {MANUAL_OWNER_DEPT}</Chip>
            {session?.role && <Chip tone="brand">{ROLE_LABEL_LO[session.role]}</Chip>}
          </>
        }
      />

      <ManualTabs active="home" />

      <div className="shadow-card flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        <ManualSearchBox action="/manual" defaultValue={q} />
      </div>

      {q ? (
        hits.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="h-8 w-8" />}
            title={`ບໍ່ພົບ "${q}" ໃນຄູ່ມື`}
            description="ລອງຄົ້ນດ້ວຍລະຫັດ (WF-01, SOP-WH-03, WI-ISS-02, F-10) ຫຼື ຄຳສັບໃນຫົວຂໍ້"
          />
        ) : (
          <div className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              ພົບ {hits.length} ລາຍການ
            </div>
            <ul>
              {hits.map((h) => (
                <li key={`${h.section}-${h.code}`} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
                  <Link
                    href={h.href}
                    className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="mt-0.5 shrink-0 rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {h.code}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {h.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {sectionLabel(h.section)} · {h.sub}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CARDS.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="shadow-card group flex items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-zinc-900 dark:ring-zinc-800"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.tone}`}>
                  {c.icon}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{c.label}</span>
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {c.count}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{c.desc}</span>
                </span>
              </Link>
            ))}
          </section>

          {myRoles.length > 0 && (
            <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">ໜ້າທີ່ທີ່ກ່ຽວກັບບັນຊີຂອງທ່ານ</h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                ຕຳແໜ່ງງານທີ່ໃຊ້ສິດລະດັບ {ROLE_LABEL_LO[session!.role!]}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {myRoles.map((r) => (
                  <Link
                    key={r.id}
                    href={`/manual/roles/${r.id}`}
                    className="rounded-xl bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-white dark:bg-zinc-800/60 dark:text-zinc-200 dark:ring-zinc-700"
                  >
                    {r.code} · {r.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <header className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">ຂະບວນການທັງໝົດ</h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                ເລີ່ມອ່ານຈາກຂະບວນການ ແລ້ວຄ່ອຍລົງໄປ SOP ແລະ ວິທີເຮັດ
              </p>
            </header>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {WORKFLOWS.map((w) => (
                <li key={w.code}>
                  <Link
                    href={`/manual/workflow/${w.code}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {w.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{w.name}</span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{w.goal}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-zinc-400 sm:block">{w.steps.length} ຂັ້ນຕອນ</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
