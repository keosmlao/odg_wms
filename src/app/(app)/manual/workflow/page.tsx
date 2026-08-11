import Link from "next/link";
import { Hero, Chip } from "@/components/ui/Card";
import { RouteIcon } from "@/components/ui/Icons";
import { ROLE_BY_ID, WORKFLOWS } from "@/lib/manual";
import { ManualTabs } from "../_components/ManualUI";

/** ລາຍການຂະບວນການທັງໝົດ ພ້ອມສາຍຂັ້ນຕອນຫຍໍ້. */
export default function WorkflowListPage() {
  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຂະບວນການ (Workflow)"
        description="ພາບລວມແຕ່ຕົ້ນຈົນຈົບ — ໃຜເຮັດຫຍັງ ດ້ວຍໜ້າຈໍໃດ ແລະ ເກີດເອກະສານໃດ"
        icon={<RouteIcon className="h-6 w-6" />}
        tone="brand"
        chips={<Chip tone="primary">{WORKFLOWS.length} ຂະບວນການ</Chip>}
      />

      <ManualTabs active="workflow" />

      <div className="grid gap-3 lg:grid-cols-2">
        {WORKFLOWS.map((w) => (
          <Link
            key={w.code}
            href={`/manual/workflow/${w.code}`}
            className="shadow-card group flex flex-col rounded-2xl bg-white p-4 ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-zinc-900 dark:ring-zinc-800"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {w.code}
              </span>
              <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{w.name}</span>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{w.goal}</p>

            <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {w.steps.slice(0, 5).map((s, i) => (
                <span key={s.no} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">›</span>}
                  <span className="rounded bg-zinc-50 px-1.5 py-0.5 dark:bg-zinc-800/60">
                    {s.action.length > 22 ? `${s.action.slice(0, 22)}…` : s.action}
                  </span>
                </span>
              ))}
              {w.steps.length > 5 && <span className="text-zinc-400">+{w.steps.length - 5}</span>}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-3 text-[11px] dark:border-zinc-800">
              <span className="text-zinc-400">ຜູ້ຮັບຜິດຊອບ:</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {ROLE_BY_ID[w.owner]?.name}
              </span>
              <span className="ml-auto text-zinc-400">{w.steps.length} ຂັ້ນຕອນ</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
