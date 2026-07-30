import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { hasPerm } from "@/lib/permissions";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowLeftRightIcon } from "@/components/ui/Icons";
import BackButton from "@/components/BackButton";
import TransitMoveClient from "./TransitMoveClient";

export default async function TransferReceivePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  // Offer the void button only to a holder of the grant; the DELETE route checks it again.
  const canDelete = await hasPerm(session, "delete_transfer_in");

  return (
    <div className="w-full space-y-5">
      <BackButton href="/movements/transfer-dashboard" />
      <Hero
        title="ຮັບໂອນເຂົ້າສາງ"
        description="ຮັບສິນຄ້າຈາກສາງລະຫວ່າງທາງ (9903) ເຂົ້າສາງຕົນ — ຮັບໄດ້ຕາມຕົວຈິງ. ຮັບບໍ່ຄົບ → ส่วนที่ເຫลือຍັງຄ້າງ pending"
        icon={<ArrowLeftRightIcon className="h-6 w-6" />}
        tone="emerald"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <TransitMoveClient endpoint="/api/movements/transfer-receive" mode="receive" canDelete={canDelete} />
    </div>
  );
}
