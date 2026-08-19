import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, EyeIcon } from "@/components/ui/Icons";
import PhotosClient from "./PhotosClient";
import { loadDefectOptions } from "../_components/options";

export const metadata = { title: "ຮູບພາບ ແລະ ໝາຍເລກເຄື່ອງມີຕຳນິ" };

/** ລາຍງານເກັບຮູບພາບ ແລະ ໝາຍເລກເຄື່ອງໃນສາງມີຕຳນິ. */
export default async function DefectPhotosPage() {
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

  const { warehouses } = await loadDefectOptions(session);
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
        title="ຮູບພາບ ແລະ ໝາຍເລກເຄື່ອງໃນສາງມີຕຳນິ"
        description="ຫຼັກຖານຮູບພາບ ພ້ອມ SN ຂອງແຕ່ລະລາຍການ — ກອງເບິ່ງລາຍການທີ່ຍັງບໍ່ມີຮູບ ຫຼື ບໍ່ມີ SN ໄດ້"
        icon={<EyeIcon className="h-6 w-6" />}
        tone="aqua"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <PhotosClient warehouses={warehouses} />
    </div>
  );
}
