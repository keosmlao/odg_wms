import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/Icons";
import PrintButton from "./PrintButton";

type SessionInfo = {
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  name: string | null;
  count_date: string;
};

type LabelRow = {
  label_id: number;
  label_code: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
};

/**
 * Determine the base URL the QR codes should encode. Priority:
 *   1. NEXT_PUBLIC_APP_URL (production override)
 *   2. x-forwarded-* headers (behind proxy / tunnel)
 *   3. Host header from the request
 */
async function getBaseUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const h = await headers();
  const proto =
    h.get("x-forwarded-proto") ??
    (h.get("host")?.includes("localhost") ? "http" : "https");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export default async function PrintLabelsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }
  const { sessionId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(sid)) notFound();

  const info = (
    await query<SessionInfo & { wh_code: string }>(
      `SELECT s.session_code, s.wh_code,
              w.name_1 AS wh_name,
              s.name, s.count_date::text
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
       WHERE s.session_id = $1`,
      [sid],
    )
  )[0];
  if (!info) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(info.wh_code)) {
    return (
      <Notice
        tone="red"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
      />
    );
  }

  const labels = await query<LabelRow>(
    `SELECT label_id, label_code, note, rack_code, location_code
     FROM public.wms_stocktake_label
     WHERE session_id = $1
     ORDER BY label_code`,
    [sid],
  );

  // Generate QR SVGs server-side. Each QR encodes the URL to the counter UI
  // for that label so the operator can scan + jump straight to counting.
  const baseUrl = await getBaseUrl();
  const qrByLabel = new Map<number, string>();
  await Promise.all(
    labels.map(async (l) => {
      const url = `${baseUrl}/stocktake/${sid}/count/${l.label_id}`;
      const svg = await QRCode.toString(url, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#0000" },
      });
      qrByLabel.set(l.label_id, svg);
    }),
  );

  return (
    <>
      <style>{`
        @media print {
          aside, body > div > div > header { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .no-print { display: none !important; }
          .print-page { background: white !important; padding: 0 !important; }
          .print-label {
            page-break-inside: avoid;
            break-inside: avoid;
            border: 2px dashed #999 !important;
          }
        }
        @page { margin: 10mm; }
        .qr-box svg { display: block; width: 100%; height: 100%; }
      `}</style>

      <div className="print-page mx-auto w-full max-w-7xl">
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              ພິມປ້າຍກວດນັບ (ມີ QR code)
            </div>
            <div className="text-xs text-zinc-500">
              {info.session_code} · {info.wh_code}
              {info.wh_name ? ` · ${info.wh_name}` : ""} · {labels.length} ປ້າຍ
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-400">
              QR → {baseUrl}/stocktake/{sid}/count/{"<label_id>"}
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/stocktake/${sid}`}
              className="rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            >
              ← ກັບໄປ
            </Link>
            <PrintButton />
          </div>
        </div>

        {baseUrl.includes("localhost") && (
          <div className="no-print mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50">
            ⚠️ QR ໃຊ້ URL <span className="font-mono">{baseUrl}</span> —
            ມືຖືພາຍນອກອາດເຂົ້າບໍ່ໄດ້. ຕັ້ງ{" "}
            <span className="font-mono">NEXT_PUBLIC_APP_URL</span> ໃນ{" "}
            <span className="font-mono">.env</span> ສຳລັບ production.
          </div>
        )}

        {labels.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            ຍັງບໍ່ມີປ້າຍສຳລັບພິມ
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {labels.map((l) => (
              <div
                key={l.label_id}
                className="print-label flex aspect-[4/3] flex-col items-center justify-between rounded-2xl bg-white p-3 text-center shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
              >
                <div className="w-full">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    {info.session_code}
                  </div>
                  <div className="mt-0.5 font-mono text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {l.label_code}
                  </div>
                </div>

                <div
                  className="qr-box my-1 h-24 w-24"
                  dangerouslySetInnerHTML={{
                    __html: qrByLabel.get(l.label_id) ?? "",
                  }}
                />

                <div className="w-full">
                  <div className="text-[9px] text-zinc-500">
                    {info.wh_code}
                    {info.wh_name ? ` · ${info.wh_name}` : ""}
                  </div>
                  {(l.rack_code || l.location_code) && (
                    <div className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      📍 {l.rack_code ?? "—"}
                      {l.location_code && ` / ${l.location_code}`}
                    </div>
                  )}
                  <div className="text-[9px] text-zinc-400">
                    {info.count_date}
                  </div>
                  {l.note && !l.rack_code && !l.location_code && (
                    <div className="mt-0.5 truncate text-[10px] text-zinc-600">
                      {l.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
