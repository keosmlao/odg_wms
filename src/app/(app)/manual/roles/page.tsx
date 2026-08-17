import Link from "next/link";
import { Hero, Chip } from "@/components/ui/Card";
import { UsersIcon } from "@/components/ui/Icons";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { ROLES, WORKFLOWS, raciFor } from "@/lib/manual";
import { ManualTabs, Section } from "../_components/ManualUI";
import PrintButton from "../_components/PrintButton";

const RACI_TONE: Record<string, string> = {
  A: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  R: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  C: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** ລາຍຊື່ຕຳແໜ່ງ + ຕາຕະລາງ RACI ຕໍ່ຂະບວນການ. */
export default function RolesPage() {
  const internal = ROLES.filter((r) => !r.external);
  const external = ROLES.filter((r) => r.external);

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ໜ້າທີ່ຂອງແຕ່ລະຄົນ"
        description="ຕຳແໜ່ງງານ, ໜ້າວຽກປະຈຳ, ອຳນາດຕັດສິນໃຈ, ຂໍ້ຫ້າມ ແລະ ຄວາມສຳພັນກັບແຕ່ລະຂະບວນການ"
        icon={<UsersIcon className="h-6 w-6" />}
        tone="red"
        chips={<Chip tone="primary">{ROLES.length} ຕຳແໜ່ງ</Chip>}
        right={<PrintButton label="ພິມ" />}
      />

      <ManualTabs active="roles" />

      <Section title="ພະນັກງານສາງ" hint="ຕຳແໜ່ງພາຍໃນພະແນກສາງ ພ້ອມລະດັບສິດທີ່ໃຊ້ໃນລະບົບ">
        <div className="grid gap-2 lg:grid-cols-2">
          {internal.map((r) => (
            <Link
              key={r.id}
              href={`/manual/roles/${r.id}`}
              className="group rounded-2xl border border-zinc-200 p-3.5 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.code}
                </span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{r.name}</span>
                <span className="text-xs text-zinc-400">{r.en}</span>
                <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                  {r.systemRole ? ROLE_LABEL_LO[r.systemRole] : "ບໍ່ມີບັນຊີ WMS"}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{r.purpose}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="ຜູ້ກ່ຽວຂ້ອງນອກພະແນກສາງ">
        <div className="grid gap-2 lg:grid-cols-2">
          {external.map((r) => (
            <Link
              key={r.id}
              href={`/manual/roles/${r.id}`}
              className="rounded-2xl border border-dashed border-zinc-200 p-3.5 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.code}
                </span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{r.name}</span>
                <span className="text-xs text-zinc-400">{r.en}</span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{r.purpose}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title="ຕາຕະລາງ RACI"
        hint="A = ຮັບຜິດຊອບສຸດທ້າຍ · R = ລົງມືເຮັດ · C = ກ່ຽວຂ້ອງ/ຖືກປຶກສາ"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="sticky left-0 bg-white px-2 py-1.5 dark:bg-zinc-900">ຂະບວນການ</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="px-1.5 py-1.5 text-center">
                    <span className="block whitespace-nowrap text-[10px]">{r.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORKFLOWS.map((w) => (
                <tr key={w.code} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="sticky left-0 bg-white px-2 py-2 dark:bg-zinc-900">
                    <Link
                      href={`/manual/workflow/${w.code}`}
                      className="block whitespace-nowrap text-xs font-semibold text-zinc-800 hover:underline dark:text-zinc-200"
                    >
                      <span className="font-mono text-[11px] text-zinc-400">{w.code}</span> {w.name}
                    </Link>
                  </td>
                  {ROLES.map((r) => {
                    const mark = raciFor(w.code, r.id);
                    return (
                      <td key={r.id} className="px-1.5 py-2 text-center">
                        {mark ? (
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${RACI_TONE[mark]}`}
                          >
                            {mark}
                          </span>
                        ) : (
                          <span className="text-zinc-200 dark:text-zinc-700">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">
          ລະຫັດຕຳແໜ່ງ: {ROLES.map((r) => `${r.code} ${r.name}`).join(" · ")}
        </p>
      </Section>
    </div>
  );
}
