import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * ໂຄງໜ້າຈໍສຳລັບ **ມືຖືຈໍນ້ອຍ (~4 ນິ້ວ)**.
 *
 * ບໍ່ມີ sidebar ບໍ່ມີ topbar ໃຫຍ່ — ຈໍ 4 ນິ້ວກວ້າງປະມານ 320–375px ຖ້າເອົາ
 * ໂຄງຂອງໜ້າ desktop ມາໃຊ້ ຈະເຫຼືອບ່ອນໃຫ້ເນື້ອໃນບໍ່ພໍ. ໃຊ້ພື້ນທີ່ເຕັມຈໍ
 * ແລະ ປຸ່ມໃຫຍ່ພໍໃຫ້ກົດດ້ວຍນິ້ວໂປ້ຂະນະຖືເຄື່ອງຍິງອີກມື.
 */
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {children}
    </div>
  );
}
