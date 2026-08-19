import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, PlusIcon } from "@/components/ui/Icons";
import DefectReportClient from "./_components/DefectReportClient";
import { loadDefectOptions } from "./_components/options";

export const metadata = { title: "ຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ຍັງບໍ່ເບີກຈ່າຍ)" };

/** ລາຍງານຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ຍັງບໍ່ເບີກຈ່າຍ) — status 0 of odg_product_defect. */
export default async function DefectPendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }

  const { warehouses, brands } = await loadDefectOptions(session);
  if (warehouses.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
        description="ຕິດຕໍ່ຜູ້ຈັດການເພື່ອມອບໝາຍສາງກ່ອນ"
      />
    );
  }

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ຍັງບໍ່ເບີກຈ່າຍ)"
        description="ເຄື່ອງມີຕຳນິທີ່ບັນທຶກໄວ້ ແລະ ຍັງຄ້າງຢູ່ໃນສາງ — ຍັງບໍ່ໄດ້ເບີກຈ່າຍອອກ"
        icon={<AlertIcon className="h-6 w-6" />}
        tone="red"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
        right={
          <Link
            href="/defects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-500/20 transition hover:shadow-lg"
          >
            <PlusIcon className="h-4 w-4" />
            ບັນທຶກເຄື່ອງມີຕຳນິ
          </Link>
        }
      />
      <DefectReportClient status={0} warehouses={warehouses} brands={brands} />
    </div>
  );
}
