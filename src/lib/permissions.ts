import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { Session } from "@/lib/session-shared";
import { type WmsPerm, isWmsPerm } from "@/lib/permissions-shared";

/**
 * Per-user permissions for destructive actions — see
 * `migrations/026_wms_user_permission.sql`.
 *
 * A role says which part of the warehouse someone works in. It says nothing
 * about whether they may VOID a posted document: deleting a transfer reverses
 * stock, serials and the ERP ໃບໂອນ, so it is granted person by person.
 *
 * These are ALWAYS resolved from the database, never from the session cookie.
 * The cookie is plain JSON (only httpOnly, not signed), so anything it claims
 * about a user's rights is untrusted input; the employee_id is the one thing we
 * take from it, and the grant itself is looked up fresh.
 */

// Names/labels live in permissions-shared so client components can use them
// without pulling `pg` into the browser bundle. Re-exported for server callers.
export { WMS_PERMS, isWmsPerm, type WmsPerm } from "@/lib/permissions-shared";

type Querier = Pick<PoolClient, "query">;

/** Every permission granted to one employee (managers are not listed here). */
export async function permissionsFor(employeeId: number, client?: Querier): Promise<WmsPerm[]> {
  const sql = `SELECT perm FROM public.wms_user_permission WHERE employee_id = $1`;
  try {
    const rows = client
      ? (await client.query<{ perm: string }>(sql, [employeeId])).rows
      : await query<{ perm: string }>(sql, [employeeId]);
    return rows.map((r) => r.perm).filter(isWmsPerm);
  } catch {
    // Table absent (pre-migration) → nobody holds a grant. Denying is the safe
    // direction: a manager can still act, and everyone else waits for the grant.
    return [];
  }
}

/** Permissions for many employees at once, keyed by employee_id. */
export async function permissionsForMany(employeeIds: number[]): Promise<Record<number, WmsPerm[]>> {
  const out: Record<number, WmsPerm[]> = {};
  for (const id of employeeIds) out[id] = [];
  if (employeeIds.length === 0) return out;
  try {
    const rows = await query<{ employee_id: number; perm: string }>(
      `SELECT employee_id, perm FROM public.wms_user_permission WHERE employee_id = ANY($1)`,
      [employeeIds],
    );
    for (const r of rows) if (isWmsPerm(r.perm)) out[r.employee_id]?.push(r.perm);
  } catch {
    // pre-migration — everyone resolves to no grants.
  }
  return out;
}

/**
 * Whether this session may perform `perm`. A manager always may; anyone else
 * needs an explicit grant. No role and no session means no.
 */
export async function hasPerm(session: Session | null, perm: WmsPerm, client?: Querier): Promise<boolean> {
  if (!session || !session.role) return false;
  if (session.role === "manager") return true;
  return (await permissionsFor(session.employee_id, client)).includes(perm);
}

/** Replace an employee's whole permission set. Manager grants are not stored. */
export async function setPermissions(
  client: Querier,
  employeeId: number,
  perms: WmsPerm[],
  grantedBy: string | null,
): Promise<WmsPerm[]> {
  const wanted = Array.from(new Set(perms.filter(isWmsPerm)));
  await client.query(`DELETE FROM public.wms_user_permission WHERE employee_id = $1`, [employeeId]);
  for (const p of wanted) {
    await client.query(
      `INSERT INTO public.wms_user_permission (employee_id, perm, granted_at, granted_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (employee_id, perm) DO UPDATE SET granted_at = now(), granted_by = EXCLUDED.granted_by`,
      [employeeId, p, grantedBy],
    );
  }
  return wanted;
}
