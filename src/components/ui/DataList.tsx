import type { ReactNode } from "react";

/**
 * ຕາຕະລາງທີ່ກາຍເປັນບັດເມື່ອຈໍແຄບ.
 *
 * ໃນລະບົບນີ້ມີ <table> ຢູ່ຫຼາຍສິບໜ້າ. ຕາຕະລາງ 8 ຖັນອ່ານດີເທິງຈໍ 24 ນິ້ວ
 * ແຕ່ເທິງຈໍມືຖືມັນກາຍເປັນການເລື່ອນຊ້າຍຂວາໄປມາເພື່ອຫາຕົວເລກດຽວ.
 *
 * ວິທີແກ້ບໍ່ແມ່ນລຶບຖັນຖິ້ມ (ຫົວໜ້າສາງຍັງຕ້ອງການຂໍ້ມູນເຕັມ) ແຕ່ແມ່ນ **ຈັດຊັ້ນ**:
 *   - ≥ md : ຕາຕະລາງເຕັມຄືເກົ່າ
 *   - < md : ບັດລະລາຍການ — ຫົວຂໍ້ໃຫຍ່, ຄຳອະທິບາຍນ້ອຍ, ຄ່າຫຼັກເດັ່ນ, ສ່ວນທີ່ເຫຼືອເປັນຄູ່ label/ຄ່າ
 *
 * ນິຍາມຖັນເທື່ອດຽວ ໃຊ້ໄດ້ທັງສອງແບບ.
 */
export type DataColumn<T> = {
  /** ຫົວຖັນໃນຕາຕະລາງ ແລະ ປ້າຍກຳກັບໃນບັດ. */
  header: ReactNode;
  /** ເນື້ອໃນຂອງຊ່ອງ. */
  cell: (row: T, index: number) => ReactNode;
  /** ຈັດຂວາສຳລັບຕົວເລກ. */
  align?: "left" | "right" | "center";
  /**
   * ບົດບາດຂອງຖັນນີ້ໃນມຸມມອງບັດ:
   *   title    — ຫົວບັດ (ຕົວໃຫຍ່ ໜາ)
   *   subtitle — ບັນທັດຮອງໃຕ້ຫົວບັດ (ລະຫັດ, ບ່ອນເກັບ)
   *   value    — ຄ່າຫຼັກ ສະແດງເປັນຕົວເລກໃຫຍ່ທາງຂວາຂອງຫົວບັດ
   *   meta     — ຄູ່ label/ຄ່າ ຢູ່ທ້າຍບັດ (ຄ່າເລີ່ມຕົ້ນ)
   *   hidden   — ບໍ່ສະແດງໃນບັດ (ເຊັ່ນ ຖັນລຳດັບ)
   */
  card?: "title" | "subtitle" | "value" | "meta" | "hidden";
  /** class ເພີ່ມສຳລັບຊ່ອງໃນຕາຕະລາງ. */
  className?: string;
};

export function DataList<T>({
  rows,
  columns,
  rowKey,
  empty = "ບໍ່ມີຂໍ້ມູນ",
  onRowClick,
  caption,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  onRowClick?: (row: T, index: number) => void;
  caption?: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {empty}
      </div>
    );
  }

  const align = (a: DataColumn<T>["align"]) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  const titleCol = columns.find((c) => c.card === "title") ?? columns[0];
  const subtitleCols = columns.filter((c) => c.card === "subtitle");
  const valueCol = columns.find((c) => c.card === "value");
  const metaCols = columns.filter(
    (c) => c !== titleCol && c !== valueCol && !subtitleCols.includes(c) && c.card !== "hidden",
  );

  return (
    <>
      {/* ≥ md — ຕາຕະລາງເຕັມ, ເລື່ອນຂວາໄດ້ພາຍໃນກອບຂອງມັນເອງ */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          {caption && (
            <caption className="px-4 py-2 text-left text-xs text-zinc-500 dark:text-zinc-400">
              {caption}
            </caption>
          )}
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              {columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 ${align(c.align)}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={rowKey(row, ri)}
                onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
                className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                  onRowClick ? "cursor-pointer hover:bg-brand-50/60 dark:hover:bg-brand-950/30" : ""
                }`}
              >
                {columns.map((c, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-2.5 text-zinc-700 dark:text-zinc-300 ${align(c.align)} ${c.className ?? ""}`}
                  >
                    {c.cell(row, ri)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* < md — ບັດລະລາຍການ, ບໍ່ມີການເລື່ອນຂວາ */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row, ri) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-zinc-900 dark:text-zinc-50">
                    {titleCol.cell(row, ri)}
                  </p>
                  {subtitleCols.map((c, i) => (
                    <p key={i} className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {c.cell(row, ri)}
                    </p>
                  ))}
                </div>
                {valueCol && (
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-bold tabular-nums text-brand-700 dark:text-aqua-300">
                      {valueCol.cell(row, ri)}
                    </p>
                    <p className="text-[10px] font-medium text-zinc-400">{valueCol.header}</p>
                  </div>
                )}
              </div>
              {metaCols.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                  {metaCols.map((c, i) => (
                    <div key={i} className="min-w-0">
                      <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                        {c.header}
                      </dt>
                      <dd className="truncate font-semibold text-zinc-700 tabular-nums dark:text-zinc-300">
                        {c.cell(row, ri)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );

          return (
            <li key={rowKey(row, ri)}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row, ri)}
                  className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left transition active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {body}
                </button>
              ) : (
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default DataList;
