import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, PackageIcon } from "@/components/ui/Icons";
import PackingDetail from "./PackingDetail";

export default async function PackingListPage({ params }: { params: Promise<{ doc: string }> }) {
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
        title="ໃບ packing"
        description="ກວດສອບ ສິນຄ້າ · PO · ການອະນຸມັດ ແລ້ວສ້າງໃບກວດນັບ"
        icon={<PackageIcon className="h-6 w-6" />}
        tone="emerald"
      />
      <PackingDetail doc={docNo} />
    </div>
  );
}
