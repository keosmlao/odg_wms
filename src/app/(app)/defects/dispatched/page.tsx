import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowUpIcon } from "@/components/ui/Icons";
import DefectReportClient from "../_components/DefectReportClient";
import { loadDefectOptions } from "../_components/options";

export const metadata = { title: "ຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ເບີກຈ່າຍແລ້ວ)" };

/** ລາຍງານຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ເບີກຈ່າຍແລ້ວ) — status 1 of odg_product_defect. */
export default async function DefectDispatchedPage() {
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
        title="ຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ເບີກຈ່າຍແລ້ວ)"
        description="ປະຫວັດເຄື່ອງມີຕຳນິທີ່ເບີກຈ່າຍອອກໄປແລ້ວ — ສົ່ງຄືນ, ຂາຍລ້າງ ຫຼື ຖອດອາໄຫຼ່"
        icon={<ArrowUpIcon className="h-6 w-6" />}
        tone="violet"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <DefectReportClient status={1} warehouses={warehouses} brands={brands} />
    </div>
  );
}
