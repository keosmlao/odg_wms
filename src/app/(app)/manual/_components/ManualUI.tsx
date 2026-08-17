import Link from "next/link";
import type { ReactNode } from "react";
import {
  FORM_BY_CODE,
  ROLE_BY_ID,
  SOP_BY_CODE,
  WI_BY_CODE,
  WORKFLOW_BY_CODE,
  type RoleId,
  type ScreenRef,
} from "@/lib/manual";

/* ── ແທັບນຳທາງ ຂອງຄູ່ມື ────────────────────────────────────────── */

const TABS: { key: string; label: string; href: string }[] = [
  { key: "home", label: "ພາບລວມ", href: "/manual" },
  { key: "workflow", label: "ຂະບວນການ", href: "/manual/workflow" },
  { key: "sop", label: "SOP", href: "/manual/sop" },
  { key: "wi", label: "ວິທີເຮັດ (WI)", href: "/manual/wi" },
  { key: "forms", label: "ແບບຟອມ", href: "/manual/forms" },
  { key: "roles", label: "ໜ້າທີ່ແຕ່ລະຄົນ", href: "/manual/roles" },
];

export function ManualTabs({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 print:hidden">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`rounded-xl px-3.5 py-2 text-sm font-bold transition ${
              on
                ? "bg-zinc-900 text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ── ບລັອກເນື້ອໃນ ─────────────────────────────────────────────── */

export function Section({
  title,
  hint,
  children,
  right,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
        {right}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** ຕາຕະລາງ label → value ຂອງຫົວເອກະສານ. */
export function MetaGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {it.label}
          </dt>
          <dd className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bullets({ items, tone = "zinc" }: { items: string[]; tone?: "zinc" | "red" | "emerald" }) {
  const dot =
    tone === "red"
      ? "bg-red-400"
      : tone === "emerald"
        ? "bg-emerald-400"
        : "bg-zinc-300 dark:bg-zinc-600";
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function NumberedSteps({
  steps,
}: {
  steps: { no: number; title: ReactNode; body?: ReactNode }[];
}) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.no} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
            {s.no}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
            {s.body && <div className="mt-1 space-y-1.5">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** ຕາຕະລາງ 2 ຖັນ ແບບ ກໍລະນີ → ວິທີແກ້. */
export function PairTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: [string, string][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <tr>
            <th className="w-2/5 px-2 py-1.5">{head[0]}</th>
            <th className="px-2 py-1.5">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="px-2 py-2 font-medium text-zinc-800 dark:text-zinc-200">{a}</td>
              <td className="px-2 py-2 text-zinc-600 dark:text-zinc-400">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── ປ້າຍ ແລະ ລິ້ງອ້າງອີງ ─────────────────────────────────────── */

export function RoleBadge({ id }: { id: RoleId }) {
  const r = ROLE_BY_ID[id];
  if (!r) return null;
  return (
    <Link
      href={`/manual/roles/${r.id}`}
      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900/50"
    >
      {r.name}
    </Link>
  );
}

/** ລິ້ງໄປເອກະສານອື່ນດ້ວຍລະຫັດ (WF / SOP / WI / F). */
export function RefLink({ code }: { code: string }) {
  const wf = WORKFLOW_BY_CODE.get(code);
  const sop = SOP_BY_CODE.get(code);
  const wi = WI_BY_CODE.get(code);
  const form = FORM_BY_CODE.get(code);

  const target = wf
    ? { href: `/manual/workflow/${wf.code}`, label: wf.name }
    : sop
      ? { href: `/manual/sop/${sop.code}`, label: sop.title }
      : wi
        ? { href: `/manual/wi/${wi.code}`, label: wi.title }
        : form
          ? { href: `/manual/forms#${form.code}`, label: form.name }
          : null;

  if (!target) {
    return (
      <span className="inline-flex items-center rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {code}
      </span>
    );
  }

  return (
    <Link
      href={target.href}
      title={target.label}
      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    >
      <span className="font-mono font-bold">{code}</span>
      <span className="max-w-[12rem] truncate">{target.label}</span>
    </Link>
  );
}

export function RefLinks({ codes, empty = "—" }: { codes: string[]; empty?: string }) {
  if (!codes.length)
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((c) => (
        <RefLink key={c} code={c} />
      ))}
    </div>
  );
}

export function ScreenLink({ screen }: { screen: ScreenRef }) {
  return (
    <Link
      href={screen.href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-aqua-50 px-2 py-0.5 text-[11px] font-semibold text-aqua-700 ring-1 ring-inset ring-aqua-200 transition hover:bg-aqua-100 dark:bg-aqua-950/50 dark:text-aqua-300 dark:ring-aqua-900/50"
    >
      ↗ {screen.label}
    </Link>
  );
}

export function KpiRow({ items }: { items: { name: string; target: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((k) => (
        <div
          key={k.name}
          className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        >
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{k.name}</div>
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{k.target}</div>
        </div>
      ))}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 transition hover:text-zinc-800 print:hidden dark:hover:text-zinc-200"
    >
      ← {label}
    </Link>
  );
}

/** ຊ່ອງຄົ້ນຫາ (GET form — ບໍ່ຕ້ອງໃຊ້ client component). */
export function ManualSearchBox({
  action,
  defaultValue = "",
  placeholder = "ຄົ້ນຫາໃນຄູ່ມື…",
}: {
  action: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <form method="get" action={action} className="flex flex-1 items-center gap-2 print:hidden">
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        ຄົ້ນຫາ
      </button>
    </form>
  );
}
