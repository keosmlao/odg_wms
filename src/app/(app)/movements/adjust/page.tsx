import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Hero, Notice, EmptyState, Chip } from "@/components/ui/Card";
import {
  AlertIcon,
  CheckIcon,
  PackageIcon,
} from "@/components/ui/Icons";
import { ROLE_LABEL_LO } from "@/lib/session-shared";

export default async function AdjustPage() {
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
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <Hero
        title="ປັບປຸງ stock"
        description="ບັນທຶກການປັບປຸງສິນຄ້າຄົງເຫຼືອ (ນັບສິນຄ້າ, ສຳຮອງ, ປັບແຕ່ງ)"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="amber"
        chips={
          <>
            <Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>
            <Chip tone="amber">ກຳລັງພັດທະນາ</Chip>
          </>
        }
      />

      <EmptyState
        icon={<PackageIcon className="h-7 w-7" />}
        title="ໜ້ານີ້ກຳລັງພັດທະນາ"
        description="ໜ້າປັບປຸງ stock ຈະຮອງຮັບ: ນັບສິນຄ້າ (stock count), ປັບແຕ່ງ +/− ດ້ວຍເຫດຜົນ, ສຳຮອງ/ປ່ອຍສຳຮອງ. ກະລຸນາລະບຸ trans_flag ທີ່ໃຊ້ສຳລັບ adjustment ໃນ odg_wms_trans_detail ເພື່ອໃຫ້ສ້າງລາຍການໄດ້ຖືກຕ້ອງ."
      />
    </div>
  );
}
