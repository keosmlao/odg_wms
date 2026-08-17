import Link from "next/link";
import { notFound } from "next/navigation";
import { Hero, Chip } from "@/components/ui/Card";
import { UsersIcon } from "@/components/ui/Icons";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { ROLES, ROLE_BY_ID, WORKFLOWS, raciFor, type RoleId } from "@/lib/manual";
import {
  BackLink,
  Bullets,
  KpiRow,
  MetaGrid,
  RefLinks,
  ScreenLink,
  Section,
} from "../../_components/ManualUI";
import PrintButton from "../../_components/PrintButton";

export function generateStaticParams() {
  return ROLES.map((r) => ({ id: r.id }));
}

const RACI_LABEL: Record<string, string> = {
  A: "ຮັບຜິດຊອບສຸດທ້າຍ",
  R: "ລົງມືເຮັດ",
  C: "ກ່ຽວຂ້ອງ",
};

/** ລາຍລະອຽດໜ້າທີ່ຂອງ 1 ຕຳແໜ່ງ. */
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = ROLE_BY_ID[decodeURIComponent(id) as RoleId];
  if (!role) notFound();

  const involved = WORKFLOWS.map((w) => ({ wf: w, mark: raciFor(w.code, role.id) })).filter(
    (x) => x.mark !== null,
  );

  return (
    <div className="w-full space-y-5">
      <BackLink href="/manual/roles" label="ກັບໄປລາຍຊື່ຕຳແໜ່ງ" />

      <div className="print-sheet space-y-5">
        <Hero
          title={`${role.code} · ${role.name}`}
          description={role.purpose}
          icon={<UsersIcon className="h-6 w-6" />}
          tone={role.external ? "navy" : "red"}
          chips={
            <>
              <Chip tone="primary">{role.en}</Chip>
              <Chip>
                ສິດໃນລະບົບ: {role.systemRole ? ROLE_LABEL_LO[role.systemRole] : "ບໍ່ມີບັນຊີ WMS"}
              </Chip>
              <Chip>ຂຶ້ນກັບ: {role.reportsTo}</Chip>
              {role.external && <Chip tone="navy">ນອກພະແນກສາງ</Chip>}
            </>
          }
          right={<PrintButton />}
        />

        <Section title="ໜ້າວຽກປະຈຳ" hint="ແບ່ງຕາມຊ່ວງເວລາ ໃຫ້ໃຊ້ເປັນລາຍການກວດປະຈຳວັນໄດ້">
          <div className="grid gap-3 lg:grid-cols-2">
            {role.duties.map((d) => (
              <div
                key={d.when}
                className="rounded-2xl border border-zinc-200 p-3.5 dark:border-zinc-800"
              >
                <div className="text-xs font-bold uppercase tracking-wide text-zinc-400">{d.when}</div>
                <div className="mt-2">
                  <Bullets items={d.items} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="ອຳນາດຕັດສິນໃຈ">
            <Bullets items={role.authority} tone="emerald" />
          </Section>
          <Section title="ຂໍ້ຫ້າມ">
            <Bullets items={role.forbidden} tone="red" />
          </Section>
        </div>

        <Section title="ໜ້າຈໍທີ່ໃຊ້ປະຈຳ">
          <div className="flex flex-wrap gap-2">
            {role.screens.map((s) => (
              <ScreenLink key={s.href + s.label} screen={s} />
            ))}
          </div>
        </Section>

        <Section title="ຄວາມສຳພັນກັບຂະບວນການ">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-2 py-1.5">ຂະບວນການ</th>
                  <th className="px-2 py-1.5">ບົດບາດ</th>
                  <th className="px-2 py-1.5">ຂັ້ນຕອນທີ່ຕ້ອງເຮັດ</th>
                </tr>
              </thead>
              <tbody>
                {involved.map(({ wf, mark }) => {
                  const mine = wf.steps.filter((s) => s.role === role.id);
                  return (
                    <tr key={wf.code} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="px-2 py-2">
                        <Link
                          href={`/manual/workflow/${wf.code}`}
                          className="font-semibold text-zinc-800 hover:underline dark:text-zinc-200"
                        >
                          <span className="font-mono text-[11px] text-zinc-400">{wf.code}</span> {wf.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {mark} · {RACI_LABEL[mark as string]}
                      </td>
                      <td className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {mine.length ? (
                          <ul className="space-y-1">
                            {mine.map((s) => (
                              <li key={s.no}>
                                {s.no}. {s.action}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="ຕົວຊີ້ວັດ (KPI)">
            <KpiRow items={role.kpis} />
          </Section>
          <Section title="SOP ທີ່ຕ້ອງຮູ້">
            <RefLinks codes={role.sops} />
          </Section>
        </div>

        <Section title="ສະຫຼຸບ">
          <MetaGrid
            items={[
              { label: "ຂຶ້ນກັບ", value: role.reportsTo },
              {
                label: "ສິດໃນລະບົບ WMS",
                value: role.systemRole ? ROLE_LABEL_LO[role.systemRole] : "ບໍ່ມີບັນຊີ",
              },
              { label: "ຈຳນວນຂະບວນການທີ່ກ່ຽວຂ້ອງ", value: `${involved.length} ຂະບວນການ` },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
