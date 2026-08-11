import Link from "next/link";
import { Hero, Chip } from "@/components/ui/Card";
import { ClipboardIcon } from "@/components/ui/Icons";
import { MANUAL_EFFECTIVE, MANUAL_VERSION, ROLE_BY_ID, SOPS } from "@/lib/manual";
import { ManualTabs } from "../_components/ManualUI";

/** ທະບຽນ SOP ທັງໝົດ. */
export default function SopListPage() {
  return (
    <div className="w-full space-y-5">
      <Hero
        title="SOP — ລະບຽບການປະຕິບັດງານມາດຕະຖານ"
        description="ຈຸດປະສົງ · ຂອບເຂດ · ໜ້າທີ່ · ຂັ້ນຕອນ · ຈຸດຄວບຄຸມ · ບັນທຶກ · KPI"
        icon={<ClipboardIcon className="h-6 w-6" />}
        tone="emerald"
        chips={
          <>
            <Chip tone="primary">{SOPS.length} ສະບັບ</Chip>
            <Chip>ສະບັບ {MANUAL_VERSION} · ມີຜົນ {MANUAL_EFFECTIVE}</Chip>
          </>
        }
      />

      <ManualTabs active="sop" />

      <div className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">ລະຫັດ</th>
                <th className="px-3 py-2">ຫົວຂໍ້</th>
                <th className="px-3 py-2">ຈຸດປະສົງ</th>
                <th className="px-3 py-2">ເຈົ້າຂອງ</th>
                <th className="px-3 py-2 text-right">ຂັ້ນຕອນ</th>
              </tr>
            </thead>
            <tbody>
              {SOPS.map((s) => (
                <tr
                  key={s.code}
                  className="border-t border-zinc-100 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/manual/sop/${s.code}`}
                      className="font-mono text-xs font-bold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {s.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/manual/sop/${s.code}`}
                      className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {s.title}
                    </Link>
                  </td>
                  <td className="max-w-md px-3 py-2 align-top text-xs text-zinc-500 dark:text-zinc-400">
                    {s.purpose}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-zinc-600 dark:text-zinc-400">
                    {ROLE_BY_ID[s.owner]?.name}
                  </td>
                  <td className="px-3 py-2 text-right align-top text-xs tabular-nums text-zinc-500">
                    {s.procedure.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
