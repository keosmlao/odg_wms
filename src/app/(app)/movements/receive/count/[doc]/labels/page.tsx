import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import QRCode from "qrcode";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
import PrintButton from "@/components/ui/PrintButton";
import { DOC_TYPE } from "@/lib/receive";

type HeaderRow = { doc_no: string; wh_code: string | null; wh_name: string | null; po_no: string | null };
type SerialRow = { item_code: string; serial_number: string; item_name: string | null };

/** ISN format = <category(3)><yearCode(1)><7-digit seq>. Underline the year code. */
function Isn({ sn }: { sn: string }) {
  if (sn.length < 4) return <>{sn}</>;
  return (
    <>
      {sn.slice(0, 3)}
      <span style={{ textDecoration: "underline" }}>{sn[3]}</span>
      {sn.slice(4)}
    </>
  );
}

export default async function SnLabelsPage({ params }: { params: Promise<{ doc: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;

  const { doc } = await params;
  const docNo = decodeURIComponent(doc).trim();

  const header = (await query<HeaderRow>(
    `SELECT h.doc_no, h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.ref_doc_no AS po_no
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     WHERE h.doc_no = $1 AND h.doc_type = $2`,
    [docNo, DOC_TYPE.count],
  ))[0];
  if (!header) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && (header.wh_code === null || !accessible.includes(header.wh_code))) {
    return <Notice tone="red" icon={<AlertIcon className="h-5 w-5" />} title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" />;
  }

  const serials = await query<SerialRow>(
    `SELECT s.item_code, s.serial_number,
            COALESCE(d.item_name, inv.name_1) AS item_name
     FROM public.wms_product_receive_serial_detail s
     LEFT JOIN public.wms_product_receive_detail d ON d.doc_no = s.ref_rec_doc AND d.item_code = s.item_code
     LEFT JOIN public.ic_inventory inv ON inv.code = s.item_code
     WHERE s.ref_rec_doc = $1 AND COALESCE(s.ignore_sync,0) <> 2
     ORDER BY s.item_code, s.roworder`,
    [docNo],
  );

  // One QR per serial, encoding the serial number itself (scan → SN).
  const qrBySn = new Map<string, string>();
  await Promise.all(
    serials.map(async (s) => {
      const svg = await QRCode.toString(s.serial_number, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      qrBySn.set(s.serial_number, svg);
    }),
  );

  return (
    <>
      <style>{`
        @media print {
          aside, header, .no-print { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; overflow: visible !important; }
          .sn-sheet { gap: 0 !important; }
          .sn-row {
            width: 100mm !important; height: 30mm !important; gap: 0 !important;
            border: none !important; box-shadow: none !important; border-radius: 0 !important;
            page-break-after: always; break-after: page;
          }
          .sn-label { border: none !important; }
        }
        @page { size: 100mm 30mm; margin: 0; }
        .sn-qr svg { display: block; width: 100%; height: 100%; }
      `}</style>

      <div className="mx-auto w-full max-w-2xl">
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">ພິມປ້າຍ SN · ໜ້າ 100mm = 2 × (50 × 30mm)</div>
            <div className="text-xs text-zinc-500">
              {header.doc_no}{header.po_no ? ` · PO ${header.po_no}` : ""} · {header.wh_code}{header.wh_name ? ` · ${header.wh_name}` : ""} · {serials.length} ປ້າຍ
            </div>
            <div className="mt-1 text-[10px] text-zinc-400">QR = ເລກ SN · ກະດາດກວ້າງ 100mm, 2 label/ແຖວ ແຕ່ລະ label 50×30mm</div>
          </div>
          <div className="flex gap-2">
            <Link href={`/movements/receive/count/${encodeURIComponent(docNo)}`} className="rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">← ກັບໄປ</Link>
            <PrintButton />
          </div>
        </div>

        {serials.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">ໃບກວດນັບນີ້ບໍ່ມີ SN</div>
        ) : (
          <div className="sn-sheet flex flex-col items-center gap-3">
            {Array.from({ length: Math.ceil(serials.length / 2) }, (_, i) => serials.slice(i * 2, i * 2 + 2)).map((pair, ri) => (
              <div key={ri} className="sn-row flex overflow-hidden bg-white ring-1 ring-zinc-300 dark:ring-zinc-700" style={{ width: "100mm", height: "30mm" }}>
                {pair.map((s) => (
                  <div key={s.serial_number} className="sn-label flex items-stretch gap-1 border-r border-dashed border-zinc-300 p-1.5" style={{ width: "50mm", height: "30mm", color: "#000" }}>
                    <div className="sn-qr shrink-0" style={{ width: "19mm", height: "19mm", alignSelf: "center" }} dangerouslySetInnerHTML={{ __html: qrBySn.get(s.serial_number) ?? "" }} />
                    <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
                      <div className="font-mono font-extrabold tracking-tight" style={{ fontSize: "11pt", lineHeight: 1.05 }}>
                        <Isn sn={s.serial_number} />
                      </div>
                      <div className="font-mono font-semibold" style={{ fontSize: "7pt" }}>{s.item_code}</div>
                      <div className="overflow-hidden" style={{ fontSize: "6pt", lineHeight: 1.15, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.item_name ?? "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
