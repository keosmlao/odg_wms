"use client";

import { useMemo, useState } from "react";
import type { WmsRole } from "@/lib/session-shared";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import { WMS_PERMS, type WmsPerm } from "@/lib/permissions-shared";
import type { EmployeeRow, WarehouseRow } from "./page";

const ROLE_OPTIONS: { value: WmsRole | ""; label: string }[] = [
  { value: "", label: "— ບໍ່ມີສິດ —" },
  { value: "manager", label: ROLE_LABEL_LO.manager },
  { value: "supervisor", label: ROLE_LABEL_LO.supervisor },
  { value: "keeper", label: ROLE_LABEL_LO.keeper },
];

function roleBadgeClass(role: WmsRole | null) {
  if (role === "manager")
    return "bg-aqua-50 text-aqua-700 dark:bg-aqua-950 dark:text-aqua-300";
  if (role === "supervisor")
    return "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300";
  if (role === "keeper")
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

export default function AccessClient({
  initialEmployees,
  warehouses,
  currentEmployeeId,
}: {
  initialEmployees: EmployeeRow[];
  warehouses: WarehouseRow[];
  currentEmployeeId: number;
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | WmsRole | "none">("all");
  const [editing, setEditing] = useState<EmployeeRow | null>(null);

  const warehouseNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses) m.set(w.code, w.name ?? w.code);
    return m;
  }, [warehouses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (roleFilter === "none" && e.role !== null) return false;
      if (roleFilter !== "all" && roleFilter !== "none" && e.role !== roleFilter)
        return false;
      if (!q) return true;
      return (
        e.employee_code.toLowerCase().includes(q) ||
        (e.fullname_lo ?? "").toLowerCase().includes(q) ||
        (e.nickname ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, search, roleFilter]);

  const counts = useMemo(() => {
    const c = { manager: 0, supervisor: 0, keeper: 0, none: 0 };
    for (const e of employees) {
      if (e.role) c[e.role]++;
      else c.none++;
    }
    return c;
  }, [employees]);

  function handleSaved(updated: EmployeeRow) {
    setEmployees((rows) =>
      rows.map((r) => (r.employee_id === updated.employee_id ? updated : r)),
    );
    setEditing(null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່..."
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <select
          value={roleFilter}
          onChange={(e) =>
            setRoleFilter(e.target.value as "all" | WmsRole | "none")
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="all">ທຸກ role ({employees.length})</option>
          <option value="manager">
            {ROLE_LABEL_LO.manager} ({counts.manager})
          </option>
          <option value="supervisor">
            {ROLE_LABEL_LO.supervisor} ({counts.supervisor})
          </option>
          <option value="keeper">
            {ROLE_LABEL_LO.keeper} ({counts.keeper})
          </option>
          <option value="none">ຍັງບໍ່ມີສິດ ({counts.none})</option>
        </select>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ສະແດງ {filtered.length} / {employees.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">ລະຫັດ</th>
                <th className="px-4 py-2 font-medium">ຊື່</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">ສາງທີ່ຮັບຜິດຊອບ</th>
                <th className="px-4 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                  >
                    ບໍ່ພົບພະນັກງານ
                  </td>
                </tr>
              )}
              {filtered.map((e) => (
                <tr
                  key={e.employee_id}
                  className="border-t border-zinc-100 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {e.employee_code}
                    {e.employee_id === currentEmployeeId && (
                      <span className="ml-1 text-[10px] text-zinc-500">
                        (ທ່ານ)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {e.fullname_lo ?? e.employee_code}
                    </div>
                    {e.nickname && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {e.nickname}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(e.role)}`}
                    >
                      {e.role ? ROLE_LABEL_LO[e.role] : "ບໍ່ມີສິດ"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {e.role === "manager" && e.warehouses.length === 0 ? (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        ທຸກສາງ
                      </span>
                    ) : e.warehouses.length === 0 ? (
                      <span className="text-xs text-zinc-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {e.warehouses.slice(0, 4).map((w) => (
                          <span
                            key={w}
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            title={warehouseNameByCode.get(w) ?? w}
                          >
                            {w}
                          </span>
                        ))}
                        {e.warehouses.length > 4 && (
                          <span className="text-xs text-zinc-500">
                            +{e.warehouses.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Void grants — worth seeing at a glance from the list. */}
                    {e.role === "manager" ? (
                      <div className="mt-1 text-[10px] font-medium text-aqua-600 dark:text-aqua-400">🗑 ລົບໄດ້ທຸກຢ່າງ</div>
                    ) : e.permissions.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.permissions.map((p) => (
                          <span key={p} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                            🗑 {WMS_PERMS.find((x) => x.key === p)?.label ?? p}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      ແກ້ໄຂ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDrawer
          employee={editing}
          warehouses={warehouses}
          isSelf={editing.employee_id === currentEmployeeId}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

function EditDrawer({
  employee,
  warehouses,
  isSelf,
  onClose,
  onSaved,
}: {
  employee: EmployeeRow;
  warehouses: WarehouseRow[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (e: EmployeeRow) => void;
}) {
  const [role, setRole] = useState<WmsRole | "">(employee.role ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(employee.warehouses),
  );
  const [perms, setPerms] = useState<Set<WmsPerm>>(new Set(employee.permissions ?? []));
  const [whSearch, setWhSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredWh = useMemo(() => {
    const q = whSearch.trim().toLowerCase();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) =>
        w.code.toLowerCase().includes(q) ||
        (w.name ?? "").toLowerCase().includes(q),
    );
  }, [warehouses, whSearch]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/employees/${employee.employee_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role || null,
          warehouses: role === "" ? [] : Array.from(selected),
          permissions: Array.from(perms),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        role?: WmsRole | null;
        warehouses?: string[];
        permissions?: WmsPerm[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
        return;
      }
      onSaved({
        ...employee,
        role: data.role ?? null,
        warehouses: data.warehouses ?? [],
        permissions: data.permissions ?? [],
      });
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setSaving(false);
    }
  }

  const showWarehousePicker =
    role === "manager" || role === "supervisor" || role === "keeper";

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {employee.fullname_lo ?? employee.employee_code}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {employee.employee_code}
              {employee.nickname && ` · ${employee.nickname}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="close"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WmsRole | "")}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {isSelf && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                ທ່ານກຳລັງແກ້ໄຂບັນຊີຂອງຕົນເອງ — ບໍ່ສາມາດຫຼຸດສິດ manager ຂອງຕົນເອງ.
              </p>
            )}
          </div>

          {role === "manager" && (
            <p className="mb-3 rounded-lg bg-aqua-50 px-3 py-2 text-xs text-aqua-800 dark:bg-aqua-950 dark:text-aqua-300">
              ຜູ້ຈັດການ: ປ່ອຍວ່າງ = ເຫັນ <strong>ທຸກສາງ</strong>. ເລືອກສະເພາະ = ຈຳກັດໃຫ້ເຫັນສະເພາະສາງທີ່ເລືອກເທົ່ານັ້ນ.
            </p>
          )}

          {/* Extra grants for destructive actions. A manager holds them all
              implicitly, so the list is only offered to the other roles. */}
          {role !== "" && (
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                ສິດພິເສດ (ລົບເອກະສານ)
              </label>
              {role === "manager" ? (
                <p className="rounded-lg bg-aqua-50 px-3 py-2 text-xs text-aqua-800 dark:bg-aqua-950 dark:text-aqua-300">
                  ຜູ້ຈັດການມີ <strong>ທຸກສິດ</strong> ໂດຍປະລິຍາຍ — ບໍ່ຕ້ອງເລືອກ.
                </p>
              ) : (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {WMS_PERMS.map((p) => (
                    <label
                      key={p.key}
                      className="flex cursor-pointer items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-sm last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p.key)}
                        onChange={() =>
                          setPerms((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.key)) next.delete(p.key);
                            else next.add(p.key);
                            return next;
                          })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-rose-600 focus:ring-rose-500 dark:border-zinc-700"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-zinc-800 dark:text-zinc-200">{p.label}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{p.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {showWarehousePicker && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  ສາງທີ່ຮັບຜິດຊອບ
                  <span className="ml-1.5 text-xs text-zinc-500">
                    ({selected.size}/{warehouses.length})
                  </span>
                </label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(new Set(warehouses.map((w) => w.code)))
                    }
                    className="font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                  >
                    ເລືອກໝົດ
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                  >
                    ລ້າງ
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={whSearch}
                onChange={(e) => setWhSearch(e.target.value)}
                placeholder="ຄົ້ນຫາສາງ..."
                className="mb-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                {filteredWh.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-zinc-500">
                    ບໍ່ພົບສາງ
                  </div>
                )}
                {filteredWh.map((w) => {
                  const checked = selected.has(w.code);
                  return (
                    <label
                      key={w.code}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(w.code)}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
                      />
                      <span className="font-mono text-xs text-zinc-500">
                        {w.code}
                      </span>
                      <span className="flex-1 truncate text-zinc-800 dark:text-zinc-200">
                        {w.name ?? "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}
