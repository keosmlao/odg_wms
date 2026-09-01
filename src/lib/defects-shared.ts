/**
 * Defective-goods register — types and labels shared by server and client.
 * Keep this file free of server-only imports (see `defects.ts` for those).
 */

/** Condition grade recorded per entry. Matches the legacy form's options. */
export const DEFECT_GRADES = ["A", "B", "C"] as const;
export type DefectGrade = (typeof DEFECT_GRADES)[number];

export const DEFECT_GRADE_LABEL: Record<DefectGrade, string> = {
  A: "A · ຍັງຂາຍໄດ້",
  B: "B · ຕຳນິເລັກນ້ອຍ",
  C: "C · ເສີຍຫາຍໜັກ",
};

/** status column of odg_product_defect. */
export const DEFECT_STATUS = { pending: 0, dispatched: 1 } as const;
export type DefectStatus = (typeof DEFECT_STATUS)[keyof typeof DEFECT_STATUS];

export function isDefectGrade(v: unknown): v is DefectGrade {
  return typeof v === "string" && (DEFECT_GRADES as readonly string[]).includes(v);
}

/** How the balance reports roll entries up. */
export type DefectGrouping = "warehouse" | "item";

/** One group in the balance reports (item, or item+warehouse). */
export type DefectSummaryRow = {
  ic_code: string;
  ic_name: string | null;
  qty: string;
  unit_code: string | null;
  item_brand: string | null;
  /** null when grouping by item across all warehouses. */
  warehouse: string | null;
  warehouse_name: string | null;
  /** Number of individual entries rolled up into this row. */
  entries: number;
  /** Registration date of the most recent entry, 'DD-MM-YYYY HH24:MI'. */
  last_register: string | null;
  images: number;
  /** Entries per condition grade within this group. */
  grade_a: number;
  grade_b: number;
  grade_c: number;
  grade_none: number;
};

/** One registered entry (a single row of odg_product_defect). */
export type DefectEntry = {
  code_ref: string;
  ic_code: string;
  ic_name: string | null;
  qty: string;
  unit_code: string | null;
  item_brand: string | null;
  warehouse: string | null;
  warehouse_name: string | null;
  sn: string | null;
  remark: string | null;
  grade: string | null;
  status: number;
  date_register: string | null;
  images: number;
  /**
   * The entry's photos, fetched with the row. Carried on the entry so a table of
   * 50 rows can show thumbnails from one query instead of 50 follow-up requests.
   */
  photos: DefectImage[];
};

export type DefectImage = { line_number: number; image_url: string; url: string };

export type DefectWarehouseOption = { code: string; name: string | null };
export type DefectShelfOption = {
  code: string;
  name: string | null;
  wh_code: string;
  wh_name: string | null;
};
