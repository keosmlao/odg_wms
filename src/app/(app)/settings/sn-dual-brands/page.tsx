import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getSnDualBrands } from "@/lib/snDualBrand";
import SnDualBrandsClient from "./SnDualBrandsClient";

export default async function SnDualBrandsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const brands = await getSnDualBrands();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">ຍີ່ຫໍ້ບັງຄັບ SN + ISN</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          ສິນຄ້າຂອງຍີ່ຫໍ້ (item_brand) ໃນລາຍການນີ້ ຕ້ອງມີທັງ <span className="font-mono">sn</span> ແລະ{" "}
          <span className="font-mono">isn</span> ຄົບ ຈຶ່ງຈະ<b>ຢືນຢັນຈ່າຍອອກ</b>ໄດ້. ຖ້າຂາດຄ່າໃດຄ່າໜຶ່ງ ຈະຖືກລັອກຈົນກວ່າຈະແກ້ໄຂ serial.
        </p>
      </div>
      <SnDualBrandsClient initialBrands={brands} />
    </div>
  );
}
