import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
import CountSheetWizard from "../../CountSheetWizard";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewCountSheetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ" />;
  }

  const params = await searchParams;
  const po = (Array.isArray(params.po) ? params.po[0] : params.po)?.trim() ?? "";
  const wh = (Array.isArray(params.wh) ? params.wh[0] : params.wh)?.trim() ?? "";
  if (!po && !wh) redirect("/movements/receive");

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ສ້າງໃບກວດນັບ"
        description="ດຶງລາຍການຈາກ PO (1 ຫຼື ຫຼາຍ PO) ປ້ອນຈຳນວນ + ໃສ່ SN ແລ້ວບັນທຶກ"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="emerald"
      />
      <Link href="/movements/receive" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">← ກັບໄປລາຍການຄ້າງຮັບ</Link>
      <CountSheetWizard po={po} wh={wh} />
    </div>
  );
}
