import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Choices the operator must make fresh at every trans_flag=56 confirm — there is
 * no per-warehouse default (see erpPost.ts's now-removed ISSUE_FORMAT_BY_WH):
 *   - departments: the full erp_department_list, for the ERP header's department_code.
 *   - doc_formats: erp_doc_format rows (screen_code 'IO', i.e. goods-issue formats)
 *     filtered to the branch the 122 request itself belongs to — a request filed
 *     under one branch can only be fulfilled against that branch's own doc headers.
 *
 * Query: ?doc=<122 request doc_no>
 * Returns: { departments:[{code,name}], doc_formats:[{code,name,format,branch}] }
 */
type DeptRow = { code: string; name: string | null };
type FormatRow = { code: string; name: string | null; format: string | null; branch: string | null };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const doc = url.searchParams.get("doc")?.trim() ?? "";
  if (!doc) return NextResponse.json({ error: "ຂາດເລກທີໃບຂໍເບີກ" }, { status: 400 });

  const branchRows = await query<{ branch_code: string | null }>(
    `SELECT branch_code FROM public.ic_trans WHERE doc_no = $1 LIMIT 1`,
    [doc],
  );
  const branch = branchRows[0]?.branch_code ?? null;
  if (!branch) return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍເບີກ ຫຼື ບໍ່ມີລະຫັດສາຂາ" }, { status: 404 });

  const [departments, docFormats] = await Promise.all([
    query<DeptRow>(`SELECT code, name_1 AS name FROM public.erp_department_list ORDER BY code ASC`),
    query<FormatRow>(
      `SELECT a.code, a.name_1 AS name, a.format, a.branch_list AS branch
       FROM public.erp_doc_format a
       WHERE a.screen_code = 'IO' AND a.branch_list = $1
       ORDER BY a.code`,
      [branch],
    ),
  ]);

  return NextResponse.json({ departments, doc_formats: docFormats });
}
