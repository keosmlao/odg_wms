import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { hasPerm } from "@/lib/permissions";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowLeftRightIcon } from "@/components/ui/Icons";
import BackButton from "@/components/BackButton";
import TransitMoveClient from "../transfer-receive/TransitMoveClient";

export default async function TransferReturnPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  // A return also moves goods OUT of the in-transit wh, so it is the same grant.
  const canDelete = await hasPerm(session, "delete_transfer_in");

  return (
    <div className="w-full space-y-5">
      <BackButton href="/movements/transfer-dashboard" />
      <Hero
        title="ຮັບຄືນຈາກການຈ່າຍ"
        description="ສາງຕົ້ນທາງ ດຶງສິນຄ້າທີ່ຍັງຄ້າງໃນສາງລະຫວ່າງທາງ (ปลายทางยังไม่รับ) ກັບคืนเข้าສาງຕົນ"
        icon={<ArrowLeftRightIcon className="h-6 w-6" />}
        tone="amber"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <TransitMoveClient endpoint="/api/movements/transfer-return" mode="return" canDelete={canDelete} />
    </div>
  );
}
