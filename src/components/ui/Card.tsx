import type { ReactNode } from "react";

export type AccentTone =
  | "neutral"
  | "emerald"
  | "red"
  | "aqua"
  | "navy"
  | "amber"
  | "violet"
  | "brand";

const iconColorMap: Record<AccentTone, string> = {
  neutral: "text-zinc-700 dark:text-zinc-200",
  emerald: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  aqua: "text-aqua-600 dark:text-aqua-400",
  navy: "text-brand-900 dark:text-brand-300",
  amber: "text-amber-600 dark:text-amber-400",
  violet: "text-violet-600 dark:text-violet-400",
  brand: "text-brand-600 dark:text-brand-400",
};

const iconBgMap: Record<AccentTone, string> = {
  neutral: "bg-zinc-100 dark:bg-zinc-800",
  emerald: "bg-emerald-50 dark:bg-emerald-950/40",
  red: "bg-red-50 dark:bg-red-950/40",
  aqua: "bg-aqua-50 dark:bg-aqua-950/40",
  navy: "bg-brand-100 dark:bg-brand-900/50",
  amber: "bg-amber-50 dark:bg-amber-950/40",
  violet: "bg-violet-50 dark:bg-violet-950/40",
  brand: "bg-brand-50 dark:bg-brand-950/40",
};

const valueColorMap: Record<AccentTone, string> = {
  neutral: "text-zinc-900 dark:text-zinc-50",
  emerald: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  aqua: "text-aqua-600 dark:text-aqua-400",
  navy: "text-brand-900 dark:text-brand-300",
  amber: "text-amber-600 dark:text-amber-400",
  violet: "text-violet-600 dark:text-violet-400",
  brand: "text-brand-600 dark:text-brand-400",
};

const heroGradientMap: Record<AccentTone, string> = {
  neutral:
    "from-brand-500/10 via-aqua-500/5 to-transparent dark:from-brand-500/15 dark:via-aqua-500/10",
  emerald:
    "from-emerald-500/10 via-teal-500/5 to-transparent dark:from-emerald-500/15 dark:via-teal-500/10",
  red: "from-red-500/10 via-orange-500/5 to-transparent dark:from-red-500/15 dark:via-orange-500/10",
  aqua:
    "from-aqua-500/10 via-sunset-500/5 to-transparent dark:from-aqua-500/15 dark:via-sunset-500/10",
  navy: "from-brand-900/10 via-brand-500/5 to-transparent dark:from-brand-900/25 dark:via-brand-500/10",
  amber:
    "from-amber-500/10 via-orange-500/5 to-transparent dark:from-amber-500/15 dark:via-orange-500/10",
  violet:
    "from-violet-500/10 via-fuchsia-500/5 to-transparent dark:from-violet-500/15 dark:via-fuchsia-500/10",
  brand:
    "from-brand-500/10 via-aqua-500/5 to-transparent dark:from-brand-500/15 dark:via-aqua-500/10",
};

