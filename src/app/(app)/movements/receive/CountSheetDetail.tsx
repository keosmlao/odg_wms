"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
import RSelect, { type ROption } from "@/components/ui/RSelect";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { estimatePalletPositions } from "@/lib/capacity";
import { BackLink, DestToggle, ItemCard, PutawayChips, PutawayPicker, ReceiveHeaderCard, StickyFooter } from "./_receiveUI";

type Header = { doc_no: string; doc_date: string | null; doc_time: string | null; status: number | null; wh_code: string | null; wh_name: string | null; supplier_code: string | null; po_no: string | null; pack_no: string | null; remark: string | null };
type PoRef = { po_no: string; supplier_code: string | null; cust_name: string | null };
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

export default function CountSheetDetail({ docNo }: { docNo: string }) {
  const router = useRouter();
  const [header, setHeader] = useState<Header | null>(null);
  const [pos, setPos] = useState<PoRef[]>([]);
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [remark, setRemark] = useState("");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [sameLocs, setSameLocs] = useState<{ location: string; item_code: string; qty: string }[]>([]);
  const [emptyLocs, setEmptyLocs] = useState<string[]>([]);
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
        const data = (await res.json()) as { header?: Header; pos?: PoRef[]; lines?: LineRow[]; serials?: SerialRow[]; sameLocs?: { location: string; item_code: string; qty: string }[]; emptyLocs?: string[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.header) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setHeader(data.header);
        setPos(Array.isArray(data.pos) ? data.pos : []);
        setRemark(data.header.remark ?? "");
        setSameLocs(Array.isArray(data.sameLocs) ? data.sameLocs : []);
        setEmptyLocs(Array.isArray(data.emptyLocs) ? data.emptyLocs : []);
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
  const nameOf = (code: string) => locByCode.get(code)?.name || code;
  // Aggregate same-item locations across all lines for the all-at-once suggester.
  const sameByLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sameLocs) m.set(s.location, (m.get(s.location) ?? 0) + (Number.parseFloat(s.qty) || 0));
    return Array.from(m, ([location, qty]) => ({ location, qty: String(qty) })).sort((a, b) => Number(b.qty) - Number(a.qty));
  }, [sameLocs]);

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
      const data = (await res.json()) as {
        ok?: boolean; receive_code?: string; serials?: number; held?: number; cancelled?: number; remaining?: number; error?: string;
        erp_purchase?: { doc_no: string; total: number; items: number; missing: string[] } | null;
        erp_purchases?: { po_no: string; doc_no: string }[];
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const sn = data.serials ? ` · SN ${data.serials}` : "";
      const vd = data.held ? ` · ພັກ ${data.held}` : "";
      const cn = data.cancelled ? ` · ຍົກເລີກ ${data.cancelled}` : "";
      const rest = data.remaining ? ` · ໃບຍັງຄ້າງ ${data.remaining} (ຮັບຕໍ່ໄດ້)` : "";
      const erpDocs = data.erp_purchases ?? (data.erp_purchase ? [{ po_no: "", doc_no: data.erp_purchase.doc_no }] : []);
      const erp = erpDocs.length === 1 ? ` · ໃບຊື້ຕິດໜີ້ ${erpDocs[0].doc_no}` : erpDocs.length > 1 ? ` · ໃບຊື້ຕິດໜີ້ ${erpDocs.length} ໃບ` : "";
      showToast("ok", `ຮັບເຂົ້າ WMS ${data.receive_code} ສຳເລັດ${sn}${vd}${cn}${rest}${erp}`);
      // Items absent from the PO are received in WMS but carry no price → no AP line.
      if (data.erp_purchase?.missing?.length) {
        showToast("err", `ບໍ່ມີລາຄາໃນ PO ${data.erp_purchase.missing.length} ລາຍການ: ${data.erp_purchase.missing.join(", ")}`);
      }
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

  if (loading) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ກຳລັງໂຫຼດ...</div>;
  if (!header) return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-rose-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ບໍ່ພົບໃບກວດນັບ</div>;

  const totalCounted = lines.reduce((s, l) => s + Math.round(parsedQty(l.qty) ?? 0), 0);
  const totalReceived = lines.reduce((s, l) => s + receivedQty(l), 0);
  const totalPallets = lines.reduce((s, l) => s + estimatePalletPositions(parsedQty(l.qty) ?? 0, l.palletCapacity), 0);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <BackLink onClick={() => router.push("/movements/receive?tab=count")} label="← ກັບໄປໃບກວດນັບ" />
        <div className="flex items-center gap-1.5">
          <a href={`/movements/receive/count/${encodeURIComponent(docNo)}/print`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-100">🖨 ໃບກວດນັບ</a>
          <a href={`/movements/receive/count/${encodeURIComponent(docNo)}/labels`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md bg-aqua-50 px-2.5 py-1 text-xs font-semibold text-aqua-700 ring-1 ring-aqua-200 transition hover:bg-aqua-100">🏷 SN</a>
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs font-semibold text-rose-500 hover:underline">ລົບ</button>
        </div>
      </div>

      <ReceiveHeaderCard
        docNo={header.doc_no}
        verb="ຮັບ"
        got={totalReceived}
        want={totalCounted}
        badges={<>
          {(pos.length > 0 ? pos.map((p) => p.po_no) : header.po_no ? [header.po_no] : []).map((po) => (
            <span key={po} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">PO {po}</span>
          ))}
          {header.pack_no && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{header.pack_no}</span>}
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">ສາງ {header.wh_code}{header.wh_name ? ` · ${header.wh_name}` : ""}</span>
          {totalPallets > 0 && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-600">~{totalPallets} ພາເລດ</span>}
        </>}
      >
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold text-slate-500">📍 ບ່ອນຈັດເກັບ:</label>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
            {([["all", "ທັງໝົດ"], ["line", "ທີ່ລະລາຍການ"]] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-3 py-1 transition ${mode === m ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>
        {mode === "all" && (
          <PutawayPicker
            dest={globalDest} onDest={(t) => { setGlobalDest(t); setGlobalLoc(""); setGlobalPallet(""); }}
            locValue={globalLoc} onLoc={setGlobalLoc} locOptions={locOptions}
            palValue={globalPallet} onPal={setGlobalPallet} palOptions={palOptions}
            same={sameByLoc} empty={emptyLocs} nameOf={nameOf}
          />
        )}
        {mode === "line" && <p className="text-[11px] text-slate-400">ເລືອກ location / pallet ແຍກໃນແຕ່ລະລາຍການດ້ານລຸ່ມ</p>}
      </ReceiveHeaderCard>

      <div className="space-y-3">
        {lines.map((l) => {
          const q = parsedQty(l.qty);
          const counted = Math.round(q ?? 0);
          const sns = l.serials.filter((s) => s.trim() !== "");
          const got = receivedQty(l);
          const pal = estimatePalletPositions(q ?? 0, l.palletCapacity);
          return (
            <ItemCard key={l.item_code} code={l.item_code} name={l.item_name} isSn={l.isIsn} want={counted} wantLabel="ກວດນັບ" unit={l.unit_code} got={got}>
              <div className="w-full space-y-2.5">
                {/* counted + received row */}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500">ກວດນັບ</label>
                  <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.item_code, { qty: e.target.value })} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center font-mono text-sm font-bold" />
                  <span className="text-[11px] text-slate-400">{l.unit_code ?? ""}</span>
                  {pal > 0 && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-600">~{pal} ພາເລດ</span>}
                  <span className="mx-1 text-slate-300">·</span>
                  <label className="text-xs font-semibold text-slate-500">ຮັບ ຈິງ</label>
                  {l.isIsn ? (
                    <button type="button" onClick={() => toggleSn(l)} className="rounded-lg border border-aqua-300 bg-aqua-50 px-3 py-1.5 text-xs font-bold text-aqua-700 transition hover:bg-aqua-100">
                      {got}/{sns.length} {l.showSn ? "▲" : "▼ ເລືອກ SN"}
                    </button>
                  ) : (
                    <input type="number" inputMode="numeric" min={0} max={counted} value={l.received} placeholder={String(counted)} onChange={(e) => setLine(l.item_code, { received: e.target.value })} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center font-mono text-sm font-bold" />
                  )}
                  {l.isIsn ? (
                    <>
                      {snCounts(l).hold > 0 && <span className="text-[11px] font-semibold text-amber-600">ພັກ SN {snCounts(l).hold}</span>}
                      {snCounts(l).cancel > 0 && <span className="text-[11px] font-semibold text-rose-600">ຍົກເລີກ {snCounts(l).cancel}</span>}
                    </>
                  ) : (
                    counted - got > 0 && <span className="text-[11px] font-semibold text-amber-600">ຄ້າງ {counted - got}</span>
                  )}
                </div>

                {/* ISN 3-state serial selector */}
                {l.isIsn && l.showSn && sns.length > 0 && (
                  <div className="rounded-lg bg-aqua-50/50 p-2">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500">ກົດ serial ເພື່ອສະຫຼັບ: <b className="text-emerald-600">ຮັບ</b> → <b className="text-amber-600">ພັກ</b> → <b className="text-rose-600">ຍົກເລີກ</b></span>
                      <span className="flex gap-2">
                        <button type="button" onClick={() => setAllSerials(l.item_code, "recv")} className="text-[10px] font-semibold text-emerald-600 hover:underline">ຮັບໝົດ</button>
                        <button type="button" onClick={() => setAllSerials(l.item_code, "hold")} className="text-[10px] font-semibold text-amber-600 hover:underline">ພັກໝົດ</button>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {sns.map((s) => {
                        const state = l.recvSerials.includes(s) ? "recv" : l.cancelSerials.includes(s) ? "cancel" : "hold";
                        const cls = state === "recv"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-300"
                          : state === "hold"
                            ? "bg-white text-amber-600 ring-amber-300"
                            : "bg-rose-50 text-rose-600 line-through ring-rose-300";
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

                {/* per-line destination (line mode) */}
                {mode === "line" && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                    <DestToggle value={l.destType} onChange={(t) => setLine(l.item_code, { destType: t, location: "", pallet: "", rack: "" })} />
                    <div className="min-w-[220px] flex-1">
                      {l.destType === "location"
                        ? <>
                            <RSelect size="sm" value={l.location} options={locOptions} onChange={(v) => pickLocation(l.item_code, v)} placeholder="— location —" />
                            <div className="mt-1.5"><PutawayChips same={sameLocs.filter((s) => s.item_code === l.item_code)} empty={emptyLocs} current={l.location} onPick={(code) => pickLocation(l.item_code, code)} nameOf={nameOf} /></div>
                          </>
                        : <RSelect size="sm" value={l.pallet} options={palOptions} onChange={(v) => pickPallet(l.item_code, v)} placeholder="— pallet —" />}
                    </div>
                  </div>
                )}
              </div>
            </ItemCard>
          );
        })}
      </div>

      <div>
        <label className={labelCls}>ໝາຍເຫດ</label>
        <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດ..." className={inputCls} />
      </div>

      <StickyFooter
        leftText={<>ລວມ ຮັບ {totalReceived}/{totalCounted}
          <button type="button" onClick={save} disabled={saving} className="ml-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">{saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}</button>
        </>}
        onSubmit={postToWms}
        disabled={posting}
        submitting={posting}
        label={posting ? "ກຳລັງຮັບ..." : "ຮັບເຂົ້າ WMS"}
      />

      <ConfirmModal
        open={confirmDelete}
        title="ລົບໃບກວດນັບນີ້?"
        message={<>ໃບກວດນັບ <span className="font-mono font-semibold">{header.doc_no}</span> ພ້ອມ serial ທີ່ gen ໄວ້ຈະຖືກລົບ. ການກະທຳນີ້ກັບຄືນບໍ່ໄດ້.</>}
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
