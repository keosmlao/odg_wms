import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, TrendIcon } from "@/components/ui/Icons";
import ForecastClient from "./ForecastClient";

/**
 * ຈຳນວນຄາດການ — ຂັ້ນ 01 ຂອງແຜນ "ເຮັດວຽກແບບ Odoo".
 *
 * ອ່ານຢ່າງດຽວ ບໍ່ຂຽນຫຍັງລົງບັນຊີ stock ຈຶ່ງບໍ່ມີຄວາມສ່ຽງຕໍ່ຂໍ້ມູນ.
 * ສູດ ແລະ ນິຍາມແຕ່ລະຂາຢູ່ທີ່ lib/forecast.ts
 */
export default async function ForecastPage() {
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

  return (
    <div className="w-full space-y-4">
      <Hero
        title="ຈຳນວນຄາດການ"
        description="ຮັບຄຳສັ່ງນີ້ໄດ້ບໍ່ — ຄິດຈາກຄົງເຫຼືອ ບວກຂອງທີ່ກຳລັງມາ ລົບຂອງທີ່ຖືກຈອງແລ້ວ"
        icon={<TrendIcon className="h-5 w-5" />}
        tone="aqua"
      />
      <ForecastClient />
    </div>
  );
}
