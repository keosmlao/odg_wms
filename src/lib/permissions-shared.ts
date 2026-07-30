/**
 * Permission names and labels — the parts safe to import from a CLIENT component.
 *
 * Kept separate from `@/lib/permissions` on purpose: that module talks to the
 * database, so importing it from a client component drags `pg` (and `fs`/`net`/
 * `dns`) into the browser bundle and the build fails. Same split as
 * `session-shared.ts` vs `session.ts`.
 */

export type WmsPerm = "delete_transfer_out" | "delete_transfer_in";

/** The manageable permissions, in the order the settings screen shows them. */
export const WMS_PERMS: { key: WmsPerm; label: string; hint: string }[] = [
  {
    key: "delete_transfer_out",
    label: "ລົບໃບໂອນອອກ",
    hint: "ລົບໃບໂອນທີ່ຈ່າຍອອກຈາກສາງຕົ້ນທາງ (ຄືນ stock + ຍົກເລີກ ໃບໂອນ ERP)",
  },
  {
    key: "delete_transfer_in",
    label: "ລົບໃບໂອນເຂົ້າ / ຮັບຄືນ",
    hint: "ລົບໃບຮັບໂອນເຂົ້າສາງປາຍທາງ ຫຼື ໃບຮັບຄືນ (ສິນຄ້າກັບໄປສາງລະຫວ່າງທາງ)",
  },
];

const VALID = new Set<string>(WMS_PERMS.map((p) => p.key));

export function isWmsPerm(v: unknown): v is WmsPerm {
  return typeof v === "string" && VALID.has(v);
}
