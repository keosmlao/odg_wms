import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import MobileReceiveClient from "./MobileReceiveClient";

/**
 * ຮັບສິນຄ້າເທິງມືຖື.
 *
 * ໜ້າ desktop (/movements/receive) ຮອງຮັບການເລືອກບ່ອນເກັບແຍກລະລາຍການ,
 * ນຳເຂົ້າ packing list, ໃບນັບ ແລະ ອື່ນໆ — ອັນນັ້ນເປັນວຽກຂອງຫົວໜ້າຢູ່ໜ້າຄອມ.
 * ໜ້ານີ້ເຮັດສະເພາະວຽກທີ່ເກີດຂຶ້ນຢູ່ໜ້າປະຕູສາງ: ຍິງເຄື່ອງ, ຢືນຢັນຈຳນວນ,
 * ເລືອກບ່ອນເກັບອັນດຽວສຳລັບທັງໃບ ແລ້ວບັນທຶກ. ໃຊ້ API ດຽວກັນທຸກປະການ.
 */
export default async function MobileReceivePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="px-4 py-10 text-center text-sm font-semibold text-amber-700 dark:text-amber-400">
        ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS
      </div>
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm font-semibold text-amber-700 dark:text-amber-400">
        ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ
      </div>
    );
  }

  return <MobileReceiveClient />;
}
