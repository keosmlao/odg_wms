"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailReport, ReportInput } from "@/lib/emailReportConfig";

type Warehouse = { code: string; name: string | null };
type Toast = { kind: "ok" | "err"; text: string } | null;

const DAYS = [
  { d: 1, label: "ຈັນ" }, { d: 2, label: "ອັງຄານ" }, { d: 3, label: "ພຸດ" },
  { d: 4, label: "ພະຫັດ" }, { d: 5, label: "ສຸກ" }, { d: 6, label: "ເສົາ" }, { d: 0, label: "ອາທິດ" },
];
const SECTIONS: { key: keyof ReportInput["sections"]; label: string }[] = [
  { key: "receive", label: "ຮັບເຂົ້າ ປະຈຳວັນ" },
  { key: "issue", label: "ຈ່າຍອອກ ປະຈຳວັນ" },
  { key: "pending", label: "ໃບຄ້າງຮັບ (PO)" },
  { key: "issue_pending", label: "ສິນຄ້າຄ້າງຈ່າຍ" },
  { key: "movers", label: "ເຄື່ອນໄຫວຫຼາຍສຸດ (7ວັນ)" },
  { key: "health", label: "ສະຖານະສາງ (dead/SN)" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function blankInput(): ReportInput {
  return {
    name: "", enabled: true,
    sections: { receive: true, issue: true, pending: true, health: true, movers: false, issue_pending: false },
    send_hour: 8, send_minute: 0, send_days: [1, 2, 3, 4, 5, 6], wh_scope: [], recipients: [],
  };
}

function toInput(r: EmailReport): ReportInput {
  return {
    name: r.name, enabled: r.enabled, sections: { ...r.sections },
    send_hour: r.send_hour, send_minute: r.send_minute,
    send_days: [...r.send_days], wh_scope: [...r.wh_scope], recipients: [...r.recipients],
  };
}

export default function EmailReportsClient({
  initialReports, warehouses, mailError,
}: {
  initialReports: EmailReport[];
  warehouses: Warehouse[];
  mailError: string | null;
}) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [editingId, setEditingId] = useState<number | "new" | null>(initialReports.length === 0 ? "new" : null);
  const [draft, setDraft] = useState<ReportInput>(blankInput());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  function flash(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }

  function startNew() {
    setDraft(blankInput());
    setEditingId("new");
  }
  function startEdit(r: EmailReport) {
    setDraft(toInput(r));
    setEditingId(r.id);
  }
  function cancel() {
    setEditingId(null);
  }

  async function refresh() {
    const res = await fetch("/api/email-reports");
    if (res.ok) {
      const data = (await res.json()) as { reports: EmailReport[] };
      setReports(data.reports);
    }
    router.refresh();
  }

  async function save() {
    setBusy(true);
    try {
      const isNew = editingId === "new";
      const res = await fetch(isNew ? "/api/email-reports" : `/api/email-reports/${editingId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      flash("ok", "ບັນທຶກສຳເລັດ");
      setEditingId(null);
      await refresh();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!confirm("ລົບລາຍງານນີ້?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/email-reports/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      flash("ok", "ລົບແລ້ວ");
      setEditingId(null);
      await refresh();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally { setBusy(false); }
  }

  async function testSend(id: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/email-reports/${id}`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; sent_to?: string[] };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ສົ່ງບໍ່ສຳເລັດ");
      flash("ok", `ສົ່ງທົດສອບແລ້ວ → ${data.sent_to?.join(", ")}`);
      await refresh();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "ສົ່ງບໍ່ສຳເລັດ");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
          {toast.text}
        </div>
      )}

      {mailError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠ {mailError} — ຍັງບັນທຶກຄ່າໄດ້ ແຕ່ຈະບໍ່ສົ່ງເມວຈົນກ່ວາຕັ້ງຄ່າ SMTP ໃນ .env.local
        </div>
      )}

      {/* Report list */}
      <div className="space-y-3">
        {reports.map((r) => (
          <div key={r.id}>
            {editingId === r.id ? (
              <Editor
                draft={draft} setDraft={setDraft} warehouses={warehouses} busy={busy}
                onSave={save} onCancel={cancel}
                onDelete={() => remove(r.id)} onTest={() => testSend(r.id)}
                canTest={!mailError}
              />
            ) : (
              <ReportRow r={r} onEdit={() => startEdit(r)} />
            )}
          </div>
        ))}
      </div>

      {editingId === "new" ? (
        <Editor
          draft={draft} setDraft={setDraft} warehouses={warehouses} busy={busy}
          onSave={save} onCancel={reports.length ? cancel : undefined}
        />
      ) : (
        <button
          type="button" onClick={startNew}
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          + ເພີ່ມລາຍງານໃໝ່
        </button>
      )}
    </div>
  );
}

