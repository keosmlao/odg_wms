"use client";

import type { ReactNode, RefObject } from "react";
import RSelect, { type ROption } from "@/components/ui/RSelect";

export type DestType = "location" | "pallet";

/**
 * Shared "scan-card" presentation for every goods-receipt screen, so the PO
 * count sheet, the sale/issue-return wizard, and the in-transit transfer
 * receive all look and behave the same. The reference design lives in
 * transfer-receive/TransitMoveClient.tsx; these are the extracted pieces.
 */

export function BackLink({ onClick, label = "← ກັບໄປລາຍການ" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 transition hover:text-slate-800 cursor-pointer">
      {label}
    </button>
  );
}

/** Doc header: code + badges on the left, a big got/want counter + bar on the right. */
export function ReceiveHeaderCard({ docNo, badges, verb, got, want, children }: {
  docNo: ReactNode;
  badges?: ReactNode;
  verb: string;
  got: number;
  want: number;
  children?: ReactNode;
}) {
  const pct = want > 0 ? Math.min(100, Math.round((got / want) * 100)) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 to-transparent px-5 py-4">
        <div className="min-w-0">
          <div className="font-mono text-lg font-black tracking-tight text-slate-800">{docNo}</div>
          {badges && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">{badges}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{verb} ແລ້ວ</div>
          <div className="font-mono text-3xl font-black leading-none text-emerald-600">{got}<span className="text-lg text-slate-300">/{want}</span></div>
          <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
      {children && <div className="space-y-2 px-5 py-3">{children}</div>}
    </div>
  );
}

/** The big green "scan a serial" box shown when a doc has serialized lines. */
export function ScanBox({ label, inputRef, value, onChange, onEnter, placeholder = "scan SN / ISN …" }: {
  label: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onEnter: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3.5">
      <label className="mb-1 block text-[11px] font-bold text-emerald-700">{label}</label>
      <input
        ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(value); } }}
        autoFocus placeholder={placeholder}
        className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500/30"
      />
    </div>
  );
}

/** One item, card style: code + SN badge + name, a "want" figure, progress bar, action row. */
export function ItemCard({ code, name, isSn, want, wantLabel = "ຄ້າງ", unit, got, children }: {
  code: string;
  name: string | null;
  isSn?: boolean;
  want: number;
  wantLabel?: string;
  unit?: string | null;
  got: number;
  children?: ReactNode;
}) {
  const pct = want > 0 ? Math.min(100, Math.round((got / want) * 100)) : 0;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${got > 0 ? "border-emerald-300" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-slate-400">{code}{isSn && <span className="ml-1.5 rounded bg-violet-100 px-1 text-[9px] font-bold text-violet-700">SN</span>}</div>
          <div className="truncate font-medium text-slate-800" title={name ?? ""}>{name ?? code}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase text-slate-400">{wantLabel}</div>
          <div className="font-mono text-lg font-black text-amber-600">{want}<span className="text-xs text-slate-400"> {unit ?? ""}</span></div>
        </div>
      </div>
      <div className="px-4"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${got >= want && want > 0 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} /></div></div>
      {children && <div className="flex flex-wrap items-center gap-2 p-4 pt-3">{children}</div>}
    </div>
  );
}

/** Putaway suggestion chips: locations already holding the item + empty ones. */
export function PutawayChips({ same, empty, current, onPick, nameOf = (c) => c }: {
  same: { location: string; qty: string }[];
  empty: string[];
  current: string;
  onPick: (code: string) => void;
  nameOf?: (code: string) => string;
}) {
  if (same.length === 0 && empty.length === 0) return null;
  const sameCodes = new Set(same.map((s) => s.location));
  const emptyShown = empty.filter((e) => !sameCodes.has(e)).slice(0, 12);
  return (
    <>
      {same.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-emerald-700">📦 ມີສິນຄ້ານີ້ຢູ່ແລ້ວ:</span>
          {same.map((s, i) => (
            <button key={`${s.location}-${i}`} type="button" onClick={() => onPick(s.location)} title={`${nameOf(s.location)} · มี ${Number.parseFloat(s.qty)}`}
              className={`rounded-md px-2 py-1 text-[11px] font-mono ring-1 transition cursor-pointer ${current === s.location ? "bg-emerald-600 text-white ring-emerald-600" : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"}`}>
              {nameOf(s.location)} <span className="opacity-70">·{Number.parseFloat(s.qty)}</span>
            </button>
          ))}
        </div>
      )}
      {emptyShown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500">🟢 ບ່ອນວ່າງ:</span>
          {emptyShown.map((loc) => (
            <button key={loc} type="button" onClick={() => onPick(loc)}
              className={`rounded-md px-2 py-1 text-[11px] font-mono ring-1 transition cursor-pointer ${current === loc ? "bg-slate-700 text-white ring-slate-700" : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100"}`}>{nameOf(loc)}</button>
          ))}
        </div>
      )}
    </>
  );
}

/** Location ↔ Pallet segmented toggle. */
export function DestToggle({ value, onChange }: { value: DestType; onChange: (t: DestType) => void }) {
  return (
    <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[11px] font-semibold">
      {([["location", "Location"], ["pallet", "Pallet"]] as const).map(([t, label]) => (
        <button key={t} type="button" onClick={() => onChange(t)} className={`rounded px-2.5 py-1 transition ${value === t ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>{label}</button>
      ))}
    </div>
  );
}

/**
 * The unified putaway control used by every receive screen: a Location|Pallet
 * toggle (optional), a searchable dropdown, and the 📦/🟢 suggestion chips.
 */
export function PutawayPicker({
  allowPallet = true,
  dest, onDest,
  locValue, onLoc, locOptions,
  palValue = "", onPal = () => {}, palOptions = [],
  same, empty, nameOf = (c) => c,
}: {
  allowPallet?: boolean;
  dest: DestType;
  onDest: (t: DestType) => void;
  locValue: string;
  onLoc: (v: string) => void;
  locOptions: ROption[];
  palValue?: string;
  onPal?: (v: string) => void;
  palOptions?: ROption[];
  same: { location: string; qty: string }[];
  empty: string[];
  nameOf?: (code: string) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {allowPallet && <DestToggle value={dest} onChange={onDest} />}
        <div className="min-w-[240px] flex-1">
          {dest === "location"
            ? <RSelect value={locValue} options={locOptions} onChange={onLoc} placeholder="— ເລືອກ location —" />
            : <RSelect value={palValue} options={palOptions} onChange={onPal} placeholder="— ເລືອກ pallet —" />}
        </div>
      </div>
      {dest === "location" && <PutawayChips same={same} empty={empty} current={locValue} onPick={onLoc} nameOf={nameOf} />}
    </div>
  );
}

/** Inline status banner with an optional print link. */
export function Banner({ tone, text, printHref }: { tone: "ok" | "err"; text: string; printHref?: string | null }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
      <span>{text}</span>
      {tone === "ok" && printHref && (
        <a href={printHref} target="_blank" rel="noopener" className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">🖨 ພິມໃບຮັບ</a>
      )}
    </div>
  );
}

/** Sticky bottom action bar: running total on the left, confirm button on the right. */
export function StickyFooter({ leftText, onSubmit, disabled, submitting, label }: {
  leftText: ReactNode;
  onSubmit: () => void;
  disabled: boolean;
  submitting: boolean;
  label: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-600">{leftText}</span>
        <button type="button" onClick={onSubmit} disabled={disabled}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-7 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-98 disabled:opacity-50 cursor-pointer">
          {submitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "✓"}
          {label}
        </button>
      </div>
    </div>
  );
}
