// Client+server-safe utilities. Anything that needs the DB or the Next.js
// session (cookies) lives in `deposit-server.ts` so client components can
// import freely from here without pulling server-only modules into the bundle.

export type DepositStatus = "active" | "settled" | "cancelled";

export type DepositRow = {
  deposit_id: number;
  deposit_code: string;
  wh_code: string;
  cust_code: string | null;
  cust_name: string | null;
  start_date: string;
  end_date: string | null;
  status: DepositStatus;
  fee_model: string;
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: string;
  tier2_days_max: number;
  tier2_pct: string;
  tier3_days_max: number;
  tier3_pct: string;
  tier4_pct: string;
  min_charge: string;
  max_charge: string;
  currency: string;
  total_items: number;
  total_qty: string;
  total_value: string;
  settled_fee: string | null;
  settled_days: number | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
  settled_by: number | null;
  settled_at: string | null;
};

export type DepositSettings = {
  fee_model: "tiered_percent";
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: number;
  tier2_days_max: number;
  tier2_pct: number;
  tier3_days_max: number;
  tier3_pct: number;
  tier4_pct: number;
  min_charge: number;
  max_charge: number;
  currency: string;
};

export const DEFAULT_SETTINGS: DepositSettings = {
  fee_model: "tiered_percent",
  free_days_max: 3,
  tier1_days_max: 7,
  tier1_pct: 0.5,
  tier2_days_max: 30,
  tier2_pct: 0.75,
  tier3_days_max: 90,
  tier3_pct: 1.0,
  tier4_pct: 1.5,
  min_charge: 0,
  max_charge: 0,
  // Deposited goods are valued from the sales bills, which are issued in THB.
  currency: "THB",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toNumber(v: string | number | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

export type FeeCalcInput = {
  start_date: string | Date;
  end_date?: string | Date | null;
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: number | string;
  tier2_days_max: number;
  tier2_pct: number | string;
  tier3_days_max: number;
  tier3_pct: number | string;
  tier4_pct: number | string;
  min_charge: number | string;
  max_charge: number | string;
  total_value: number | string;
};

export type FeeCalcResult = {
  duration_days: number;
  is_free: boolean;
  tier: 0 | 1 | 2 | 3 | 4;
  applied_pct: number;
  raw_fee: number;
  fee: number;
  total_value: number;
};

/**
 * Calculate the deposit fee using the tier-based percentage model.
 *
 *   duration ≤ free_days_max → tier 0 (free, fee = 0)
 *   duration ≤ tier1_days_max → tier 1, fee = value × tier1_pct%
 *   duration ≤ tier2_days_max → tier 2
 *   duration ≤ tier3_days_max → tier 3
 *   else                       → tier 4 (open-ended)
 *
 * Duration is the calendar-day delta rounded UP — any partial day counts as
 * a full day. Final fee is clamped to min_charge..max_charge (when > 0).
 */
export function calculateFee(input: FeeCalcInput): FeeCalcResult {
  const start =
    input.start_date instanceof Date
      ? input.start_date
      : new Date(input.start_date);
  const end =
    input.end_date instanceof Date
      ? input.end_date
      : input.end_date
        ? new Date(input.end_date)
        : new Date();

  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const duration = Math.max(1, Math.ceil(diffMs / MS_PER_DAY));

  const free = input.free_days_max || 0;
  const t1 = input.tier1_days_max || 0;
  const t2 = input.tier2_days_max || 0;
  const t3 = input.tier3_days_max || 0;

  let tier: 0 | 1 | 2 | 3 | 4 = 0;
  let pct = 0;
  if (duration <= free) {
    tier = 0;
    pct = 0;
  } else if (duration <= t1) {
    tier = 1;
    pct = toNumber(input.tier1_pct, 0);
  } else if (duration <= t2) {
    tier = 2;
    pct = toNumber(input.tier2_pct, 0);
  } else if (duration <= t3) {
    tier = 3;
    pct = toNumber(input.tier3_pct, 0);
  } else {
    tier = 4;
    pct = toNumber(input.tier4_pct, 0);
  }

  const value = toNumber(input.total_value, 0);
  const raw = (value * pct) / 100;

  const minCharge = toNumber(input.min_charge, 0);
  const maxCharge = toNumber(input.max_charge, 0);
  let final = raw;
  if (minCharge > 0 && tier > 0 && final < minCharge) final = minCharge;
  if (maxCharge > 0 && final > maxCharge) final = maxCharge;

  return {
    duration_days: duration,
    is_free: tier === 0,
    tier,
    applied_pct: pct,
    raw_fee: raw,
    fee: final,
    total_value: value,
  };
}

/** Tier a deposit currently sits in, for aging alerts. */
export type AgingLevel = "free" | "tier1" | "tier2" | "tier3" | "tier4";

export type AgingInfo = {
  days: number;
  level: AgingLevel;
  /** true once the free period is over — the UI paints these red. */
  over: boolean;
  label: string;
  pct: number;
  /** Day count at which the next (more expensive) tier starts, if any. */
  nextAtDays: number | null;
  daysToNext: number | null;
  nextPct: number | null;
  /** Crossing into the next tier within SOON_DAYS. */
  soon: boolean;
};

/** How many days ahead of a tier jump we start warning. */
export const SOON_DAYS = 2;

export type AgingTiers = {
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: number | string;
  tier2_days_max: number;
  tier2_pct: number | string;
  tier3_days_max: number;
  tier3_pct: number | string;
  tier4_pct: number | string;
};

/**
 * Elapsed days for an active deposit, matching `calculateFee`'s rounding
 * (partial day = full day, minimum 1).
 */
export function elapsedDays(
  startDate: string | Date,
  asOf?: string | Date | null,
): number {
  const start =
    startDate instanceof Date ? startDate : new Date(startDate);
  const end = asOf
    ? asOf instanceof Date
      ? asOf
      : new Date(asOf)
    : new Date();
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.ceil(diffMs / MS_PER_DAY));
}

/**
 * Where a deposit sits on the tier ladder, plus how close it is to the next
 * jump. Anything past the free period counts as `over` — the list and detail
 * screens show those in red so long-staying goods stand out.
 */
export function depositAging(
  tiers: AgingTiers,
  startDate: string | Date,
  asOf?: string | Date | null,
): AgingInfo {
  const days = elapsedDays(startDate, asOf);
  const free = tiers.free_days_max || 0;
  const t1 = tiers.tier1_days_max || 0;
  const t2 = tiers.tier2_days_max || 0;
  const t3 = tiers.tier3_days_max || 0;
  const p1 = toNumber(tiers.tier1_pct, 0);
  const p2 = toNumber(tiers.tier2_pct, 0);
  const p3 = toNumber(tiers.tier3_pct, 0);
  const p4 = toNumber(tiers.tier4_pct, 0);

  let level: AgingLevel;
  let pct: number;
  let nextAtDays: number | null;
  let nextPct: number | null;
  if (days <= free) {
    level = "free";
    pct = 0;
    nextAtDays = free + 1;
    nextPct = p1;
  } else if (days <= t1) {
    level = "tier1";
    pct = p1;
    nextAtDays = t1 + 1;
    nextPct = p2;
  } else if (days <= t2) {
    level = "tier2";
    pct = p2;
    nextAtDays = t2 + 1;
    nextPct = p3;
  } else if (days <= t3) {
    level = "tier3";
    pct = p3;
    nextAtDays = t3 + 1;
    nextPct = p4;
  } else {
    level = "tier4";
    pct = p4;
    nextAtDays = null;
    nextPct = null;
  }

  const daysToNext = nextAtDays !== null ? nextAtDays - days : null;
  return {
    days,
    level,
    over: level !== "free",
    label: AGING_LABEL[level],
    pct,
    nextAtDays,
    daysToNext,
    nextPct,
    soon:
      daysToNext !== null &&
      daysToNext <= SOON_DAYS &&
      (nextPct ?? 0) > pct,
  };
}

export const AGING_LABEL: Record<AgingLevel, string> = {
  free: "ໃນໄລຍະຟຣີ",
  tier1: "ເກີນໄລຍະຟຣີ",
  tier2: "ຝາກດົນ",
  tier3: "ຝາກດົນຫຼາຍ",
  tier4: "ຄ້າງດົນເກີນ",
};

/**
 * Colour tokens per aging level. `free` is the only calm state — every level
 * past the free period escalates through red.
 */
export const AGING_TONE: Record<
  AgingLevel,
  { chip: string; dot: string; bar: string; text: string }
> = {
  free: {
    chip:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  tier1: {
    chip:
      "bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
  tier2: {
    chip:
      "bg-rose-100 text-rose-800 ring-rose-300/70 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-900/60",
    dot: "bg-rose-600",
    bar: "bg-rose-600",
    text: "text-rose-700 dark:text-rose-300",
  },
  tier3: {
    chip:
      "bg-red-200 text-red-900 ring-red-400/70 dark:bg-red-950/70 dark:text-red-200 dark:ring-red-800",
    dot: "bg-red-700",
    bar: "bg-red-700",
    text: "text-red-800 dark:text-red-300",
  },
  tier4: {
    chip:
      "bg-red-700 text-white ring-red-800 dark:bg-red-800 dark:text-white dark:ring-red-700",
    dot: "bg-white/90",
    bar: "bg-red-800",
    text: "text-red-900 dark:text-red-200",
  },
};

/**
 * ERP currency codes (erp_currency.code) → ISO symbol. Bills carry the ERP
 * code, so anything read straight from ic_trans / the pending-bill cache has
 * to be translated before it is shown to a human.
 */
const ERP_CURRENCY: Record<string, string> = {
  "01": "THB",
  "1": "THB",
  "02": "LAK",
  "2": "LAK",
  "03": "USD",
  "3": "USD",
  "04": "CNY",
  "4": "CNY",
};

/** ERP code or ISO symbol → ISO symbol (falls back to THB when unknown). */
export function normalizeCurrency(
  code: string | null | undefined,
  fallback = "THB",
): string {
  const c = (code ?? "").trim();
  if (!c) return fallback;
  return ERP_CURRENCY[c] ?? c.toUpperCase();
}

export function formatMoney(value: number | string, currency = "THB") {
  const cur = normalizeCurrency(currency);
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return `0 ${cur}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}`;
}

/** ISO date (or timestamp) → dd-MM-yyyy, the format used on screen and in print. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const s =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

/** ISO timestamp → dd-MM-yyyy HH:mm. */
export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const s = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : formatDate(s);
}

export function formatPct(pct: number | string) {
  const n = typeof pct === "number" ? pct : Number.parseFloat(pct);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
}

/** Human-friendly summary of the configured tiers (for tooltips / settings UI). */
export function tierSummary(s: {
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: number | string;
  tier2_days_max: number;
  tier2_pct: number | string;
  tier3_days_max: number;
  tier3_pct: number | string;
  tier4_pct: number | string;
}): Array<{ range: string; pct: number }> {
  return [
    { range: `1-${s.free_days_max} ມື້`, pct: 0 },
    {
      range: `${s.free_days_max + 1}-${s.tier1_days_max} ມື້`,
      pct: toNumber(s.tier1_pct, 0),
    },
    {
      range: `${s.tier1_days_max + 1}-${s.tier2_days_max} ມື້`,
      pct: toNumber(s.tier2_pct, 0),
    },
    {
      range: `${s.tier2_days_max + 1}-${s.tier3_days_max} ມື້`,
      pct: toNumber(s.tier3_pct, 0),
    },
    { range: `> ${s.tier3_days_max} ມື້`, pct: toNumber(s.tier4_pct, 0) },
  ];
}
