import Link from "next/link";
import { Hero, Chip } from "@/components/ui/Card";
import { FileTextIcon } from "@/components/ui/Icons";
import { FORMS, ROLE_BY_ID, type FormKind } from "@/lib/manual";
import { ManualTabs, RefLinks, ScreenLink, Section } from "../_components/ManualUI";
import PrintButton from "../_components/PrintButton";

const KIND_TONE: Record<FormKind, string> = {
  ລະບົບ: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900/50",
  ພິມ: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/50",
  Excel:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/50",
  ERP: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
};

/** ທະບຽນແບບຟອມ ແລະ ເອກະສານ — ຕາຕະລາງລວມ + ບັດລາຍລະອຽດຕໍ່ເອກະສານ. */
export default function FormsPage() {
  return (
    <div className="w-full space-y-5">
      <Hero
        title="ແບບຟອມ & ເອກະສານ"
        description="ທຸກເອກະສານທີ່ໃຊ້ ຫຼື ເກີດຂຶ້ນໃນຂະບວນການສາງ ພ້ອມເຈົ້າຂອງ ແລະ ໄລຍະເກັບຮັກສາ"
        icon={<FileTextIcon className="h-6 w-6" />}
        tone="amber"
        chips={<Chip tone="primary">{FORMS.length} ເອກະສານ</Chip>}
        right={<PrintButton label="ພິມທະບຽນ" />}
      />

      <ManualTabs active="forms" />

      <Section title="ທະບຽນລວມ" hint="ກົດລະຫັດ ເພື່ອລົງໄປເບິ່ງລາຍລະອຽດຂ້າງລຸ່ມ">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="px-2 py-1.5">ລະຫັດ</th>
                <th className="px-2 py-1.5">ຊື່ເອກະສານ</th>
                <th className="px-2 py-1.5">ປະເພດ</th>
                <th className="px-2 py-1.5">ເລກທີ່</th>
                <th className="px-2 py-1.5">ເຈົ້າຂອງ</th>
                <th className="px-2 py-1.5">ເກັບ</th>
              </tr>
            </thead>
            <tbody>
              {FORMS.map((f) => (
                <tr key={f.code} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="px-2 py-2">
                    <Link
                      href={`#${f.code}`}
                      className="font-mono text-xs font-bold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {f.code}
                    </Link>
                  </td>
                  <td className="px-2 py-2 font-medium text-zinc-800 dark:text-zinc-200">{f.name}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${KIND_TONE[f.kind]}`}
                    >
                      {f.kind}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {f.docNo ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {ROLE_BY_ID[f.owner]?.name}
                  </td>
                  <td className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">{f.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        {FORMS.map((f) => (
          <section
            key={f.code}
            id={f.code}
            className="shadow-card scroll-mt-20 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {f.code}
              </span>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{f.name}</h2>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${KIND_TONE[f.kind]}`}
              >
                {f.kind}
              </span>
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <dt className="w-24 shrink-0 text-xs text-zinc-400">ໃຊ້ເມື່ອ</dt>
                <dd className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">{f.when}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-24 shrink-0 text-xs text-zinc-400">ເກີດຢູ່</dt>
                <dd className="min-w-0 flex-1">
                  <ScreenLink screen={f.source} />
                </dd>
              </div>
              {f.docNo && (
                <div className="flex flex-wrap gap-2">
                  <dt className="w-24 shrink-0 text-xs text-zinc-400">ຮູບແບບເລກ</dt>
                  <dd className="min-w-0 flex-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {f.docNo}
                  </dd>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <dt className="w-24 shrink-0 text-xs text-zinc-400">ຂໍ້ມູນສຳຄັນ</dt>
                <dd className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400">
                  {f.fields.join(" · ")}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-24 shrink-0 text-xs text-zinc-400">SOP</dt>
                <dd className="min-w-0 flex-1">
                  <RefLinks codes={f.sops} />
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-24 shrink-0 text-xs text-zinc-400">ເກັບຮັກສາ</dt>
                <dd className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400">{f.retention}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
