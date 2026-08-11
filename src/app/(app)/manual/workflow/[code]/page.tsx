import { notFound } from "next/navigation";
import { Hero, Chip } from "@/components/ui/Card";
import { RouteIcon } from "@/components/ui/Icons";
import {
  MANUAL_EFFECTIVE,
  MANUAL_VERSION,
  ROLE_BY_ID,
  WORKFLOWS,
  WORKFLOW_BY_CODE,
} from "@/lib/manual";
import {
  BackLink,
  Bullets,
  KpiRow,
  MetaGrid,
  NumberedSteps,
  PairTable,
  RefLinks,
  RoleBadge,
  ScreenLink,
  Section,
} from "../../_components/ManualUI";
import PrintButton from "../../_components/PrintButton";

export function generateStaticParams() {
  return WORKFLOWS.map((w) => ({ code: w.code }));
}

/** ລາຍລະອຽດ 1 ຂະບວນການ. */
export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const wf = WORKFLOW_BY_CODE.get(decodeURIComponent(code).toUpperCase());
  if (!wf) notFound();

  return (
    <div className="w-full space-y-5">
      <BackLink href="/manual/workflow" label="ກັບໄປລາຍການຂະບວນການ" />

      <div className="print-sheet space-y-5">
        <Hero
          title={`${wf.code} · ${wf.name}`}
          description={wf.goal}
          icon={<RouteIcon className="h-6 w-6" />}
          tone={wf.tone === "neutral" ? "brand" : wf.tone}
          chips={
            <>
              <Chip tone="primary">ສະບັບ {MANUAL_VERSION}</Chip>
              <Chip>ມີຜົນ {MANUAL_EFFECTIVE}</Chip>
              <Chip tone="brand">ຜູ້ຮັບຜິດຊອບ: {ROLE_BY_ID[wf.owner]?.name}</Chip>
            </>
          }
          right={<PrintButton />}
        />

        <Section title="ຂໍ້ມູນທົ່ວໄປ">
          <MetaGrid
            items={[
              { label: "ຈຸດເລີ່ມ (Trigger)", value: wf.trigger },
              { label: "ຂອບເຂດ", value: wf.scope },
              {
                label: "ຜູ້ກ່ຽວຂ້ອງ",
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    {wf.roles.map((r) => (
                      <RoleBadge key={r} id={r} />
                    ))}
                  </span>
                ),
              },
              { label: "ຜົນທີ່ໄດ້", value: wf.outputs.join(" · ") },
              { label: "SOP ທີ່ກ່ຽວຂ້ອງ", value: <RefLinks codes={wf.sops} /> },
              { label: "ເອກະສານທີ່ໃຊ້", value: <RefLinks codes={wf.forms} /> },
            ]}
          />
        </Section>

        <Section title="ຂັ້ນຕອນ" hint="ຂັ້ນຕອນຕາມລຳດັບ ພ້ອມຜູ້ຮັບຜິດຊອບ ແລະ ຈຸດຄວບຄຸມ">
          <NumberedSteps
            steps={wf.steps.map((s) => ({
              no: s.no,
              title: (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{s.action}</span>
                  <RoleBadge id={s.role} />
                  {s.screen && <ScreenLink screen={s.screen} />}
                  {s.form && <RefLinks codes={[s.form]} />}
                </span>
              ),
              body: (
                <>
                  {s.detail && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.detail}</p>
                  )}
                  {s.control && (
                    <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/50">
                      ຈຸດຄວບຄຸມ: {s.control}
                    </p>
                  )}
                </>
              ),
            }))}
          />
        </Section>

        <Section title="ກໍລະນີຜິດປົກກະຕິ ແລະ ວິທີຮັບມື">
          <PairTable
            head={["ກໍລະນີ", "ດຳເນີນການ"]}
            rows={wf.exceptions.map((e) => [e.case, e.action])}
          />
        </Section>

        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="ວິທີເຮັດ (WI) ທີ່ໃຊ້ໃນຂະບວນການນີ້">
            <RefLinks codes={wf.wis} empty="ບໍ່ມີ" />
          </Section>
          <Section title="ຕົວຊີ້ວັດ (KPI)">
            {wf.kpis.length ? (
              <KpiRow items={wf.kpis} />
            ) : (
              <Bullets items={["ຍັງບໍ່ໄດ້ກຳນົດ"]} />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
