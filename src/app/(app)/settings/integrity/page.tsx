import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, ShieldIcon } from "@/components/ui/Icons";
import IntegrityClient from "./IntegrityClient";

/**
 * ກວດຄວາມສົມບູນຂອງບັນຊີ stock.
 *
 * ຕາຕະລາງ odg_wms_trans(_detail) ບໍ່ມີ foreign key ຈັກອັນ ແລະ ຖືກຂຽນໂດຍ
 * ຫຼາຍກວ່າໜຶ່ງແອັບ — ຄວາມຜິດປົກກະຕິຈຶ່ງບໍ່ຖືກກັນຢູ່ຊັ້ນຂຽນ. ໜ້ານີ້ໄປພົບມັນ
 * ຢູ່ຊັ້ນອ່ານແທນ ແລ້ວອະທິບາຍວ່າແຕ່ລະຢ່າງໝາຍຄວາມວ່າຫຍັງ.
 */
export default async function IntegrityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ໜ້ານີ້ສະເພາະຜູ້ຈັດການ"
      />
    );
  }

  return (
    <div className="w-full space-y-4">
      <Hero
        title="ຄວາມສົມບູນຂອງຂໍ້ມູນ"
        description="ກວດບັນຊີ stock ຫາຄວາມຜິດປົກກະຕິທີ່ຖານຂໍ້ມູນບໍ່ໄດ້ກັນໄວ້"
        icon={<ShieldIcon className="h-5 w-5" />}
        tone="violet"
      />
      <IntegrityClient />
    </div>
  );
}
