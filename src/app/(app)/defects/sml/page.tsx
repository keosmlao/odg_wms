import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, BuildingIcon } from "@/components/ui/Icons";
import SmlDefectClient from "./SmlDefectClient";
import { loadDefectOptions } from "../_components/options";

export const metadata = { title: "ຄົງເຫຼືອໃນສາງມີຕຳນິ" };

/** ລາຍງານຄົງເຫຼືອໃນສາງມີຕຳນິ — SML shelf balance vs the defect register. */
export default async function SmlDefectPage() {
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

  const { shelves } = await loadDefectOptions(session);
  if (shelves.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ພົບບ່ອນຈັດເກັບເຄື່ອງມີຕຳນິ"
        description="ສາງທີ່ມອບໝາຍໃຫ້ທ່ານຍັງບໍ່ມີບ່ອນຈັດເກັບສະພາບຕຳນິ"
      />
    );
  }

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຄົງເຫຼືອໃນສາງມີຕຳນິ"
        description="ຍອດ SML ຢູ່ບ່ອນຈັດເກັບສະພາບຕຳນິ ທຽບກັບຍອດທີ່ບັນທຶກໄວ້ໃນລາຍງານຕຳນິ"
        icon={<BuildingIcon className="h-6 w-6" />}
        tone="amber"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <SmlDefectClient shelves={shelves} />
    </div>
  );
}
