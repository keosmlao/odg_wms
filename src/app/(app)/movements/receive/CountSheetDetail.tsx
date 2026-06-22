"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, ArrowDownIcon, CheckIcon } from "@/components/ui/Icons";
import RSelect, { type ROption } from "@/components/ui/RSelect";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { estimatePalletPositions } from "@/lib/capacity";

type Header = { doc_no: string; doc_date: string | null; doc_time: string | null; status: number | null; wh_code: string | null; wh_name: string | null; supplier_code: string | null; po_no: string | null; pack_no: string | null; remark: string | null };
type LineRow = { item_code: string; item_name: string | null; unit_code: string | null; qty: string; is_isn: boolean; pallet?: string | null; stack?: string | null };
type SerialRow = { item_code: string; serial_number: string; mfd_date: string | null; expire_date: string | null };
type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };
type DestType = "location" | "pallet";
type WorkLine = { item_code: string; item_name: string | null; unit_code: string | null; isIsn: boolean; qty: string; received: string; serials: string[]; recvSerials: string[]; cancelSerials: string[]; mfd: string; expire: string; showSn: boolean; palletCapacity: number; stack: number; destType: DestType; rack: string; location: string; pallet: string };

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}
function parsedQty(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
/**
 * Actual received qty.
 *  • ISN line → number of serials the user marked as received (rest are held).
 *  • non-ISN → numeric input, clamped to [0, counted]; empty → full counted.
 */
function receivedQty(l: { isIsn: boolean; qty: string; received: string; serials: string[]; recvSerials: string[] }): number {
  if (l.isIsn) {
    const total = l.serials.filter((s) => s.trim() !== "").length;
    return Math.min(total, l.recvSerials.length);
  }
  const counted = Math.round(parsedQty(l.qty) ?? 0);
  if (l.received.trim() === "") return counted;
  const n = Math.round(Number.parseFloat(l.received));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(counted, n);
}

function DestToggle({ value, onChange }: { value: DestType; onChange: (t: DestType) => void }) {
  return (
    <div className="inline-flex rounded-md bg-zinc-100 p-0.5 text-[10px] font-semibold dark:bg-zinc-800">
      {([["location", "Location"], ["pallet", "Pallet"]] as const).map(([t, label]) => (
        <button key={t} type="button" onClick={() => onChange(t)} className={`rounded px-2.5 py-1 transition ${value === t ? "bg-white text-emerald-600 shadow-sm dark:bg-zinc-900 dark:text-emerald-400" : "text-zinc-500"}`}>{label}</button>
      ))}
    </div>
  );
}

export default function CountSheetDetail({ docNo }: { docNo: string }) {
  const router = useRouter();
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [remark, setRemark] = useState("");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [globalDest, setGlobalDest] = useState<DestType>("location");
  const [globalLoc, setGlobalLoc] = useState("");
  const [globalPallet, setGlobalPallet] = useState("");
  const [mode, setMode] = useState<"all" | "line">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receive/count/${encodeURIComponent(docNo)}`);
        const data = (await res.json()) as { header?: Header; lines?: LineRow[]; serials?: SerialRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.header) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setHeader(data.header);
        setRemark(data.header.remark ?? "");
        const snByItem = new Map<string, SerialRow[]>();
        for (const s of data.serials ?? []) {
          const a = snByItem.get(s.item_code); if (a) a.push(s); else snByItem.set(s.item_code, [s]);
        }
        setLines((data.lines ?? []).map((l) => {
          const qty = Math.round(Number.parseFloat(l.qty) || 0);
          const manual = snByItem.get(l.item_code) ?? [];
          const serials = l.is_isn ? Array.from({ length: qty }, (_, i) => manual[i]?.serial_number ?? "") : [];
          // Default: every reserved serial is received (full). Unselect → held;
          // mark again → cancelled.
          const recvSerials = serials.filter((s) => s.trim() !== "");
          return { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, isIsn: l.is_isn, qty: l.qty, received: "", serials, recvSerials, cancelSerials: [], mfd: manual[0]?.mfd_date ?? "", expire: manual[0]?.expire_date ?? "", showSn: false, palletCapacity: Number.parseFloat(l.pallet ?? "") || 0, stack: Number.parseFloat(l.stack ?? "") || 0, destType: "location" as DestType, rack: "", location: "", pallet: "" };
        }));
        if (data.header.wh_code) {
          const lr = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(data.header.wh_code)}`);
          const ld = (await lr.json()) as { racks?: RackOption[]; locations?: LocationOption[]; pallets?: PalletOption[] };
          if (!cancelled) { setRacks(ld.racks ?? []); setLocations(ld.locations ?? []); setPallets(ld.pallets ?? []); }
        }
      } catch (e) {
        if (!cancelled) showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docNo]);

  // Lookups: codes → display names + a location/pallet's own rack/location.
  const rackName = useMemo(() => new Map(racks.map((r) => [r.code, r.name || r.code])), [racks]);
  const locByCode = useMemo(() => new Map(locations.map((l) => [l.code, l])), [locations]);
  const palByCode = useMemo(() => new Map(pallets.map((p) => [p.code, p])), [pallets]);

  // Searchable options — labels are NAMES, not codes (sub-line shows the rack).
  const locOptions: ROption[] = useMemo(
    () => locations.map((l) => ({ value: l.code, label: l.name || l.code, sub: l.rack_code ? `rack ${rackName.get(l.rack_code) ?? l.rack_code}` : undefined })),
    [locations, rackName],
  );
  const palOptions: ROption[] = useMemo(
    () => pallets.map((p) => ({ value: p.code, label: p.name || p.code, sub: p.location ? (locByCode.get(p.location)?.name || p.location) : undefined })),
    [pallets, locByCode],
  );

  function setLine(itemCode: string, patch: Partial<WorkLine>) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, ...patch } : l)));
  }
  // Picking a location fills its rack; picking a pallet fills the pallet's own
  // location + rack so stock lands at the right shelf.
  function pickLocation(itemCode: string, code: string) {
    setLine(itemCode, { destType: "location", location: code, rack: locByCode.get(code)?.rack_code ?? "", pallet: "" });
  }
  function pickPallet(itemCode: string, code: string) {
    const p = palByCode.get(code);
    setLine(itemCode, { destType: "pallet", pallet: code, location: p?.location ?? "", rack: p?.rack ?? "" });
  }
  // Resolve the all-at-once destination to {rack, location, pallet}.
  function globalDestination() {
    if (globalDest === "pallet") {
      const p = palByCode.get(globalPallet);
      return { rack: p?.rack ?? "", location: p?.location ?? "", pallet: globalPallet };
    }
    return { rack: locByCode.get(globalLoc)?.rack_code ?? "", location: globalLoc, pallet: "" };
  }
  function toggleSn(l: WorkLine) {
    const n = Math.max(0, Math.round(parsedQty(l.qty) ?? 0));
    const serials = l.serials.length === n ? l.serials : Array.from({ length: n }, (_, i) => l.serials[i] ?? "");
    setLine(l.item_code, { showSn: !l.showSn, serials });
  }
  function setSerial(itemCode: string, idx: number, value: string) {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode ? { ...l, serials: l.serials.map((s, i) => (i === idx ? value : s)) } : l)));
  }
  // Cycle a single serial through: received → held → cancelled → received.
  function cycleSerial(itemCode: string, sn: string) {
    setLines((prev) => prev.map((l) => {
      if (l.item_code !== itemCode) return l;
      const isRecv = l.recvSerials.includes(sn);
      const isCancel = l.cancelSerials.includes(sn);
      if (isRecv) return { ...l, recvSerials: l.recvSerials.filter((s) => s !== sn) }; // → held
      if (!isCancel) return { ...l, cancelSerials: [...l.cancelSerials, sn] }; // held → cancelled
      return { ...l, cancelSerials: l.cancelSerials.filter((s) => s !== sn), recvSerials: [...l.recvSerials, sn] }; // → received
    }));
  }
  // Bulk: "received" → all received; "held" → all held (clears cancel too).
  function setAllSerials(itemCode: string, mode: "recv" | "hold") {
    setLines((prev) => prev.map((l) => (l.item_code === itemCode
      ? { ...l, recvSerials: mode === "recv" ? l.serials.filter((s) => s.trim() !== "") : [], cancelSerials: [] }
      : l)));
  }
  // received + cancelled = accounted; the remainder is held.
  const snCounts = (l: WorkLine) => {
    const total = l.serials.filter((s) => s.trim() !== "").length;
    const recv = Math.min(total, l.recvSerials.length);
    const cancel = l.cancelSerials.length;
    return { total, recv, cancel, hold: Math.max(0, total - recv - cancel) };
  };

  // qty only — SN (ISN) is auto-generated/locked server-side, not sent from here.
  const payloadLines = () =>
    lines.filter((l) => (parsedQty(l.qty) ?? 0) > 0).map((l) => ({
      item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: parsedQty(l.qty),
    }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/receive/count/${encodeURIComponent(docNo)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark, lines: payloadLines() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", "ບັນທຶກການແກ້ໄຂແລ້ວ");
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally { setSaving(false); }
  }

  async function postToWms() {
    const activeLines = lines.filter((l) => (parsedQty(l.qty) ?? 0) > 0);
    const receivingLines = activeLines.filter((l) => receivedQty(l) > 0);
    if (receivingLines.length === 0) { showToast("err", "ບໍ່ມີຈຳນວນຮັບຈິງ (ຮັບຈິງ = 0 ທຸກລາຍການ)"); return; }
    if (mode === "all") {
      const g = globalDestination();
      if (!g.location && !g.pallet) { showToast("err", "ກະລຸນາເລືອກ location ຫຼື pallet"); return; }
    } else {
      const missing = receivingLines.find((l) => !l.location && !l.pallet);
      if (missing) { showToast("err", `${missing.item_code}: ເລືອກ location ຫຼື pallet`); return; }
    }
    setPosting(true);
    try {
      // Persist any qty edits first, then post.
      const put = await fetch(`/api/receive/count/${encodeURIComponent(docNo)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark, lines: payloadLines() }),
      });
      const pd = (await put.json()) as { ok?: boolean; error?: string };
      if (!put.ok || !pd.ok) throw new Error(pd.error ?? "ບັນທຶກກ່ອນຮັບບໍ່ສຳເລັດ");

      const postLines = activeLines.map((l) => {
        const total = l.serials.filter((s) => s.trim() !== "").length;
        const partial = l.isIsn && receivedQty(l) < total; // some serials held/cancelled
        return {
          item_code: l.item_code,
          received: receivedQty(l),
          // Partial ISN line → tell the server exactly which serials arrived,
          // and which were cancelled (the rest are held for later reuse).
          ...(partial ? { serials: l.recvSerials, cancelSerials: l.cancelSerials } : {}),
          ...(mode === "line" ? { rack: l.rack, location: l.location, pallet: l.pallet } : {}),
        };
      });
      const postBody = mode === "all"
        ? { remark, ...globalDestination(), lines: postLines }
        : { remark, lines: postLines };
      const res = await fetch(`/api/receive/count/${encodeURIComponent(docNo)}/post`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = (await res.json()) as { ok?: boolean; receive_code?: string; serials?: number; held?: number; cancelled?: number; remaining?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const sn = data.serials ? ` · SN ${data.serials}` : "";
      const vd = data.held ? ` · ພັກ ${data.held}` : "";
      const cn = data.cancelled ? ` · ຍົກເລີກ ${data.cancelled}` : "";
      const rest = data.remaining ? ` · ໃບຍັງຄ້າງ ${data.remaining} (ຮັບຕໍ່ໄດ້)` : "";
      showToast("ok", `ຮັບເຂົ້າ WMS ${data.receive_code} ສຳເລັດ${sn}${vd}${cn}${rest}`);
      setTimeout(() => router.push("/movements/receive?tab=count"), 900);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally { setPosting(false); }
  }

  async function discard() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/receive/count/${encodeURIComponent(docNo)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.push("/movements/receive?tab=count");
    } catch (e) {
      setConfirmDelete(false);
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setDeleting(false);
    }
  }

  const inputCls = "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
  const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800";

  if (loading) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ກຳລັງໂຫຼດ...</div>;
  if (!header) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-rose-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ບໍ່ພົບໃບກວດນັບ</div>;

  return (
    <div className="space-y-5">
      <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-mono font-bold text-zinc-900 dark:text-zinc-50">{header.doc_no}</span>
          {header.po_no && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">PO {header.po_no}</span>}
          {header.pack_no && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{header.pack_no}</span>}
          <span className="text-xs text-zinc-500">ສາງ {header.wh_code}{header.wh_name ? ` · ${header.wh_name}` : ""}</span>
          <a href={`/movements/receive/count/${encodeURIComponent(docNo)}/print`} target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900/50">🖨 ໃບກວດນັບ</a>
          <a href={`/movements/receive/count/${encodeURIComponent(docNo)}/labels`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50">🏷 SN</a>
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs font-semibold text-rose-500 hover:underline">ລົບໃບກວດນັບ</button>
        </div>
      </div>

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">ລາຍການກວດນັບ</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">ບ່ອນเก็บ:</span>
            <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold dark:bg-zinc-800">
              {([["all", "ທັງໝົດ"], ["line", "ທີ່ລະລາຍການ"]] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-3 py-1 transition ${mode === m ? "bg-white text-emerald-600 shadow-sm dark:bg-zinc-900 dark:text-emerald-400" : "text-zinc-500"}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                <th className="px-4 py-2.5">ສິນຄ້າ</th>
                <th className="px-4 py-2.5 text-center">ກວດນັບ</th>
                <th className="px-4 py-2.5 text-center">ຮັບຈິງ</th>
                <th className="px-4 py-2.5 text-right">ພາເລດ</th>
                {mode === "line" && <><th className="px-3 py-2.5">ປະເພດ</th><th className="px-3 py-2.5">ບ່ອນເກັບ</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {lines.map((l) => {
                const q = parsedQty(l.qty);
                const sns = l.serials.filter((s) => s.trim() !== "");
                return (
                  <tr key={l.item_code} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}{l.isIsn && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">SN</span>}</div>
                      <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                      {l.isIsn && sns.length > 0 && <button type="button" onClick={() => toggleSn(l)} className="mt-1 text-[11px] font-semibold text-violet-600 hover:underline dark:text-violet-300">{l.showSn ? "ປິດ SN" : `ເລືອກ SN ທີ່ຮັບ (${snCounts(l).recv}/${sns.length})`}</button>}
                      {l.isIsn && l.showSn && (
                        <div className="mt-2 rounded-lg bg-violet-50/50 p-2 dark:bg-violet-950/10">
                          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">ກົດ serial ເພື່ອสลับ: <b className="text-emerald-600 dark:text-emerald-400">ຮັບ</b> → <b className="text-amber-600 dark:text-amber-400">ພັກ</b> → <b className="text-rose-600 dark:text-rose-400">ຍົກເລີກ</b></span>
                            <span className="flex gap-2">
                              <button type="button" onClick={() => setAllSerials(l.item_code, "recv")} className="text-[10px] font-semibold text-emerald-600 hover:underline dark:text-emerald-400">ຮັບໝົດ</button>
                              <button type="button" onClick={() => setAllSerials(l.item_code, "hold")} className="text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400">ພັກໝົດ</button>
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {sns.map((s) => {
                              const state = l.recvSerials.includes(s) ? "recv" : l.cancelSerials.includes(s) ? "cancel" : "hold";
                              const cls = state === "recv"
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                                : state === "hold"
                                  ? "bg-white text-amber-600 ring-amber-300 dark:bg-zinc-900 dark:text-amber-400 dark:ring-amber-800/60"
                                  : "bg-rose-50 text-rose-600 line-through ring-rose-300 dark:bg-rose-950/30 dark:text-rose-400 dark:ring-rose-800/60";
                              const icon = state === "recv" ? "✓ " : state === "hold" ? "⊘ " : "✕ ";
                              return (
                                <button key={s} type="button" onClick={() => cycleSerial(l.item_code, s)} title={state === "recv" ? "ຮັບເຂົ້າ" : state === "hold" ? "ພັກໄວ້ (ຮັບເພີ່ມພາຍຫຼັງ)" : "ຍົກເລີກ (ບໍ່ໃຊ້ຄືນ)"}
                                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 transition ${cls}`}>
                                  {icon}{s}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.item_code, { qty: e.target.value })} className="w-24 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:ring-zinc-800" />
                        <span className="w-8 text-[10px] text-zinc-400">{l.unit_code ?? ""}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-center gap-0.5">
                        {l.isIsn ? (
                          // ISN: received qty is driven by the serial selection above.
                          <button type="button" onClick={() => toggleSn(l)} className="w-20 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 transition hover:ring-violet-400 dark:bg-zinc-950 dark:ring-zinc-800">
                            {receivedQty(l)}<span className="text-[10px] text-zinc-400">/{sns.length}</span>
                          </button>
                        ) : (
                          <input type="number" inputMode="numeric" min={0} max={Math.round(q ?? 0)} value={l.received} placeholder={String(Math.round(q ?? 0))} onChange={(e) => setLine(l.item_code, { received: e.target.value })} className="w-20 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:ring-zinc-800" />
                        )}
                        {l.isIsn ? (
                          <>
                            {snCounts(l).hold > 0 && <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">ພັກ SN {snCounts(l).hold}</span>}
                            {snCounts(l).cancel > 0 && <span className="text-[9px] font-semibold text-rose-600 dark:text-rose-400">ຍົກເລີກ {snCounts(l).cancel}</span>}
                          </>
                        ) : (
                          Math.round(q ?? 0) - receivedQty(l) > 0 && <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">ຄ້າງ {Math.round(q ?? 0) - receivedQty(l)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                      {estimatePalletPositions(q ?? 0, l.palletCapacity) > 0
                        ? `~${estimatePalletPositions(q ?? 0, l.palletCapacity)}`
                        : "—"}
                    </td>
                    {mode === "line" && (
                      <>
                        <td className="px-3 py-2.5">
                          <DestToggle value={l.destType} onChange={(t) => setLine(l.item_code, { destType: t, location: "", pallet: "", rack: "" })} />
                        </td>
                        <td className="px-3 py-2.5 min-w-[220px]">
                          {l.destType === "location"
                            ? <RSelect size="sm" value={l.location} options={locOptions} onChange={(v) => pickLocation(l.item_code, v)} placeholder="— location —" />
                            : <RSelect size="sm" value={l.pallet} options={palOptions} onChange={(v) => pickPallet(l.item_code, v)} placeholder="— pallet —" />}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-800/50">
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300" colSpan={3}>ພາເລດທີ່ຕ້ອງໃຊ້ລວມ</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                  ~{lines.reduce((s, l) => s + estimatePalletPositions(parsedQty(l.qty) ?? 0, l.palletCapacity), 0)} ພາເລດ
                </td>
                {mode === "line" && <td colSpan={2} />}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* All-at-once destination (per-line is set in the table above). */}
        {mode === "all" && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>ປະເພດບ່ອນເກັບ</label>
              <DestToggle value={globalDest} onChange={(t) => { setGlobalDest(t); setGlobalLoc(""); setGlobalPallet(""); }} />
            </div>
            <div className="min-w-[260px] flex-1">
              <label className={labelCls}>{globalDest === "location" ? "Location" : "Pallet"}</label>
              {globalDest === "location"
                ? <RSelect value={globalLoc} options={locOptions} onChange={setGlobalLoc} placeholder="— ເລືອກ location —" />
                : <RSelect value={globalPallet} options={palOptions} onChange={setGlobalPallet} placeholder="— ເລືອກ pallet —" />}
            </div>
          </div>
        )}

        <p className="mt-2 text-[11px] text-zinc-400">ໝາຍເຫດ: ໃສ່ <b>pallet</b> = ເຂົ້າພາເລທກ່ອນ · ໃສ່ <b>location</b> ຢ່າງ​ດຽວ = ເຂົ້າ rack/location ໂດຍກົງ.</p>

        <div className="mt-4">
          <label className={labelCls}>ໝາຍເຫດ</label>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດ..." className={inputCls} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => router.push("/movements/receive?tab=count")} className={ghostBtn}>← ກັບ</button>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className={ghostBtn}>{saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}</button>
            <button type="button" onClick={postToWms} disabled={posting} className={primaryBtn}>
              <ArrowDownIcon className="h-4 w-4" />{posting ? "ກຳລັງຮັບ..." : "ຮັບເຂົ້າ WMS"}
            </button>
          </div>
        </div>
      </section>

      <ConfirmModal
        open={confirmDelete}
        title="ລົບໃບກວດນັບນີ້?"
        message={<>ໃບກວດນັບ <span className="font-mono font-semibold">{header.doc_no}</span> ພ້ອມ serial ທີ່ gen ໄວ້ຈະຖືກລົບ. ການກະທຳນີ້ກັບคืนບໍ່ໄດ້.</>}
        confirmLabel="ລົບໃບກວດນັບ"
        busy={deleting}
        onConfirm={discard}
        onCancel={() => setConfirmDelete(false)}
      />

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
            {toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
