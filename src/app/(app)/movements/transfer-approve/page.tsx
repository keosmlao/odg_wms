import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
import BackButton from "@/components/BackButton";
import ApproveClient from "./ApproveClient";

export default async function TransferApprovePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;

  return (
    <div className="w-full space-y-5">
      <BackButton href="/movements/transfer-dashboard" />
      <Hero
        title="ອະນຸມັດ ໃບຂໍໂອນ"
        description="ສາງຕົ້ນທາງ ກວດ ແລະ ອະນຸມັດ ໃບຂໍໂອນ ກ່ອນ — ສະເພາະໃບທີ່ອະນຸມັດແລ້ວຈຶ່ງຈ່າຍອອກໄດ້"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="brand"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <ApproveClient />
    </div>
  );
}
