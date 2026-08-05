import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  buildDepositListQuery,
  type AgingFilter,
  type DepositListRow,
} from "@/lib/deposit-server";
import { calculateFee, depositAging, formatDate } from "@/lib/deposit";

const EXPORT_LIMIT = 10000;

/**
 * CSV export of the deposit list. Accepts the same filters as /deposits so
 * "what you see is what you export" — status, free-text search, start-date
 * range and the aging bucket.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const get = (k: string) => (url.searchParams.get(k) ?? "").trim();
  const agingRaw = get("aging");
  const aging: AgingFilter =
    agingRaw === "over" ||
    agingRaw === "soon" ||
    agingRaw === "tier2" ||
    agingRaw === "tier3" ||
    agingRaw === "tier4"
      ? agingRaw
      : "";

  const { sql, args } = buildDepositListQuery(
    {
      status: get("status"),
      q: get("q"),
      aging,
      from: get("from"),
      to: get("to"),
    },
    accessibleWarehouses(session),
    EXPORT_LIMIT,
  );
  const rows = await query<DepositListRow>(sql, args);

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "deposit_code",
    "status",
    "wh_code",
    "wh_name",
    "cust_code",
    "cust_name",
    "sale_name",
    "department",
    "bill_no",
    "start_date",
    "end_date",
    "days",
    "aging",
    "bills",
    "items",
    "qty",
    "value",
    "currency",
    "fee",
    "created_at",
    "created_by",
  ];

  const body = rows.map((r) => {
    const isActive = r.status === "active";
    const age = isActive ? depositAging(r, r.start_date) : null;
    const fee =
      r.settled_fee !== null
        ? Number.parseFloat(r.settled_fee)
        : isActive
          ? calculateFee({
              start_date: r.start_date,
              free_days_max: r.free_days_max,
              tier1_days_max: r.tier1_days_max,
              tier1_pct: r.tier1_pct,
              tier2_days_max: r.tier2_days_max,
              tier2_pct: r.tier2_pct,
              tier3_days_max: r.tier3_days_max,
              tier3_pct: r.tier3_pct,
              tier4_pct: r.tier4_pct,
              min_charge: r.min_charge,
              max_charge: r.max_charge,
              total_value: r.total_value,
            }).fee
          : 0;
    return [
      r.deposit_code,
      r.status,
      r.wh_code,
      r.wh_name ?? "",
      r.cust_code ?? "",
      r.cust_name ?? "",
      r.sale_display ?? r.sale_name ?? "",
      r.dept_names ?? "",
      r.bill_docs ?? "",
      formatDate(r.start_date),
      r.end_date ? formatDate(r.end_date) : "",
      isActive ? (age?.days ?? r.days_elapsed) : (r.settled_days ?? ""),
      age ? age.label : "",
      r.bill_count,
      r.total_items,
      r.total_qty,
      r.total_value,
      r.currency,
      fee,
      formatDate(r.created_at),
      r.created_employee ?? "",
    ]
      .map(esc)
      .join(",");
  });

  // BOM so Excel opens the Lao text in UTF-8.
  const csv = "﻿" + [header.join(","), ...body].join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deposits_${stamp}.csv"`,
    },
  });
}
