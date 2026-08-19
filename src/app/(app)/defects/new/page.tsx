import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ListIcon, PlusIcon } from "@/components/ui/Icons";
import NewDefectForm from "./NewDefectForm";
import { loadDefectOptions } from "../_components/options";

export const metadata = { title: "ບັນທຶກເຄື່ອງມີຕຳນິ" };

/** ບັນທຶກເຄື່ອງມີຕຳນິ — the legacy `addproduct_deface` registration form. */
export default async function NewDefectPage() {
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

  const { warehouses } = await loadDefectOptions(session);
  if (warehouses.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
        description="ຕິດຕໍ່ຜູ້ຈັດການເພື່ອມອບໝາຍສາງກ່ອນ"
      />
    );
  }

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ບັນທຶກເຄື່ອງມີຕຳນິ"
        description="ບັນທຶກສິນຄ້າທີ່ພົບຕຳນິ ພ້ອມເກຣດສະພາບ, ໝາຍເລກເຄື່ອງ ແລະ ຮູບພາບຫຼັກຖານ"
        icon={<PlusIcon className="h-6 w-6" />}
        tone="red"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
        right={
          <Link
            href="/defects"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-200 dark:ring-zinc-800"
          >
            <ListIcon className="h-4 w-4" />
            ເບິ່ງລາຍງານ
          </Link>
        }
      />
      <NewDefectForm warehouses={warehouses} />
    </div>
  );
}
