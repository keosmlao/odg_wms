export type WmsRole = "manager" | "supervisor" | "keeper";

export const ROLE_LABEL_LO: Record<WmsRole, string> = {
  manager: "ຜູ້ຈັດການ",
  supervisor: "Supervisor",
  keeper: "ນາຍສາງ",
};

export type Session = {
  employee_id: number;
  employee_code: string;
  fullname_lo: string | null;
  nickname: string | null;
  position_code: string | null;
  department_code: string | null;
  role: WmsRole | null;
  /**
   * Assigned warehouse codes. Empty when role is 'manager' (means "all").
   * For supervisor/keeper this is the explicit allow-list.
   */
  warehouses: string[];
};

/**
 * Returns the warehouse codes the session can access, or `null` to mean
 * "all warehouses". An empty array means "no access".
 *
 * A manager defaults to all warehouses, but may narrow their own scope by
 * assigning an explicit warehouse list — in which case only those apply.
 * Supervisor/keeper are always restricted to their assigned list.
 */
export function accessibleWarehouses(
  session: Session | null,
): string[] | null {
  if (!session || !session.role) return [];
  if (session.role === "manager") {
    return session.warehouses.length > 0 ? session.warehouses : null;
  }
  return session.warehouses;
}
