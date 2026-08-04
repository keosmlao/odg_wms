"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon, PackageIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };

type ResultLine = {
  src_row: number;
  po_no: string;
  item_code: string | null;
  raw_item_code: string;
  item_name: string;
  unit_code: string;
  qty: number | null;
  ordered: number | null;
  remaining: number | null;
  check_status: number;
  check_note: string;
};
type ImportResult = {
  ok?: boolean;
  error?: string;
  doc_no?: string;
  blocked?: boolean;
  block_hint?: string | null;
  summary?: { rows_read: number; lines: number; skipped: number; errors: number; warns: number; pos: string[]; attachments: number };
  lines?: ResultLine[];
};

/** ຜົນ preview ກ່ອນບັນທຶກ — ອ່ານໄຟລ໌ · ຈັບຄູ່ SML · ແນະນຳ PO */
type PreviewLine = {
  src_row: number;
  supplier_item_code: string | null;
  src_text: string | null;
  qty: number | null;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  allocations: { po_no: string; qty: number; remaining: number }[];
  unallocated: number;
  candidates: { item_code: string; item_name: string | null; total_remaining: number }[];
  confident: boolean;
  check_status: number;
  check_note: string;
};
type PreviewResult = {
  ok?: boolean;
  error?: string;
  preview?: boolean;
  summary?: { rows_read: number; lines: number; skipped: number; errors: number; warns: number; pos: string[]; attachments: number };
  lines?: PreviewLine[];
  po_summary?: { po_no: string; lines: number; qty: number }[];
  unresolved?: number;
  over?: number;
};

const SHEET_RE = /\.(xlsx|xls|csv)$/i;
type PendingPo = { po_no: string; cust_name: string | null; wh_code: string; wh_name: string | null };

/** ລາຍການຄ້າງຮັບຂອງ PO ທີ່ເລືອກ (ລວມຕໍ່ສິນຄ້າ) — ລະຫັດ · ຊື່ ຈາກ SML */
type PoLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  remaining: number;
  is_isn: boolean;
  pos: string[];
  qty: string;
};
/** ສິນຄ້າຄ້າງຮັບ 1 ແຖວຂອງ PO ໜຶ່ງ (ໃຊ້ໃນ modal ຕອນຂະຫຍາຍ) */
type PoItemRow = { item_code: string; item_name: string | null; unit_code: string | null; remaining: number };
type MergedLineIn = {
  item_code: string; item_name: string | null; unit_code: string | null;
  ordered: string; remaining: string; is_isn: boolean;
  sources?: { po_no: string; remaining: string }[];
};

