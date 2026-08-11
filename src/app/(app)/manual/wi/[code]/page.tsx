import { notFound } from "next/navigation";
import { Hero, Chip } from "@/components/ui/Card";
import { BookIcon } from "@/components/ui/Icons";
import { WI_BY_CODE, WORK_INSTRUCTIONS } from "@/lib/manual";
import {
  BackLink,
  Bullets,
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
  return WORK_INSTRUCTIONS.map((w) => ({ code: w.code }));
}

/** ລາຍລະອຽດ 1 ວິທີເຮັດ. */
export default async function WiDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const wi = WI_BY_CODE.get(decodeURIComponent(code).toUpperCase());
  if (!wi) notFound();

  return (
    <div className="w-full space-y-5">
      <BackLink href="/manual/wi" label="ກັບໄປລາຍການວິທີເຮັດ" />

      <div className="print-sheet space-y-5">
        <Hero
          title={`${wi.code} · ${wi.title}`}
          description={`ໝວດ ${wi.group} — ໜ້າຈໍ: ${wi.screen.label}`}
          icon={<BookIcon className="h-6 w-6" />}
          tone="aqua"
          chips={
            <>
              <Chip tone="primary">{wi.steps.length} ຂັ້ນຕອນ</Chip>
              <Chip>SOP {wi.sop}</Chip>
            </>
          }
          right={<PrintButton />}
        />

        <Section title="ກ່ອນເລີ່ມ">
          <MetaGrid
            items={[
              {
                label: "ຜູ້ປະຕິບັດ",
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    {wi.actors.map((a) => (
                      <RoleBadge key={a} id={a} />
                    ))}
                  </span>
                ),
              },
              { label: "ໜ້າຈໍ", value: <ScreenLink screen={wi.screen} /> },
              { label: "SOP ອ້າງອີງ", value: <RefLinks codes={[wi.sop]} /> },
            ]}
          />
          <div className="mt-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              ເງື່ອນໄຂກ່ອນເຮັດ
            </div>
            <div className="mt-1">
              {wi.prerequisites.length ? (
                <Bullets items={wi.prerequisites} />
              ) : (
                <span className="text-sm text-zinc-400">ບໍ່ມີ</span>
              )}
            </div>
          </div>
        </Section>

        <Section title="ຂັ້ນຕອນ">
          <NumberedSteps
            steps={wi.steps.map((s) => ({
              no: s.no,
              title: s.action,
              body: (
                <>
                  {s.expect && (
                    <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/50">
                      ຜົນທີ່ຄວນເຫັນ: {s.expect}
                    </p>
                  )}
                  {s.warn && (
                    <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/50">
                      ລະວັງ: {s.warn}
                    </p>
                  )}
                </>
              ),
            }))}
          />
        </Section>

        <Section title="ບັນຫາທີ່ພົບເລື້ອຍ">
          <PairTable
            head={["ບັນຫາ", "ວິທີແກ້"]}
            rows={wi.issues.map((i) => [i.problem, i.fix])}
          />
        </Section>

        {wi.forms && wi.forms.length > 0 && (
          <Section title="ເອກະສານທີ່ກ່ຽວຂ້ອງ">
            <RefLinks codes={wi.forms} />
          </Section>
        )}
      </div>
    </div>
  );
}
