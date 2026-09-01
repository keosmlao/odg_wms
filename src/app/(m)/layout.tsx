import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ToastProvider from "@/components/ui/Toast";
import MobileTabBar from "@/components/MobileTabBar";

/**
 * ໂຄງໜ້າຈໍສຳລັບ **ມືຖື** (ຮວມຈໍນ້ອຍ ~4 ນິ້ວ).
 *
 * ບໍ່ມີ sidebar ບໍ່ມີ topbar ໃຫຍ່ — ຈໍ 4 ນິ້ວກວ້າງປະມານ 320–375px ຖ້າເອົາ
 * ໂຄງຂອງໜ້າ desktop ມາໃຊ້ ຈະເຫຼືອບ່ອນໃຫ້ເນື້ອໃນບໍ່ພໍ. ໃຊ້ພື້ນທີ່ເຕັມຈໍ
 * ແລະ ປຸ່ມໃຫຍ່ພໍໃຫ້ກົດດ້ວຍນິ້ວໂປ້ຂະນະຖືເຄື່ອງຍິງອີກມື.
 *
 * ສາມຢ່າງທີ່ layout ນີ້ຮັບປະກັນໃຫ້ທຸກໜ້າຂ້າງໃນ:
 *   1. `touch-ui` — ປຸ່ມ/ຊ່ອງປ້ອນສູງຢ່າງໜ້ອຍ 48px ເມື່ອໃຊ້ນິ້ວ (globals.css)
 *   2. ToastProvider — ແຈ້ງຜົນ ແລະ ປຸ່ມ “ຍົກເລີກ” ແທນກ່ອງຖາມຢືນຢັນ
 *   3. ແຖບລຸ່ມ — ສະຫຼັບວຽກໄດ້ດ້ວຍນິ້ວໂປ້ ບໍ່ຕ້ອງເອື້ອມຂຶ້ນເທິງສຸດ
 */
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <ToastProvider>
      <div className="touch-ui flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {/* pb ເຜື່ອບ່ອນໃຫ້ແຖບລຸ່ມ + ຂອບຈໍມືຖືທີ່ມີ home indicator */}
        <div className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
        <MobileTabBar />
      </div>
    </ToastProvider>
  );
}
