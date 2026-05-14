import MovementsListPage from "../_components/MovementsListPage";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ReceivePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <MovementsListPage
      direction={1}
      title="ຮັບສິນຄ້າ"
      description="ການເຄື່ອນໄຫວສິນຄ້າເຂົ້າຄັງ (calc_flag = 1, status = 0)"
      basePath="/movements/receive"
      accentColor="emerald"
      searchParams={searchParams}
    />
  );
}