function fmt(v: number | string | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

/**
 * ນຳເຂົ້າໃບ packing — ຂັ້ນທຳອິດຂອງການຮັບສິນຄ້າ.
 * Excel = ລາຍການທີ່ຈະກວດ · PDF = ໄຟລ໌ຕົ້ນສະບັບທີ່ແນບໄວ້ອ້າງອີງ.
 */
export default function PackingImport({ warehouses, defaultWh = "" }: { warehouses: WarehouseOption[]; defaultWh?: string }) {
  const router = useRouter();
  const sheetRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [wh, setWh] = useState(defaultWh || warehouses[0]?.code || "");
  const [docDate, setDocDate] = useState(today);
  const [refNo, setRefNo] = useState("");
  const [pos, setPos] = useState<string[]>([]);
  const [availablePos, setAvailablePos] = useState<PendingPo[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  /** ກຸນແຈ "<ສາງ>|<PO>" ເພາະ PO ດຽວອາດປາກົດຫຼາຍສາງ */
  const [pickerSel, setPickerSel] = useState<string[]>([]);
  const [remark, setRemark] = useState("");
  const [sheet, setSheet] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filePreview, setFilePreview] = useState<PreviewResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  /** ສິນຄ້າທີ່ຖືກຕັດອອກ — ກຸນແຈ "<ສາງ>|<PO>|<ລະຫັດ>" */
  const [itemExcl, setItemExcl] = useState<string[]>([]);
  const [pickerExcl, setPickerExcl] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [poItems, setPoItems] = useState<Record<string, PoItemRow[]>>({});
  const [itemsLoading, setItemsLoading] = useState<string | null>(null);

  // PO ຄ້າງຮັບຂອງ **ທຸກສາງທີ່ຮັບຜິດຊອບ** — ໂຫຼດຂະໜານກັນແລ້ວລວມ
  useEffect(() => {
    if (warehouses.length === 0) { setAvailablePos([]); return; }
    let cancelled = false;
    (async () => {
      setPosLoading(true);
      try {
        const all = await Promise.all(
          warehouses.map(async (w) => {
            try {
              const res = await fetch(`/api/receive/pending?wh=${encodeURIComponent(w.code)}&type=po&limit=1000`);
              const data = (await res.json()) as { lines?: { po_no: string; cust_name: string | null }[] };
              const seen = new Map<string, PendingPo>();
              for (const l of data.lines ?? []) {
                if (!seen.has(l.po_no)) seen.set(l.po_no, { po_no: l.po_no, cust_name: l.cust_name, wh_code: w.code, wh_name: w.name });
              }
              return Array.from(seen.values());
            } catch { return [] as PendingPo[]; }
          }),
        );
        if (cancelled) return;
        // PO ດຽວກັນອາດຢູ່ຫຼາຍສາງ — ເກັບແຍກຕາມສາງ
        const merged = new Map<string, PendingPo>();
        for (const p of all.flat()) merged.set(`${p.wh_code}|${p.po_no}`, p);
        setAvailablePos(Array.from(merged.values()).sort((a, b) => a.wh_code.localeCompare(b.wh_code) || a.po_no.localeCompare(b.po_no)));
      } finally {
        if (!cancelled) setPosLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // ອີງລະຫັດສາງ (ບໍ່ແມ່ນ identity ຂອງ array) ເພື່ອບໍ່ໃຫ້ໂຫຼດຊ້ຳທຸກຄັ້ງທີ່ parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses.map((w) => w.code).join(",")]);

  // ເລືອກ PO ແລ້ວ → ດຶງລາຍການຄ້າງຮັບຂອງ PO ນັ້ນມາສະແດງທັນທີ
  // (ລະຫັດ · ຊື່ · ຫົວໜ່ວຍ ຈາກ SML — ນີ້ຄືລາຍການທີ່ລໍຖ້າສ້າງໃບກວດນັບ)
  useEffect(() => {
    if (pos.length === 0 || !wh) { setPoLines([]); return; }
    let cancelled = false;
    (async () => {
      setLinesLoading(true);
      try {
        const qs = new URLSearchParams();
        pos.forEach((p) => qs.append("po", p));
        qs.set("wh", wh);
        const res = await fetch(`/api/receive/packing-list?${qs}`);
        const data = (await res.json()) as { lines?: MergedLineIn[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດລາຍການບໍ່ສຳເລັດ");
        const excl = new Set(itemExcl);
        setPoLines((prev) => {
          const kept = new Map(prev.map((l) => [l.item_code, l.qty]));
          return (data.lines ?? []).filter((l) => {
            const src = l.sources ?? [];
            // ຕັດອອກເມື່ອສິນຄ້ານີ້ຖືກຕິກອອກໃນທຸກ PO ທີ່ມັນມາ
            return src.length === 0 || !src.every((s) => excl.has(`${wh}|${s.po_no}|${l.item_code}`));
          }).map((l) => {
            const remaining = Number.parseFloat(l.remaining) || 0;
            return {
              item_code: l.item_code,
              item_name: l.item_name,
              unit_code: l.unit_code,
              ordered: Number.parseFloat(l.ordered) || 0,
              remaining,
              is_isn: l.is_isn,
              pos: (l.sources ?? []).map((s) => s.po_no),
              qty: kept.get(l.item_code) ?? String(remaining > 0 ? remaining : 0),
            };
          });
        });
      } catch (e) {
        if (!cancelled) { setPoLines([]); setResult({ error: e instanceof Error ? e.message : "ໂຫຼດລາຍການບໍ່ສຳເລັດ" }); }
      } finally {
        if (!cancelled) setLinesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pos, wh, itemExcl]);

  /** ໂຫຼດສິນຄ້າຄ້າງຮັບຂອງ PO ໜຶ່ງ (ຕອນຂະຫຍາຍໃນ modal) — cache ໄວ້ */
  async function loadPoItems(key: string, whCode: string, poNo: string) {
    if (poItems[key]) return;
    setItemsLoading(key);
    try {
      const res = await fetch(`/api/receive/packing-list?po=${encodeURIComponent(poNo)}&wh=${encodeURIComponent(whCode)}`);
      const data = (await res.json()) as { lines?: MergedLineIn[] };
      setPoItems((prev) => ({
        ...prev,
        [key]: (data.lines ?? []).map((l) => ({
          item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code,
          remaining: Number.parseFloat(l.remaining) || 0,
        })),
      }));
    } catch {
      setPoItems((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setItemsLoading(null);
    }
  }

  /** ສ້າງໃບກວດນັບຈາກລາຍການທີ່ສະແດງ (ພ້ອມແນບໃບ packing ຖ້າມີ) */
  async function createCountSheet() {
    const chosen = poLines.filter((l) => (Number.parseFloat(l.qty) || 0) > 0);
    if (chosen.length === 0) { setResult({ error: "ບໍ່ມີລາຍການທີ່ຈະກວດນັບ" }); return; }
    const over = chosen.find((l) => l.remaining > 0 && (Number.parseFloat(l.qty) || 0) > l.remaining + 1e-6);
    if (over) { setResult({ error: `${over.item_code}: ຈຳນວນເກີນຄ້າງຮັບ (${fmt(over.remaining)})` }); return; }

    setBusy(true);
    setResult(null);
    try {
      // ບັນທຶກໃບ packing ຈາກລາຍການໜ້າຈໍ (ລະຫັດ/ຊື່ ຈາກ SML) + ແນບໄຟລ໌ຕົ້ນສະບັບ
      const fd = new FormData();
      fd.append("wh", wh);
      fd.append("doc_date", docDate);
      fd.append(
        "lines",
        JSON.stringify(chosen.map((l) => ({
          po_no: l.pos[0] ?? "", item_code: l.item_code, item_name: l.item_name,
          unit_code: l.unit_code, qty: Number.parseFloat(l.qty) || 0,
        }))),
      );
      if (sheet) fd.append("file", sheet);
      attachments.forEach((f) => fd.append("attachment", f));
      if (refNo.trim()) fd.append("ref_no", refNo.trim());
      if (remark.trim()) fd.append("remark", remark.trim());
      const impRes = await fetch("/api/receive/packing-list/import", { method: "POST", body: fd });
      const imp = (await impRes.json()) as ImportResult;
      if (!impRes.ok || !imp.ok) throw new Error(imp.error ?? "ບັນທຶກໃບ packing ບໍ່ສຳເລັດ");
      const packingDoc = imp.doc_no ?? null;

      const res = await fetch("/api/receive/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pos,
          wh_code: wh,
          pack_no: refNo.trim() || null,
          packing_doc_no: packingDoc,
          remark: remark.trim() || null,
          lines: chosen.map((l) => ({
            item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code,
            qty: Number.parseFloat(l.qty) || 0,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; count_code?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ສ້າງໃບກວດນັບບໍ່ສຳເລັດ");
      router.push(`/movements/receive/count/${encodeURIComponent(data.count_code!)}`);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  // ຄົ້ນຫາໃນ modal: ເລກ PO · ຜູ້ສະໜອງ · ລະຫັດສາງ
  const pq = pickerQ.trim().toLowerCase();
  const filteredPos = pq
    ? availablePos.filter((a) =>
        a.po_no.toLowerCase().includes(pq)
        || (a.cust_name ?? "").toLowerCase().includes(pq)
        || a.wh_code.toLowerCase().includes(pq)
        || (a.wh_name ?? "").toLowerCase().includes(pq))
    : availablePos;
  /** ສາງທີ່ຕິດມາກັບ PO ທີ່ຕິກໄວ້ — ຕ້ອງເປັນສາງດຽວ */
  const selWarehouses = Array.from(new Set(pickerSel.map((k) => k.split("|")[0]).filter(Boolean)));

  function templateHref() {
    const qs = new URLSearchParams();
    pos.forEach((p) => qs.append("po", p));
    if (wh) qs.set("wh", wh);
    return `/api/receive/packing-list/import${qs.toString() ? `?${qs}` : ""}`;
  }

  function pickFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    let nextSheet: File | null = null;
    const nextAttach: File[] = [];
    for (const f of Array.from(files)) {
      if (SHEET_RE.test(f.name)) nextSheet = f;
      else nextAttach.push(f);
    }
    if (nextSheet) setSheet(nextSheet);
    if (nextAttach.length) setAttachments((prev) => [...prev, ...nextAttach]);
    setResult(null);
    setFilePreview(null); // ໄຟລ໌ປ່ຽນ → ຕ້ອງເບິ່ງໃໝ່ກ່ອນບັນທຶກ
  }

  /** ສ້າງ FormData ຂອງການນຳເຂົ້າ (ໃຊ້ຮ່ວມກັນລະຫວ່າງ preview ແລະ ບັນທຶກຈິງ) */
  function importForm() {
    const fd = new FormData();
    if (sheet) fd.append("file", sheet);
    attachments.forEach((f) => fd.append("attachment", f));
    fd.append("wh", wh);
    fd.append("doc_date", docDate);
    if (refNo.trim()) fd.append("ref_no", refNo.trim());
    // ໃຊ້ເປັນ PO ຕັ້ງຕົ້ນສະເພາະເມື່ອເລືອກ PO ດຽວ (ຫຼາຍ PO → ຕ້ອງລະບຸໃນແຕ່ລະແຖວ)
    if (pos.length === 1) fd.append("po", pos[0]);
    if (remark.trim()) fd.append("remark", remark.trim());
    return fd;
  }

  /** ຂັ້ນ ①: ອ່ານໄຟລ໌ + ຈັບຄູ່ SML + ແນະນຳ PO ໃຫ້ເບິ່ງ — ຍັງບໍ່ບັນທຶກ */
  async function runPreview() {
    if (!sheet || !wh || busy) return;
    setBusy(true);
    setResult(null);
    setFilePreview(null);
    try {
      const fd = importForm();
      fd.append("preview", "1");
      const res = await fetch("/api/receive/packing-list/import", { method: "POST", body: fd });
      const data = (await res.json()) as PreviewResult;
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ອ່ານໄຟລ໌ບໍ່ສຳເລັດ");
      setFilePreview(data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "ອ່ານໄຟລ໌ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  /** ຂັ້ນ ②: ຢືນຢັນ → ບັນທຶກເປັນໃບ packing ຈິງ */
  async function submit() {
    if (!sheet || !wh || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/receive/packing-list/import", { method: "POST", body: importForm() });
      const data = (await res.json()) as ImportResult;
      setResult(data);
      if (res.ok && data.ok) { setFilePreview(null); router.refresh(); }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "ນຳເຂົ້າບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSheet(null);
    setAttachments([]);
    setResult(null);
    if (sheetRef.current) sheetRef.current.value = "";
    if (attachRef.current) attachRef.current.value = "";
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const s = result?.summary;

  return (
    <section className="shadow-card space-y-4 rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="flex items-center gap-2">
        <PackageIcon className="h-5 w-5 text-emerald-600" />
        <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ນຳເຂົ້າໃບ packing</h2>
        <span className="ml-auto text-[11px] text-zinc-400">Excel = ລາຍການ · PDF = ແນບອ້າງອີງ</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງທີ່ຮັບ *</label>
          <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ວັນທີ່ຮັບ *</label>
          <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເລກໃບ packing (ຕົ້ນສະບັບ)</label>
          <input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="ຕາມໃບຜູ້ສະໜອງ" className={inputCls} />
        </div>
      </div>

      {/* ① ເລືອກ PO ຄ້າງຮັບ → ② ໂຫຼດ template (ລະຫັດ/ຊື່ ຈາກ SML) → ③ ຕື່ມຈຳນວນ → ④ ອັບກັບ */}
      <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 dark:bg-zinc-950/40 dark:ring-zinc-800">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">ເລືອກ PO ຄ້າງຮັບ</span>
          <span className="text-[11px] text-zinc-400">ໂຫຼດ template ທີ່ມີລະຫັດ · ຊື່ ຈາກ SML ແລ້ວຕື່ມແຕ່ຈຳນວນ</span>
          <a
            href={templateHref()}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              pos.length > 0
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
            }`}
          >
            ⬇ ດາວໂຫຼດ template{pos.length > 0 ? ` (${pos.length} PO)` : " ເປົ່າ"}
          </a>
        </div>

        {pos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pos.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 pl-2.5 pr-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700">
                <span className="font-mono">{p}</span>
                <button type="button" onClick={() => setPos((prev) => prev.filter((x) => x !== p))} className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-500/20" aria-label="ເອົາອອກ">×</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setPickerSel(pos.map((p) => `${wh}|${p}`)); setPickerExcl(itemExcl); setPickerQ(""); setExpanded(null); setPickerOpen(true); }}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700"
          >
            <SearchIcon className="h-4 w-4" />
            ເລືອກ PO ຈາກລາຍການຄ້າງຮັບ ({posLoading ? "..." : availablePos.length})
          </button>
          <span className="text-[11px] text-zinc-400">ຄ້າງຮັບທຸກສາງທີ່ຮັບຜິດຊອບ · ເລືອກໄດ້ 1 ຫຼື ຫຼາຍ PO (ຕ້ອງເປັນສາງດຽວກັນ)</span>
        </div>
      </div>

      {/* Modal ເລືອກ PO ຄ້າງຮັບ — ຄົ້ນຫາ ແລະ ຕິກໄດ້ຫຼາຍໃບ */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" onClick={() => setPickerOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50">ເລືອກ PO ຄ້າງຮັບ</h3>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {warehouses.length} ສາງທີ່ຮັບຜິດຊອບ
              </span>
              <button type="button" onClick={() => setPickerOpen(false)} className="ml-auto text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>

            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                autoFocus
                value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const typed = pickerQ.trim().toUpperCase();
                  // ພິມເລກ PO ທີ່ບໍ່ຢູ່ໃນລາຍການຄ້າງຮັບ ກໍ່ເພີ່ມໄດ້ (ເຂົ້າສາງທີ່ເລືອກຢູ່)
                  if (typed && !filteredPos.length) {
                    const key = `${wh}|${typed}`;
                    setPickerSel((p) => (p.includes(key) ? p : [...p, key]));
                    setPickerQ("");
                  }
                }}
                placeholder="ຄົ້ນຫາ ເລກ PO ຫຼື ຜູ້ສະໜອງ..."
                className={`${inputCls} pl-9`}
              />
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px]">
              <button type="button" onClick={() => setPickerSel(Array.from(new Set([...pickerSel, ...filteredPos.map((a) => `${a.wh_code}|${a.po_no}`)])))} className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                ເລືອກທັງໝົດທີ່ຄົ້ນພົບ ({filteredPos.length})
              </button>
              <button type="button" onClick={() => { setPickerSel([]); setPickerExcl([]); }} className="font-semibold text-zinc-400 hover:underline">ລ້າງທີ່ເລືອກ</button>
              <span className="ml-auto font-bold text-zinc-700 dark:text-zinc-200">
                ເລືອກແລ້ວ {pickerSel.length} PO{pickerExcl.length > 0 ? ` · ຕັດສິນຄ້າອອກ ${pickerExcl.length}` : ""}
              </span>
              {selWarehouses.length > 1 && (
                <span className="w-full font-bold text-rose-600 dark:text-rose-400">
                  ⛔ ເລືອກຄົນລະສາງ ({selWarehouses.join(", ")}) — 1 ໃບ packing ຕ້ອງເປັນສາງດຽວ
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              {filteredPos.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-400">
                  {posLoading ? "ກຳລັງໂຫຼດ..." : `ບໍ່ພົບ PO ທີ່ຄົ້ນຫາ${pickerQ.trim() ? " — ກົດ Enter ເພື່ອເພີ່ມເລກນີ້ເອງ" : ""}`}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredPos.map((a) => {
                    const key = `${a.wh_code}|${a.po_no}`;
                    const on = pickerSel.includes(key);
                    const otherWh = selWarehouses.length > 0 && !selWarehouses.includes(a.wh_code);
                    const items = poItems[key];
                    const isOpen = expanded === key;
                    const picked = items ? items.filter((it) => on && !pickerExcl.includes(`${key}|${it.item_code}`)).length : 0;
                    return (
                      <li key={key}>
                        <div className={`flex items-center gap-3 px-4 py-2.5 transition ${on ? "bg-emerald-50 dark:bg-emerald-950/20" : otherWh ? "opacity-45" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              setPickerSel((prev) => (on ? prev.filter((x) => x !== key) : [...prev, key]));
                              // ເລືອກ PO ໃໝ່ = ເອົາທຸກສິນຄ້າ (ລ້າງລາຍການທີ່ຕັດອອກ)
                              if (!on) setPickerExcl((prev) => prev.filter((x) => !x.startsWith(`${key}|`)));
                            }}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          <button
                            type="button"
                            onClick={() => { setExpanded(isOpen ? null : key); if (!isOpen) void loadPoItems(key, a.wh_code, a.po_no); }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className={`text-[10px] text-zinc-400 transition ${isOpen ? "rotate-90" : ""}`}>▶</span>
                            <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-100">{a.po_no}</span>
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={a.wh_name ?? ""}>{a.wh_code}</span>
                            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{a.cust_name ?? ""}</span>
                            {on && items && (
                              <span className="ml-auto shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{picked}/{items.length} ສິນຄ້າ</span>
                            )}
                          </button>
                        </div>

                        {/* ລົງຮອດສິນຄ້າ — ຕິກເລືອກເປັນລາຍການໄດ້ */}
                        {isOpen && (
                          <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/40">
                            {itemsLoading === key ? (
                              <div className="py-3 text-center text-[11px] text-zinc-400">ກຳລັງໂຫຼດສິນຄ້າ...</div>
                            ) : !items || items.length === 0 ? (
                              <div className="py-3 text-center text-[11px] text-zinc-400">ບໍ່ມີສິນຄ້າຄ້າງຮັບໃນ PO ນີ້</div>
                            ) : (
                              <ul className="space-y-0.5">
                                {items.map((it) => {
                                  const ikey = `${key}|${it.item_code}`;
                                  const ion = on && !pickerExcl.includes(ikey);
                                  return (
                                    <li key={it.item_code}>
                                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-white dark:hover:bg-zinc-900">
                                        <input
                                          type="checkbox"
                                          checked={ion}
                                          onChange={() => {
                                            if (!on) {
                                              // ຕິກສິນຄ້າ = ເລືອກ PO ນີ້ ແລ້ວຕັດສິນຄ້າອື່ນອອກ
                                              setPickerSel((prev) => [...prev, key]);
                                              setPickerExcl((prev) => [
                                                ...prev.filter((x) => !x.startsWith(`${key}|`)),
                                                ...items.filter((o) => o.item_code !== it.item_code).map((o) => `${key}|${o.item_code}`),
                                              ]);
                                              return;
                                            }
                                            setPickerExcl((prev) => (ion ? [...prev, ikey] : prev.filter((x) => x !== ikey)));
                                          }}
                                          className="h-3.5 w-3.5 accent-emerald-600"
                                        />
                                        <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400">{it.item_code}</span>
                                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300">{it.item_name ?? ""}</span>
                                        <span className="shrink-0 font-mono text-[10px] font-semibold text-amber-600 dark:text-amber-400">ຄ້າງ {fmt(it.remaining)}</span>
                                      </label>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ຍົກເລີກ</button>
              <button
                type="button"
                disabled={pickerSel.length === 0 || selWarehouses.length > 1}
                onClick={() => {
                  // ສາງຂອງໃບ packing ຕັ້ງຕາມ PO ທີ່ເລືອກ
                  if (selWarehouses.length === 1) setWh(selWarehouses[0]);
                  setPos(Array.from(new Set(pickerSel.map((k) => k.split("|")[1]))));
                  setItemExcl(pickerExcl.filter((k) => pickerSel.includes(k.split("|").slice(0, 2).join("|"))));
                  setPickerOpen(false);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
              >
                <CheckIcon className="h-4 w-4" />ໃຊ້ {pickerSel.length} PO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ② ລາຍການລໍຖ້າສ້າງໃບກວດນັບ — ດຶງຈາກ SML ຕາມ PO ທີ່ເລືອກ */}
      {pos.length > 0 && (
        <div className="rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-900/50">
          <div className="flex flex-wrap items-center gap-2 rounded-t-xl bg-emerald-50 px-4 py-2.5 dark:bg-emerald-950/30">
            <span className="text-sm font-extrabold text-emerald-800 dark:text-emerald-300">
              ລາຍການລໍຖ້າສ້າງໃບກວດນັບ ({poLines.length})
            </span>
            <span className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">ລະຫັດ · ຊື່ · ຫົວໜ່ວຍ ຈາກ SML</span>
            {poLines.length > 0 && (
              <button
                type="button"
                onClick={() => setPoLines((prev) => prev.map((l) => ({ ...l, qty: String(l.remaining > 0 ? l.remaining : 0) })))}
                className="ml-auto text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                ຮັບ = ຄ້າງ ທຸກລາຍການ
              </button>
            )}
          </div>

          {linesLoading ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດລາຍການ...</div>
          ) : poLines.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-400">ບໍ່ມີລາຍການຄ້າງຮັບໃນ PO ທີ່ເລືອກ (ອາດຮັບຄົບແລ້ວ)</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <th className="px-3 py-2">ສິນຄ້າ (SML)</th>
                    <th className="px-3 py-2">PO</th>
                    <th className="px-3 py-2 text-right">ສັ່ງ</th>
                    <th className="px-3 py-2 text-right">ຄ້າງຮັບ</th>
                    <th className="px-3 py-2 text-center">ຈຳນວນທີ່ຮັບ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {poLines.map((l, i) => {
                    const q = Number.parseFloat(l.qty) || 0;
                    const over = l.remaining > 0 && q > l.remaining + 1e-6;
                    return (
                      <tr key={l.item_code}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            {l.item_code}
                            {l.is_isn && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">SN</span>}
                          </div>
                          <div className="max-w-sm truncate text-[11px] text-zinc-600 dark:text-zinc-400" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-zinc-500">{l.pos.join(", ")}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(l.ordered)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmt(l.remaining)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={l.qty}
                              onChange={(e) => setPoLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                              className={`w-24 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 focus:outline-none focus:ring-2 dark:bg-zinc-950 ${over ? "ring-rose-400 focus:ring-rose-500" : "ring-zinc-200 focus:ring-emerald-500 dark:ring-zinc-800"}`}
                            />
                            <span className="w-8 text-[10px] text-zinc-400">{l.unit_code ?? ""}</span>
                          </div>
                          {over && <div className="mt-0.5 text-center text-[10px] text-rose-500">ເກີນຄ້າງຮັບ</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {poLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <span className="text-[11px] text-zinc-500">
                ຈະກວດນັບ <b className="text-zinc-800 dark:text-zinc-200">{poLines.filter((l) => (Number.parseFloat(l.qty) || 0) > 0).length}</b> ລາຍການ
                {sheet ? " · ແນບໃບ packing ນຳ" : ""}
              </span>
              <button
                type="button"
                onClick={() => void createCountSheet()}
                disabled={busy || poLines.every((l) => (Number.parseFloat(l.qty) || 0) <= 0)}
                className="ml-auto inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
              >
                <CheckIcon className="h-4 w-4" />{busy ? "ກຳລັງບັນທຶກ..." : "ສ້າງໃບກວດນັບ"}
              </button>
            </div>
          )}
        </div>
      )}

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
          dragOver
            ? "border-emerald-400 bg-emerald-50/40 dark:border-emerald-600 dark:bg-emerald-950/30"
            : "border-zinc-200 hover:border-emerald-300 dark:border-zinc-700 dark:hover:border-emerald-700"
        }`}
      >
        <input
          ref={sheetRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => pickFiles(e.target.files)}
          className="hidden"
        />
        {sheet ? (
          <>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{sheet.name}</div>
            <div className="text-[11px] text-zinc-500">{(sheet.size / 1024).toFixed(1)} KB · ກົດເພື່ອປ່ຽນ / ເພີ່ມ PDF</div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">ແນບໃບ packing ຕົ້ນສະບັບ (ທາງເລືອກ) — ລາກມາວາງ ຫຼື ກົດເພື່ອເລືອກ</div>
            <div className="text-[11px] text-zinc-500">
              PDF / Excel ຂອງຜູ້ສະໜອງ — ເກັບເປັນ<b>ຫຼັກຖານ</b>ເທົ່ານັ້ນ (ບໍ່ຕ້ອງມີລະຫັດ SML) · ສູງສຸດ 10MB ຕໍ່ໄຟລ໌
            </div>
          </>
        )}
        {attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {attachments.map((f, i) => (
              <span key={`${f.name}-${i}`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                📎 {f.name}
              </span>
            ))}
          </div>
        )}
      </label>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ໝາຍເຫດ</label>
        <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ລາຍລະອຽດ..." className={inputCls} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* ທາງເສີມ: ໄຟລ໌ທີ່ **ມີລະຫັດ SML** (ເຊັ່ນ template) — ໃບຜູ້ສະໜອງທົ່ວໄປໃຊ້ບໍ່ໄດ້ */}
        {pos.length === 0 && (
          <button
            type="button"
            onClick={runPreview}
            disabled={!sheet || !wh || busy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
          >
            {busy ? "ກຳລັງອ່ານ ແລະ ກວດສອບ..." : "ອ່ານໄຟລ໌ + ເບິ່ງກ່ອນນຳເຂົ້າ"}
          </button>
        )}
        {(sheet || result) && (
          <button type="button" onClick={reset} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200">
            ລ້າງ
          </button>
        )}
      </div>

      {/* ເບິ່ງກ່ອນນຳເຂົ້າ — ຍັງບໍ່ໄດ້ບັນທຶກຫຍັງລົງລະບົບ */}
      {filePreview?.summary && (
        <div className="rounded-xl ring-2 ring-indigo-300 dark:ring-indigo-800">
          <div className="flex flex-wrap items-center gap-2 rounded-t-xl bg-indigo-50 px-4 py-2.5 dark:bg-indigo-950/30">
            <span className="text-sm font-extrabold text-indigo-800 dark:text-indigo-300">ເບິ່ງກ່ອນນຳເຂົ້າ (ຍັງບໍ່ໄດ້ບັນທຶກ)</span>
            <span className="text-[11px] text-indigo-700/80 dark:text-indigo-400/80">
              ອ່ານ {filePreview.summary.rows_read} ແຖວ · ໃຊ້ໄດ້ {filePreview.summary.lines}
              {filePreview.summary.skipped > 0 ? ` · ຂ້າມ ${filePreview.summary.skipped}` : ""}
            </span>
            {(filePreview.unresolved ?? 0) > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">ຈັບຄູ່ SML ບໍ່ໄດ້ {filePreview.unresolved}</span>
            )}
            {(filePreview.over ?? 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">ເກີນຄ້າງຮັບ {filePreview.over}</span>
            )}
            <button type="button" onClick={() => setFilePreview(null)} className="ml-auto text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">ປິດ</button>
          </div>

          {(filePreview.po_summary ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
              <span className="text-[11px] font-semibold text-zinc-500">ຈະເຂົ້າ PO:</span>
              {(filePreview.po_summary ?? []).map((p) => (
                <span key={p.po_no} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900/50">
                  {p.po_no} · {p.lines} ລາຍການ · {fmt(p.qty)}
                </span>
              ))}
            </div>
          )}

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2">ແຖວ</th>
                  <th className="px-3 py-2">ລະຫັດ/ຊື່ ຈາກໄຟລ໌</th>
                  <th className="px-3 py-2 text-right">ຈຳນວນ</th>
                  <th className="px-3 py-2">→ ສິນຄ້າ SML</th>
                  <th className="px-3 py-2">→ PO ທີ່ແນະນຳ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {(filePreview.lines ?? []).map((l) => (
                  <tr key={l.src_row} className={!l.item_code ? "bg-rose-50/50 dark:bg-rose-950/20" : l.unallocated > 0 ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                    <td className="px-3 py-2 font-mono text-[10px] text-zinc-400">{l.src_row}</td>
                    <td className="px-3 py-2">
                      {l.supplier_item_code && (
                        <div className="font-mono text-[11px] font-bold text-zinc-700 dark:text-zinc-200">{l.supplier_item_code}</div>
                      )}
                      <div className="max-w-md truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={l.src_text ?? ""}>{l.src_text ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                      {fmt(l.qty ?? 0)} <span className="text-[10px] font-normal text-zinc-400">{l.unit_code ?? ""}</span>
                    </td>
                    <td className="px-3 py-2">
                      {l.item_code ? (
                        <>
                          <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            {l.item_code}{!l.confident && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">ກວດຄືນ</span>}
                          </div>
                          <div className="max-w-xs truncate text-[10px] text-zinc-500">{l.item_name ?? ""}</div>
                        </>
                      ) : (
                        <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">ຈັບຄູ່ບໍ່ໄດ້ — ຈັບໃນໜ້າໃບ packing ຫຼັງນຳເຂົ້າ</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {l.allocations.length === 0 ? (
                        <span className="text-[10px] text-zinc-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {l.allocations.map((a, i) => (
                            <span key={a.po_no} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                              {i > 0 && <span className="text-zinc-400">↳</span>}
                              <span className="font-mono">{a.po_no}</span>
                              <span className="text-emerald-600 dark:text-emerald-400">{fmt(a.qty)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {l.unallocated > 0 && (
                        <div className="mt-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">ບໍ່ມີ PO ຮອງຮັບ {fmt(l.unallocated)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <span className="text-[11px] text-zinc-500">ຢືນຢັນແລ້ວຈຶ່ງຈະສ້າງໃບ packing ໃນລະບົບ</span>
            <button type="button" onClick={() => setFilePreview(null)} disabled={busy} className="ml-auto rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200">ຍົກເລີກ</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || (filePreview.summary?.lines ?? 0) === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
            >
              <CheckIcon className="h-4 w-4" />{busy ? "ກຳລັງບັນທຶກ..." : `ຢືນຢັນ ນຳເຂົ້າ ${filePreview.summary?.lines ?? 0} ລາຍການ`}
            </button>
          </div>
        </div>
      )}

      {result?.error && !s && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />{result.error}
        </div>
      )}

      {s && result?.doc_no && (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-emerald-600 px-2.5 py-1 font-mono text-xs font-bold text-white">{result.doc_no}</span>
            <span className="text-xs text-zinc-500">ອ່ານ {s.rows_read} ແຖວ · ບັນທຶກ {s.lines} ລາຍການ{s.skipped > 0 ? ` · ຂ້າມ ${s.skipped}` : ""}{s.attachments > 0 ? ` · ແນບ ${s.attachments} ໄຟລ໌` : ""}</span>
            <a href={`/movements/receive/packing/${encodeURIComponent(result.doc_no)}`} className="ml-auto rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">
              ເປີດໃບນີ້ →
            </a>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {s.pos.map((p) => (
              <span key={p} className="rounded-full bg-white px-2 py-0.5 font-mono font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-200 dark:ring-zinc-800">PO {p}</span>
            ))}
          </div>

          {result.blocked ? (
            <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              ບລັອກ {s.errors} ແຖວ{s.warns > 0 ? ` · ເຕືອນ ${s.warns} ແຖວ` : ""} — {result.block_hint}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
              ກວດສອບຜ່ານ{s.warns > 0 ? ` (ມີເຕືອນ ${s.warns} ແຖວ)` : ""} — ພ້ອມຢືນຢັນ ແລະ ສ້າງໃບກວດນັບ
            </div>
          )}

          {(result.lines ?? []).some((l) => l.check_status > 0) && (
            <details>
              <summary className="cursor-pointer text-xs font-bold text-amber-700 dark:text-amber-400">
                ດູແຖວທີ່ມີບັນຫາ ({(result.lines ?? []).filter((l) => l.check_status > 0).length})
              </summary>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-white p-2 text-[11px] dark:bg-zinc-950">
                {(result.lines ?? []).filter((l) => l.check_status > 0).map((l) => (
                  <li key={l.src_row} className={l.check_status === 2 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>
                    <span className="font-mono">ແຖວ {l.src_row}</span> · {l.raw_item_code || "—"} · {l.check_note}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
