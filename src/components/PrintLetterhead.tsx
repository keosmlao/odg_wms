import Barcode from "@/components/Barcode";

/**
 * The ODIEN GROUP letterhead used at the top of every printed WMS document —
 * wordmark + company block on the left, the doc's barcode on the right. Kept in
 * one place so all slips (transfer request, transfer bill, WMS movement) print
 * with an identical head.
 */

/** ODIEN GROUP wordmark (black "ODIEN" over a blue "GROUP" bar) as inline SVG — no external image asset needed. */
export function OdienLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 130" className={className} role="img" aria-label="ODIEN GROUP">
      <text x="0" y="95" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="100" letterSpacing="-4" textLength="300" lengthAdjust="spacingAndGlyphs" fill="#000">ODIEN</text>
      <rect x="45" y="103" width="255" height="24" fill="#2f6da6" />
      <text x="292" y="121" textAnchor="end" fontFamily="Arial, Helvetica, sans-serif" fontStyle="italic" fontWeight="700" fontSize="19" fill="#fff">GROUP</text>
    </svg>
  );
}

export default function PrintLetterhead({ docNo }: { docNo: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4 border-b border-slate-300 pb-2">
      <div className="flex items-start gap-3">
        <OdienLogo className="h-12 w-auto shrink-0" />
        <div className="text-[11px] leading-tight">
          <div>ບ ຂົວຫຼວງ, ມ ຈັນທະບູລີ, ນະຄອນຫຼວງວຽງຈັນ</div>
          <div>Tel: (+856-21) 412663, 412659, 450443, 451434, 263412, fax: 263411</div>
          <div>info@odien.net</div>
        </div>
      </div>
      <div className="w-40 shrink-0 text-center">
        <Barcode value={docNo} height={36} />
        <div className="mt-0.5 font-mono text-[10px]">{docNo}</div>
      </div>
    </div>
  );
}