function ReportRow({ r, onEdit }: { r: EmailReport; onEdit: () => void }) {
  const time = `${pad(r.send_hour)}:${pad(r.send_minute)}`;
  const days = r.send_days.length === 7 ? "ທຸກມື້" : DAYS.filter((d) => r.send_days.includes(d.d)).map((d) => d.label).join(", ");
  const scope = r.wh_scope.length ? r.wh_scope.join(", ") : "ທຸກສາງ";
  return (
    <button
      type="button" onClick={onEdit}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-zinc-200/70 bg-white/90 px-5 py-4 text-left shadow-sm transition hover:border-brand-300 dark:border-zinc-800/70 dark:bg-zinc-900/80"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${r.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
          <span className="truncate font-semibold text-zinc-900 dark:text-white">{r.name}</span>
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {time} · {days} · {scope} · {r.recipients.length} ຜູ້ຮັບ
        </div>
        {r.last_status && (
          <div className={`mt-0.5 text-[11px] ${r.last_status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {r.last_status === "ok" ? `ສົ່ງລ່າສຸດ: ${r.last_sent_on ?? "-"}` : `ຜິດພາດ: ${r.last_error}`}
          </div>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-brand-600 dark:text-brand-400">ແກ້ໄຂ →</span>
    </button>
  );
}

function Editor({
  draft, setDraft, warehouses, busy, onSave, onCancel, onDelete, onTest, canTest,
}: {
  draft: ReportInput;
  setDraft: (d: ReportInput) => void;
  warehouses: Warehouse[];
  busy: boolean;
  onSave: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onTest?: () => void;
  canTest?: boolean;
}) {
  const set = <K extends keyof ReportInput>(k: K, v: ReportInput[K]) => setDraft({ ...draft, [k]: v });
  const toggleDay = (d: number) =>
    set("send_days", draft.send_days.includes(d) ? draft.send_days.filter((x) => x !== d) : [...draft.send_days, d]);
  const toggleWh = (code: string) =>
    set("wh_scope", draft.wh_scope.includes(code) ? draft.wh_scope.filter((x) => x !== code) : [...draft.wh_scope, code]);
  const toggleSection = (k: keyof ReportInput["sections"]) =>
    set("sections", { ...draft.sections, [k]: !draft.sections[k] });

  return (
    <div className="space-y-4 rounded-2xl border border-brand-200/70 bg-white/95 p-5 shadow-sm dark:border-brand-900/40 dark:bg-zinc-900/90">
      {/* Name + enabled */}
      <div className="flex items-end gap-3">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຊື່ລາຍງານ</span>
          <input
            type="text" value={draft.name} maxLength={100}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ເຊັ່ນ: ລາຍງານປະຈຳວັນ ສາງໃຫຍ່"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເປີດໃຊ້</span>
        </label>
      </div>

      {/* Sections */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເນື້ອໃນ</legend>
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <Chip key={s.key} active={draft.sections[s.key]} onClick={() => toggleSection(s.key)} label={s.label} />
          ))}
        </div>
      </fieldset>

      {/* Time + days */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເວລາສົ່ງ</span>
          <div className="flex items-center gap-1">
            <NumInput value={draft.send_hour} min={0} max={23} onChange={(v) => set("send_hour", v)} />
            <span className="text-sm font-bold text-zinc-400">:</span>
            <NumInput value={draft.send_minute} min={0} max={59} onChange={(v) => set("send_minute", v)} />
          </div>
        </label>
        <div className="flex-1">
          <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ມື້ສົ່ງ</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <Chip key={d.d} active={draft.send_days.includes(d.d)} onClick={() => toggleDay(d.d)} label={d.label} />
            ))}
          </div>
        </div>
      </div>

      {/* Warehouse scope */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          ສາງ <span className="font-normal text-zinc-400">(ບໍ່ເລືອກ = ທຸກສາງ)</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {warehouses.map((w) => (
            <Chip key={w.code} active={draft.wh_scope.includes(w.code)} onClick={() => toggleWh(w.code)}
              label={w.name ? `${w.code} · ${w.name}` : w.code} small />
          ))}
        </div>
      </fieldset>

      {/* Recipients */}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          ຜູ້ຮັບ <span className="font-normal text-zinc-400">(1 ອີເມວຕໍ່ແຖວ ຫຼື ຂັ້ນດ້ວຍຈຸດ/ຄອມມາ)</span>
        </span>
        <textarea
          value={draft.recipients.join("\n")}
          onChange={(e) => set("recipients", e.target.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))}
          rows={Math.max(2, draft.recipients.length + 1)}
          placeholder="name@odien.net"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        />
      </label>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} disabled={busy}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:hover:bg-rose-950/30">
              ລົບ
            </button>
          )}
          {onTest && (
            <button type="button" onClick={onTest} disabled={busy || !canTest}
              title={canTest ? "" : "ຕັ້ງຄ່າ SMTP ກ່ອນ"}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              ສົ່ງທົດສອບ
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50 disabled:opacity-60 dark:hover:bg-zinc-800">
              ຍົກເລີກ
            </button>
          )}
          <button type="button" onClick={onSave} disabled={busy}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:opacity-60">
            {busy ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, small }: { active: boolean; onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`rounded-lg border font-semibold transition ${small ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} ${
        active
          ? "border-brand-500 bg-brand-600 text-white shadow-sm"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function NumInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number" min={min} max={max} value={pad(value)}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isInteger(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
      className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-center text-sm font-mono tabular-nums shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
    />
  );
}
