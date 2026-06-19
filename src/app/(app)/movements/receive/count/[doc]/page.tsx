import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
import CountSheetDetail from "../../CountSheetDetail";

export default async function CountSheetPage({ params }: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }
  const { doc } = await params;
  const docNo = decodeURIComponent(doc).trim();

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ໃບກວດນັບ"
        description="ກວດ/ແກ້ໄຂ ລາຍການ + SN ແລ້ວ ຮັບເຂົ້າ WMS"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="emerald"
      />
      <Link href="/movements/receive?tab=count" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">← ກັບໄປລາຍການໃບກວດນັບ</Link>
      <CountSheetDetail docNo={docNo} />
    </div>
  );
}
