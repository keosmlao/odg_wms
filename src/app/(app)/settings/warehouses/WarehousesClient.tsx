"use client";

import { useMemo, useState } from "react";
import type { Warehouse } from "@/app/api/admin/warehouses/route";

type FormState = {
  code: string;
  name_1: string;
  name_2: string;
  address: string;
  telephone: string;
  fax: string;
  branch_code: string;
  wh_manager: string;
  status: number;
  latitude: string;
  longitude: string;
};

const EMPTY_FORM: FormState = {
  code: "",
  name_1: "",
  name_2: "",
  address: "",
  telephone: "",
  fax: "",
  branch_code: "",
  wh_manager: "",
  status: 1,
  latitude: "",
  longitude: "",
};

function toForm(w: Warehouse): FormState {
  return {
    code: w.code,
    name_1: w.name_1 ?? "",
    name_2: w.name_2 ?? "",
    address: w.address ?? "",
    telephone: w.telephone ?? "",
    fax: w.fax ?? "",
    branch_code: w.branch_code ?? "",
    wh_manager: w.wh_manager ?? "",
    status: w.status ?? 1,
    latitude: w.latitude == null ? "" : String(w.latitude),
    longitude: w.longitude == null ? "" : String(w.longitude),
  };
}

export default function WarehousesClient({
  initialWarehouses,
}: {
  initialWarehouses: Warehouse[];
}) {
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [editing, setEditing] = useState<
    | { mode: "create" }
    | { mode: "edit"; warehouse: Warehouse }
    | null
  >(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (statusFilter === "active" && w.status !== 1) return false;
      if (statusFilter === "inactive" && w.status === 1) return false;
      if (!q) return true;
      return (
        w.code.toLowerCase().includes(q) ||
        (w.name_1 ?? "").toLowerCase().includes(q) ||
        (w.name_2 ?? "").toLowerCase().includes(q) ||
        (w.address ?? "").toLowerCase().includes(q)
      );
    });
  }, [warehouses, search, statusFilter]);

  const counts = useMemo(() => {
    const active = warehouses.filter((w) => w.status === 1).length;
    return { active, inactive: warehouses.length - active };
  }, [warehouses]);

  function handleSaved(updated: Warehouse, mode: "create" | "edit") {
    if (mode === "create") {
      setWarehouses((prev) =>
        [...prev, updated].sort((a, b) => a.code.localeCompare(b.code)),
      );
    } else {
      setWarehouses((prev) =>
        prev.map((w) => (w.code === updated.code ? updated : w)),
      );
    }
    setEditing(null);
  }

  function handleDeleted(code: string) {
    setWarehouses((prev) => prev.filter((w) => w.code !== code));
    setDeleting(null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ຄົ້ນຫາລະຫັດ, ຊື່, ທີ່ຢູ່..."
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "active" | "inactive")
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="all">ທັງໝົດ ({warehouses.length})</option>
          <option value="active">ໃຊ້ງານ ({counts.active})</option>
          <option value="inactive">ປິດໃຊ້ງານ ({counts.inactive})</option>
        </select>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ສະແດງ {filtered.length} / {warehouses.length}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setEditing({ mode: "create" })}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + ເພີ່ມສາງ
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">ລະຫັດ</th>
                <th className="px-4 py-2 font-medium">ຊື່ສາງ</th>
                <th className="px-4 py-2 font-medium">ສາຂາ</th>
                <th className="px-4 py-2 font-medium">ນາຍສາງ</th>
                <th className="px-4 py-2 font-medium">ໂທ</th>
                <th className="px-4 py-2 font-medium">ສະຖານະ</th>
                <th className="px-4 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                  >
                    ບໍ່ພົບສາງ
                  </td>
                </tr>
              )}
              {filtered.map((w) => (
                <tr
                  key={w.code}
                  className="border-t border-zinc-100 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                >
                  <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{w.name_1 ?? "—"}</div>
                    {w.name_2 && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {w.name_2}
                      </div>
                    )}
                    {w.address && (
                      <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {w.address}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{w.branch_code ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{w.wh_manager ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{w.telephone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {w.status === 1 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        ໃຊ້ງານ
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        ປິດ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing({ mode: "edit", warehouse: w })}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        ແກ້ໄຂ
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(w)}
                        className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        ລຶບ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDrawer
          mode={editing.mode}
          initial={editing.mode === "edit" ? toForm(editing.warehouse) : EMPTY_FORM}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <DeleteConfirm
          warehouse={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}

function EditDrawer({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: FormState;
  onClose: () => void;
  onSaved: (w: Warehouse, mode: "create" | "edit") => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    if (!form.code.trim()) {
      setError("ກະລຸນາປ້ອນລະຫັດສາງ");
      setSaving(false);
      return;
    }

    const url =
      mode === "create"
        ? "/api/admin/warehouses"
        : `/api/admin/warehouses/${encodeURIComponent(form.code)}`;
    const method = mode === "create" ? "POST" : "PUT";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name_1: form.name_1.trim() || null,
          name_2: form.name_2.trim() || null,
          address: form.address.trim() || null,
          telephone: form.telephone.trim() || null,
          fax: form.fax.trim() || null,
          branch_code: form.branch_code.trim() || null,
          wh_manager: form.wh_manager.trim() || null,
          status: form.status,
          latitude: form.latitude.trim() || null,
          longitude: form.longitude.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        warehouse?: Warehouse;
      };
      if (!res.ok || !data.ok || !data.warehouse) {
        setError(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
        return;
      }
      onSaved(data.warehouse, mode);
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setSaving(false);
    }
  }

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
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "create" ? "ເພີ່ມສາງໃໝ່" : `ແກ້ໄຂສາງ ${form.code}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <Label>ລະຫັດສາງ *</Label>
            <Input
              value={form.code}
              onChange={(v) => update("code", v)}
              disabled={mode === "edit"}
              placeholder="ເຊັ່ນ 1101"
            />
            {mode === "edit" && (
              <p className="mt-1 text-xs text-zinc-500">ບໍ່ສາມາດປ່ຽນລະຫັດໄດ້</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>ຊື່ສາງ (ລາວ)</Label>
              <Input value={form.name_1} onChange={(v) => update("name_1", v)} />
            </div>
            <div className="col-span-2">
              <Label>ຊື່ສາງ (ອັງກິດ/ຊື່ສຳຮອງ)</Label>
              <Input value={form.name_2} onChange={(v) => update("name_2", v)} />
            </div>
            <div className="col-span-2">
              <Label>ທີ່ຢູ່</Label>
              <Input value={form.address} onChange={(v) => update("address", v)} />
            </div>
            <div>
              <Label>ໂທລະສັບ</Label>
              <Input
                value={form.telephone}
                onChange={(v) => update("telephone", v)}
              />
            </div>
            <div>
              <Label>ແຟັກ</Label>
              <Input value={form.fax} onChange={(v) => update("fax", v)} />
            </div>
            <div>
              <Label>ລະຫັດສາຂາ</Label>
              <Input
                value={form.branch_code}
                onChange={(v) => update("branch_code", v)}
              />
            </div>
            <div>
              <Label>ນາຍສາງ (employee_code)</Label>
              <Input
                value={form.wh_manager}
                onChange={(v) => update("wh_manager", v)}
              />
            </div>
            <div>
              <Label>Latitude</Label>
              <Input
                value={form.latitude}
                onChange={(v) => update("latitude", v)}
                placeholder="0.0"
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                value={form.longitude}
                onChange={(v) => update("longitude", v)}
                placeholder="0.0"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={form.status === 1}
              onChange={(e) => update("status", e.target.checked ? 1 : 0)}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
            />
            ໃຊ້ງານ
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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

function DeleteConfirm({
  warehouse,
  onClose,
  onDeleted,
}: {
  warehouse: Warehouse;
  onClose: () => void;
  onDeleted: (code: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/warehouses/${encodeURIComponent(warehouse.code)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "ລຶບບໍ່ສຳເລັດ");
        return;
      }
      onDeleted(warehouse.code);
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          ຢືນຢັນການລຶບ
        </h3>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          ຕ້ອງການລຶບສາງ <span className="font-mono font-semibold">{warehouse.code}</span>
          {warehouse.name_1 && ` (${warehouse.name_1})`} ບໍ?
        </p>
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          ຖ້າມີຂໍ້ມູນອື່ນອ້າງອີງສາງນີ້ ການລຶບຈະຖືກປະຕິເສດ — ໃຫ້ປິດໃຊ້ງານແທນ.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? "ກຳລັງລຶບ..." : "ລຶບ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-800"
    />
  );
}
