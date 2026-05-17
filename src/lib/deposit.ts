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
  currency: "LAK",
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

export function formatMoney(value: number | string, currency = "LAK") {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return `0 ${currency}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
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
