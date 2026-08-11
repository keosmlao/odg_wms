import { notFound } from "next/navigation";
import { Hero, Chip } from "@/components/ui/Card";
import { ClipboardIcon } from "@/components/ui/Icons";
import {
  MANUAL_EFFECTIVE,
  MANUAL_VERSION,
  ROLE_BY_ID,
  SOPS,
  SOP_BY_CODE,
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
  Section,
} from "../../_components/ManualUI";
import PrintButton from "../../_components/PrintButton";

export function generateStaticParams() {
  return SOPS.map((s) => ({ code: s.code }));
}

/** ລາຍລະອຽດ 1 SOP — ຮູບແບບເອກະສານມາດຕະຖານ (ພິມໄດ້). */
export default async function SopDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const sop = SOP_BY_CODE.get(decodeURIComponent(code).toUpperCase());
  if (!sop) notFound();

  return (
    <div className="w-full space-y-5">
      <BackLink href="/manual/sop" label="ກັບໄປທະບຽນ SOP" />

      <div className="print-sheet space-y-5">
        <Hero
          title={`${sop.code} · ${sop.title}`}
          description={sop.purpose}
          icon={<ClipboardIcon className="h-6 w-6" />}
          tone={sop.tone === "neutral" ? "emerald" : sop.tone}
          chips={
            <>
              <Chip tone="primary">ສະບັບ {MANUAL_VERSION}</Chip>
              <Chip>ມີຜົນ {MANUAL_EFFECTIVE}</Chip>
              <Chip tone="brand">ເຈົ້າຂອງ: {ROLE_BY_ID[sop.owner]?.name}</Chip>
              {sop.workflow && <Chip>ຂະບວນການ {sop.workflow}</Chip>}
            </>
          }
          right={<PrintButton />}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="1. ຂອບເຂດ">
            <Bullets items={sop.scope} />
          </Section>
          <Section title="2. ນິຍາມ">
            <PairTable
              head={["ຄຳສັບ", "ຄວາມໝາຍ"]}
              rows={sop.definitions.map((d) => [d.term, d.meaning])}
            />
          </Section>
        </div>

        <Section title="3. ໜ້າທີ່ ແລະ ຄວາມຮັບຜິດຊອບ">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="w-1/3 px-2 py-1.5">ຜູ້ຮັບຜິດຊອບ</th>
                  <th className="px-2 py-1.5">ໜ້າທີ່ໃນ SOP ນີ້</th>
                </tr>
              </thead>
              <tbody>
                {sop.responsibilities.map((r) => (
                  <tr key={r.role} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="px-2 py-2">
                      <RoleBadge id={r.role} />
                    </td>
                    <td className="px-2 py-2 text-zinc-600 dark:text-zinc-400">{r.duty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="4. ຂັ້ນຕອນປະຕິບັດ">
          <NumberedSteps
            steps={sop.procedure.map((p) => ({
              no: p.no,
              title: (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{p.title}</span>
                  <RoleBadge id={p.actor} />
                </span>
              ),
              body: (
                <>
                  <Bullets items={p.steps} />
                  {p.wis && p.wis.length > 0 && (
                    <div className="pt-1">
                      <RefLinks codes={p.wis} />
                    </div>
                  )}
                </>
              ),
            }))}
          />
        </Section>

        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="5. ຈຸດຄວບຄຸມ (Controls)">
            <Bullets items={sop.controls} tone="red" />
          </Section>
          <Section title="6. ບັນທຶກ / ເອກະສານ">
            <RefLinks codes={sop.records} empty="ບໍ່ມີ" />
          </Section>
        </div>

        <Section title="7. ຕົວຊີ້ວັດ (KPI)">
          <KpiRow items={sop.kpis} />
        </Section>

        <Section title="8. ເອກະສານອ້າງອີງ">
          <MetaGrid
            items={[
              {
                label: "ຂະບວນການ",
                value: sop.workflow ? <RefLinks codes={[sop.workflow]} /> : "—",
              },
              {
                label: "ວິທີເຮັດທີ່ກ່ຽວຂ້ອງ",
                value: (
                  <RefLinks
                    codes={sop.procedure.flatMap((p) => p.wis ?? [])}
                    empty="ບໍ່ມີ"
                  />
                ),
              },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
