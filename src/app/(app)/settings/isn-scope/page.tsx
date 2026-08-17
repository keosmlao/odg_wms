import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listIsnCategories, listIsnItemOverrides, listIsnItemsMissingCategory } from "@/lib/isnScope";
import IsnScopeClient from "./IsnScopeClient";

export default async function IsnScopePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const [categories, overrides, missingCategory] = await Promise.all([
    listIsnCategories(),
    listIsnItemOverrides(),
    listIsnItemsMissingCategory(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">ສິນຄ້າທີ່ຕ້ອງເກັບ ISN</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          ກຳນົດວ່າ<b>ສິນຄ້າໃດຕ້ອງອອກ ISN ຕອນຮັບເຂົ້າສາງ</b> — ຄຸມດ້ວຍ<b>ໝວດ</b>ເປັນຫຼັກ ແລະ
          <b> ຍົກເວັ້ນເປັນລາຍສິນຄ້າ</b>ໄດ້. ລຳດັບ: ຍົກເວັ້ນລາຍການ → ໝວດ → ບໍ່ຕັ້ງ = ບໍ່ຕ້ອງເກັບ ISN.
        </p>
      </div>
      <IsnScopeClient
        initialCategories={categories}
        initialOverrides={overrides}
        missingCategory={missingCategory}
      />
    </div>
  );
}
