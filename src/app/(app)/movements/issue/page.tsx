import MovementsListPage from "../_components/MovementsListPage";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function IssuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <MovementsListPage
      direction={-1}
      title="ຈ່າຍສິນຄ້າ"
      description="ການເຄື່ອນໄຫວສິນຄ້າຈ່າຍອອກຈາກຄັງ (calc_flag = -1, status = 0)"
      basePath="/movements/issue"
      accentColor="red"
      searchParams={searchParams}
    />
  );
}