export function accentClasses(tone: AccentTone) {
  return {
    iconColor: iconColorMap[tone],
    iconBg: iconBgMap[tone],
    valueColor: valueColorMap[tone],
    heroGradient: heroGradientMap[tone],
  };
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shadow-card rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function Hero({
  title,
  description,
  icon,
  tone = "neutral",
  chips,
  right,
  compact = false,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  tone?: AccentTone;
  chips?: ReactNode;
  right?: ReactNode;
  compact?: boolean;
}) {
  const a = accentClasses(tone);
  return (
    <header className="shadow-card relative overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div
        className={`pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br ${a.heroGradient} blur-3xl`}
      />
      <div
        className={`relative flex flex-wrap items-start justify-between gap-6 ${compact ? "p-4" : "p-7"}`}
      >
        <div className="min-w-0">
          <div className={`flex items-center ${compact ? "gap-2.5" : "gap-3.5"}`}>
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${a.iconBg} ${a.iconColor} ring-current/10 ${compact ? "h-9 w-9" : "h-12 w-12"}`}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h1
                className={`font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${compact ? "text-lg" : "text-2xl"}`}
              >
                {title}
              </h1>
              {description && (
                <p
                  className={`mt-0.5 text-zinc-500 dark:text-zinc-400 ${compact ? "text-xs" : "text-sm"}`}
                >
                  {description}
                </p>
              )}
            </div>
          </div>
          {chips && (
            <div
              className={`flex flex-wrap items-center gap-1.5 text-xs ${compact ? "mt-2.5" : "mt-4"}`}
            >
              {chips}
            </div>
          )}
        </div>
        {right && <div className="text-right">{right}</div>}
      </div>
    </header>
  );
}

export function Chip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "primary" | "emerald" | "red" | "aqua" | "navy" | "amber" | "brand";
}) {
  const colorMap: Record<string, string> = {
    default:
      "bg-white text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700",
    primary:
      "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900",
    emerald:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/50",
    red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/50",
    aqua:
      "bg-aqua-50 text-aqua-700 ring-1 ring-inset ring-aqua-200 dark:bg-aqua-950/50 dark:text-aqua-300 dark:ring-aqua-900/50",
    navy: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900/50",
    amber:
      "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/50",
    brand:
      "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900/50",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colorMap[tone]}`}
    >
      {children}
    </span>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
  highlight = false,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  tone?: AccentTone;
  highlight?: boolean;
  compact?: boolean;
}) {
  const a = accentClasses(tone);
  return (
    <div
      className={`shadow-card hover:shadow-card-hover group relative overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 transition-all hover:-translate-y-0.5 hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-zinc-700 ${compact ? "p-3.5" : "p-5"}`}
    >
      {highlight && (
        <div
          className={`pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br ${a.heroGradient} opacity-60 blur-2xl transition-opacity group-hover:opacity-100`}
        />
      )}
      <div className="relative">
        <div className={`flex items-center ${compact ? "gap-2" : "gap-2.5"}`}>
          <span
            className={`flex shrink-0 items-center justify-center rounded-xl ${highlight ? `${a.iconBg} ${a.iconColor}` : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"} ${compact ? "h-7 w-7" : "h-9 w-9"}`}
          >
            {icon}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {label}
          </span>
        </div>
        <div
          className={`font-mono font-semibold tracking-tight tabular-nums ${highlight ? a.valueColor : "text-zinc-900 dark:text-zinc-50"} ${compact ? "mt-1.5 text-lg" : "mt-3 text-2xl"}`}
        >
          {typeof value === "number" ? value.toLocaleString("en-US") : value}
        </div>
        {sub && (
          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
      {icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-100 to-zinc-50 text-zinc-400 ring-1 ring-zinc-200 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-500 dark:ring-zinc-800">
          {icon}
        </div>
      )}
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </div>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({
  icon,
  tone = "amber",
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  tone?: "amber" | "navy" | "red" | "emerald" | "brand";
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const ringMap: Record<string, string> = {
    amber: "ring-amber-200 dark:ring-amber-900/50",
    navy: "ring-brand-200 dark:ring-brand-900/50",
    red: "ring-red-200 dark:ring-red-900/50",
    emerald: "ring-emerald-200 dark:ring-emerald-900/50",
    brand: "ring-brand-200 dark:ring-brand-900/50",
  };
  const bgMap: Record<string, string> = {
    amber:
      "bg-gradient-to-br from-amber-50 to-amber-50/30 dark:from-amber-950/30 dark:to-amber-950/10",
    navy: "bg-gradient-to-br from-brand-50 to-brand-50/30 dark:from-brand-950/30 dark:to-brand-950/10",
    red: "bg-gradient-to-br from-red-50 to-red-50/30 dark:from-red-950/30 dark:to-red-950/10",
    emerald:
      "bg-gradient-to-br from-emerald-50 to-emerald-50/30 dark:from-emerald-950/30 dark:to-emerald-950/10",
    brand:
      "bg-gradient-to-br from-brand-50 to-aqua-50/30 dark:from-brand-950/30 dark:to-brand-950/10",
  };
  const iconBg: Record<string, string> = {
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    navy: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    emerald:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    brand:
      "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400",
  };
  const titleColor: Record<string, string> = {
    amber: "text-amber-900 dark:text-amber-200",
    navy: "text-brand-900 dark:text-brand-200",
    red: "text-red-900 dark:text-red-200",
    emerald: "text-emerald-900 dark:text-emerald-200",
    brand: "text-brand-900 dark:text-brand-200",
  };
  const subColor: Record<string, string> = {
    amber: "text-amber-700 dark:text-amber-300",
    navy: "text-brand-700 dark:text-brand-300",
    red: "text-red-700 dark:text-red-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
    brand: "text-brand-700 dark:text-brand-300",
  };
  return (
    <div className={`rounded-2xl ${bgMap[tone]} p-4 ring-1 ${ringMap[tone]}`}>
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconBg[tone]}`}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${titleColor[tone]}`}>
            {title}
          </div>
          {description && (
            <div className={`mt-1 text-xs leading-relaxed ${subColor[tone]}`}>
              {description}
            </div>
          )}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
