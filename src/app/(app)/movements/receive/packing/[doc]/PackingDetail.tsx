"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon, ListIcon } from "@/components/ui/Icons";

type Header = {
  doc_no: string; doc_date: string; wh_code: string; wh_name: string | null;
  ref_no: string | null; supplier_code: string | null; supplier_name: string | null;
  status: number; line_count: number; total_qty: string; error_count: number; warn_count: number;
  remark: string | null; count_doc_no: string | null; creator_name: string | null; created_at: string | null;
};
type Line = {
  roworder: string; src_row: number; po_no: string; item_code: string | null; raw_item_code: string;
  src_text: string | null; item_name: string; unit_code: string; qty: number;
  ordered: number | null; remaining: number | null;
  is_isn: boolean; check_status: number; check_note: string;
};
type ItemHit = { item_code: string; item_name: string | null; unit_code: string | null };

/** ຜົນການແນະນຳ: ຊື່ຈາກໄຟລ໌ → ສິນຄ້າ SML → ແຜນຈັດສັນເຂົ້າ PO */
type Candidate = { item_code: string; item_name: string | null; total_remaining: number; pos: string[]; score: number };
type Allocation = { po_no: string; qty: number; remaining: number; po_date: string | null };
type MatchLine = {
  id: string; text: string; qty: number;
  item_code: string | null; item_name: string | null; unit_code: string | null;
  confident: boolean; candidates: Candidate[]; allocations: Allocation[]; unallocated: number; note: string;
};
type MatchResp = {
  lines: MatchLine[];
  po_summary: { po_no: string; lines: number; qty: number }[];
  unresolved: number; needs_review: number; over: number; pool_size: number;
};
type FileRow = { id: number; kind: number; file_name: string | null; mime_type: string | null; file_size: number | null; uploaded_at: string | null };
type PoSum = { po_no: string; lines: number; qty: number; blocked: number };
type Doc = { header: Header; lines: Line[]; files: FileRow[]; pos: PoSum[]; can_verify: boolean; can_count: boolean };
/** ແຖວທີ່ຈະກາຍເປັນໃບກວດນັບ — ລວມຕໍ່ສິນຄ້າ, ກວດ/ແກ້ໄດ້ກ່ອນບັນທຶກ. */
type PreviewLine = {
  item_code: string; item_name: string; unit_code: string;
  qty: number; remaining: number; is_isn: boolean; pos: string[]; include: boolean;
};

const STATUS: Record<number, { text: string; cls: string }> = {
  0: { text: "ນຳເຂົ້າແລ້ວ", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  1: { text: "ກວດສອບຜ່ານ", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  5: { text: "ສ້າງໃບກວດນັບແລ້ວ", cls: "bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300" },
  9: { text: "ຍົກເລີກ", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
};

function fmt(n: number | null) {
  return Number.isFinite(n ?? NaN) ? (n as number).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
}

/**
 * ຄົ້ນຫາສິນຄ້າໃນ SML ແລ້ວຈັບຄູ່ໃຫ້ແຖວທີ່ຍັງບໍ່ມີລະຫັດ.
 * ຕິກ "ຈື່ໄວ້" = ຄັ້ງໜ້າຂໍ້ຄວາມດຽວກັນຈະຈັບຄູ່ອັດຕະໂນມັດ.
 */
function ItemPicker({ wh, busy, onPick }: { wh: string; busy: boolean; onPick: (code: string, remember: boolean) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [remember, setRemember] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/movements/items/search?wh=${encodeURIComponent(wh)}&q=${encodeURIComponent(term)}&limit=15`);
        const data = (await res.json()) as { items?: ItemHit[]; lines?: ItemHit[] };
        if (!cancelled) setHits(data.items ?? data.lines ?? []);
      } catch { if (!cancelled) setHits([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, wh]);

  return (
    <div className="mt-1.5 rounded-lg bg-amber-50/60 p-2 ring-1 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/50">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ຄົ້ນຫາລະຫັດ / ຊື່ ໃນ SML..."
        className="w-full rounded-md bg-white px-2 py-1.5 text-xs text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
      />
      {searching && <div className="mt-1 text-[10px] text-zinc-400">ກຳລັງຄົ້ນຫາ...</div>}
      {hits.length > 0 && (
        <ul className="mt-1 max-h-40 divide-y divide-zinc-100 overflow-y-auto rounded-md bg-white dark:divide-zinc-800 dark:bg-zinc-950">
          {hits.map((h) => (
            <li key={h.item_code}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(h.item_code, remember)}
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/30"
              >
                <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400">{h.item_code}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300">{h.item_name ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-3 w-3 accent-emerald-600" />
        ຈື່ການຈັບຄູ່ນີ້ໄວ້ໃຊ້ຄັ້ງຕໍ່ໄປ
      </label>
    </div>
  );
}

/** ໃບ packing ໜຶ່ງໃບ: ຜົນກວດສອບ · ໄຟລ໌ຕົ້ນສະບັບ · ຢືນຢັນ → ສ້າງໃບກວດນັບ. */
export default function PackingDetail({ doc }: { doc: string }) {
  const router = useRouter();
  const [data, setData] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [match, setMatch] = useState<MatchResp | null>(null);
  const [matching, setMatching] = useState(false);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 5000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/receive/packing-list/docs/${encodeURIComponent(doc)}`);
      const json = (await res.json()) as Doc & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      setData(json);
      setPreview(null); // ຂໍ້ມູນປ່ຽນ → ໃຫ້ກວດຄືນກ່ອນບັນທຶກ
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }, [doc]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/receive/packing-list/docs/${encodeURIComponent(doc)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", action === "verify" ? "ຢືນຢັນໃບ packing ແລ້ວ" : "ບັນທຶກແລ້ວ");
      await load();
      router.refresh();
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ຂໍຄຳແນະນຳ: ຊື່ຈາກໄຟລ໌ແມ່ນສິນຄ້າໃດໃນ SML · ຄວນເຂົ້າ PO ໃດ ·
   * ຈຳນວນເກີນຄ້າງຮັບຂອງ PO ນັ້ນບໍ່ (ເກີນ → ໄຫຼໄປ PO ຕໍ່ໄປ).
   */
  async function runMatch() {
    setMatching(true);
    try {
      const res = await fetch("/api/receive/packing-list/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_no: doc }),
      });
      const json = (await res.json()) as MatchResp & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      setMatch(json);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setMatching(false);
    }
  }

  /** ນຳຄຳແນະນຳທັງໝົດທີ່ໝັ້ນໃຈ ໄປບັນທຶກເປັນລະຫັດ SML ຂອງແຖວ */
  async function applyMatches() {
    if (!match) return;
    const todo = match.lines.filter((m) => m.item_code);
    if (todo.length === 0) { showToast("err", "ບໍ່ມີຄຳແນະນຳທີ່ຈະນຳໃຊ້"); return; }
    setBusy(true);
    let done = 0;
    try {
      for (const m of todo) {
        const res = await fetch(`/api/receive/packing-list/docs/${encodeURIComponent(doc)}/lines`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roworder: m.id, item_code: m.item_code, remember: true }),
        });
        if (res.ok) done++;
      }
      showToast("ok", `ນຳໃຊ້ຄຳແນະນຳ ${done}/${todo.length} ແຖວ`);
      await load();
      await runMatch();
    } finally {
      setBusy(false);
    }
  }

  /** ຈັບຄູ່ແຖວກັບລະຫັດ SML (ແລະ ຈື່ໄວ້ຖ້າຕິກ) ແລ້ວກວດສອບຄືນທັງໃບ. */
  async function mapLine(roworder: string, itemCode: string, remember: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/receive/packing-list/docs/${encodeURIComponent(doc)}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roworder, item_code: itemCode, remember }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; remembered?: boolean };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ຈັບຄູ່ກັບ ${itemCode} ແລ້ວ${json.remembered ? " · ຈື່ໄວ້ແລ້ວ" : ""}`);
      await load();
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  /** ລຶບແຖວທີ່ບໍ່ຕ້ອງການ (ເຊັ່ນ ແຖວຫົວກຸ່ມຈາກໄຟລ໌ຜູ້ສະໜອງ). */
  async function removeLine(roworder: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/receive/packing-list/docs/${encodeURIComponent(doc)}/lines?roworder=${encodeURIComponent(roworder)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      await load();
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ຂັ້ນກວດກ່ອນບັນທຶກ: ລວມລາຍການຕໍ່ສິນຄ້າ (ຫຼາຍ PO ໄດ້ 1 ໃບ) ແລ້ວສະແດງໃຫ້ເບິ່ງ
   * — ແກ້ຈຳນວນ / ຕັດລາຍການອອກໄດ້ ກ່ອນຈຶ່ງບັນທຶກເປັນໃບກວດນັບ.
   */
  function buildPreview() {
    if (!data) return;
    const usable = data.lines.filter((l) => l.check_status < 2 && l.item_code && l.qty > 0);
    if (usable.length === 0) { showToast("err", "ບໍ່ມີລາຍການທີ່ໃຊ້ໄດ້"); return; }

    const byItem = new Map<string, PreviewLine>();
    for (const l of usable) {
      const key = l.item_code!;
      const e = byItem.get(key) ?? {
        item_code: key, item_name: l.item_name, unit_code: l.unit_code,
        qty: 0, remaining: 0, is_isn: l.is_isn, pos: [], include: true,
      };
      e.qty += l.qty;
      e.remaining += l.remaining ?? 0;
      e.is_isn = e.is_isn || l.is_isn;
      if (l.po_no && !e.pos.includes(l.po_no)) e.pos.push(l.po_no);
      byItem.set(key, e);
    }
    setPreview(Array.from(byItem.values()));
  }

  /** ບັນທຶກຕົວຈິງ — ໃຊ້ຂໍ້ມູນທີ່ຢືນຢັນຢູ່ໜ້າກວດ. */
  async function saveCountSheet() {
    if (!data || !preview) return;
    const chosen = preview.filter((p) => p.include && p.qty > 0);
    if (chosen.length === 0) { showToast("err", "ບໍ່ໄດ້ເລືອກລາຍການໃດ"); return; }
    const pos = Array.from(new Set(chosen.flatMap((p) => p.pos)));
    const byItem = new Map(chosen.map((p) => [p.item_code, p]));

    setBusy(true);
    try {
      const res = await fetch("/api/receive/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pos,
          pack_no: data.header.ref_no || null,
          packing_doc_no: data.header.doc_no,
          wh_code: data.header.wh_code,
          supplier_code: data.header.supplier_code,
          remark: `ຈາກໃບ packing ${data.header.doc_no}`,
          // ລະຫັດ/ຊື່/ຫົວໜ່ວຍ ເປັນຂອງ SML ຢູ່ແລ້ວ (ມາຈາກການ match ic_inventory)
          lines: Array.from(byItem.values()).map((p) => ({
            item_code: p.item_code, item_name: p.item_name, unit_code: p.unit_code, qty: p.qty,
          })),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; count_code?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ສ້າງໃບກວດນັບ ${json.count_code} ສຳເລັດ`);
      setTimeout(() => router.push(`/movements/receive/count/${encodeURIComponent(json.count_code!)}`), 700);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <div className="rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-400 dark:border-zinc-800">ກຳລັງໂຫຼດ...</div>;
  }
  if (!data) {
    return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ບໍ່ພົບໃບ packing ນີ້</div>;
  }

  const h = data.header;
  const st = STATUS[h.status] ?? STATUS[0];
  const shown = onlyIssues ? data.lines.filter((l) => l.check_status > 0) : data.lines;
  const ghostBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800";
  const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-black text-emerald-700 dark:text-emerald-400">{h.doc_no}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.text}</span>
          {h.count_doc_no && (
            <Link href={`/movements/receive/count/${encodeURIComponent(h.count_doc_no)}`} className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
              ໃບກວດນັບ {h.count_doc_no} →
            </Link>
          )}
          <Link href="/movements/receive?tab=packing" className="ml-auto text-xs font-semibold text-zinc-500 hover:underline">← ກັບຄືນ</Link>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2 lg:grid-cols-4 dark:text-zinc-400">
          <div><span className="text-zinc-400">ວັນທີ່ຮັບ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.doc_date}</b></div>
          <div><span className="text-zinc-400">ສາງ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.wh_code}{h.wh_name ? ` · ${h.wh_name}` : ""}</b></div>
          <div><span className="text-zinc-400">ໃບຕົ້ນສະບັບ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.ref_no ?? "—"}</b></div>
          <div><span className="text-zinc-400">ຜູ້ສະໜອງ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.supplier_name ?? h.supplier_code ?? "—"}</b></div>
          <div><span className="text-zinc-400">ລາຍການ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.line_count} · {fmt(Number.parseFloat(h.total_qty))}</b></div>
          <div><span className="text-zinc-400">ນຳເຂົ້າໂດຍ:</span> <b className="text-zinc-800 dark:text-zinc-200">{h.creator_name ?? "—"}</b> <span className="text-zinc-400">{h.created_at ?? ""}</span></div>
          {h.remark && <div className="sm:col-span-2"><span className="text-zinc-400">ໝາຍເຫດ:</span> {h.remark}</div>}
        </div>

        {/* PO summary */}
        {data.pos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.pos.map((p) => (
              <span key={p.po_no} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${p.blocked > 0 ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50" : "bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"}`}>
                <span className="font-mono">PO {p.po_no}</span> · {p.lines} ລາຍການ · {fmt(p.qty)}
                {p.blocked > 0 && <span className="ml-1 font-bold">⚠ {p.blocked}</span>}
              </span>
            ))}
          </div>
        )}

        {/* ໄຟລ໌ຕົ້ນສະບັບ */}
        {data.files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.files.map((f) => (
              <a
                key={f.id}
                href={`/api/receive/packing-list/docs/${encodeURIComponent(doc)}/file?id=${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {f.kind === 1 ? "📄" : "📎"} {f.file_name ?? "ໄຟລ໌"}
                <span className="text-zinc-400">{f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : ""}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ຜົນກວດສອບ */}
      {h.error_count > 0 ? (
        <div className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          ບລັອກ {h.error_count} ແຖວ{h.warn_count > 0 ? ` · ເຕືອນ ${h.warn_count} ແຖວ` : ""} — ຮັບເຂົ້າໄດ້ສະເພາະ PO ທີ່ອະນຸມັດແລ້ວ ແລະ ສິນຄ້າທີ່ມີໃນລະບົບ
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          ກວດສອບຜ່ານທຸກແຖວ{h.warn_count > 0 ? ` (ມີເຕືອນ ${h.warn_count} ແຖວ — ຮັບໄດ້ ແຕ່ໃຫ້ກວດຄືນ)` : ""}
        </div>
      )}

      {/* ຄຳແນະນຳ: ຊື່ໃນໄຟລ໌ → ສິນຄ້າ SML → PO ໃດ ຈຳນວນເທົ່າໃດ (ເກີນ → PO ຕໍ່ໄປ) */}
      {match && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-2 ring-brand-300 dark:bg-zinc-900 dark:ring-brand-800">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ຜົນການກວດ: ສິນຄ້າ SML ແລະ PO ທີ່ແນະນຳ</h3>
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
              ທຽບກັບ {match.pool_size} ແຖວຄ້າງຮັບ
            </span>
            {match.unresolved > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">ຍັງບໍ່ຮູ້ສິນຄ້າ {match.unresolved}</span>}
            {match.over > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">ເກີນຄ້າງຮັບ {match.over}</span>}
            <button type="button" onClick={() => setMatch(null)} className="ml-auto text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">ປິດ</button>
          </div>

          {match.po_summary.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] font-semibold text-zinc-500">ຈະເຂົ້າ PO:</span>
              {match.po_summary.map((p) => (
                <span key={p.po_no} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950/30 dark:text-brand-300 dark:ring-brand-900/50">
                  {p.po_no} · {p.lines} ລາຍການ · {fmt(p.qty)}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {match.lines.map((m) => (
              <div key={m.id} className={`rounded-xl p-3 ring-1 ${m.item_code ? "ring-zinc-200 dark:ring-zinc-800" : "bg-rose-50/50 ring-rose-200 dark:bg-rose-950/20 dark:ring-rose-900/50"}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] text-zinc-500">ໄຟລ໌:</span>
                  <span className="max-w-md truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100" title={m.text}>{m.text || "—"}</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-zinc-700 dark:text-zinc-200">× {fmt(m.qty)}</span>
                  {m.note && <span className={`ml-auto text-[10px] ${m.unallocated > 0 || !m.item_code ? "text-rose-600 dark:text-rose-400" : "text-zinc-400"}`}>{m.note}</span>}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-zinc-500">→ SML:</span>
                  {m.item_code ? (
                    <>
                      <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{m.item_code}</span>
                      <span className="max-w-sm truncate text-[11px] text-zinc-600 dark:text-zinc-300">{m.item_name ?? ""}</span>
                      {!m.confident && <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">ກວດຄືນ</span>}
                    </>
                  ) : (
                    <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">ຍັງບໍ່ຮູ້ວ່າແມ່ນສິນຄ້າໃດ — ເລືອກຈາກຄຳແນະນຳລຸ່ມນີ້</span>
                  )}
                </div>

                {/* ແຜນຈັດສັນເຂົ້າ PO */}
                {m.allocations.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-zinc-500">→ PO:</span>
                    {m.allocations.map((a, i) => (
                      <span key={a.po_no} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {i > 0 && <span className="text-zinc-400">↳</span>}
                        <span className="font-mono">{a.po_no}</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{fmt(a.qty)}</span>
                        <span className="text-zinc-400">/ ຄ້າງ {fmt(a.remaining)}</span>
                      </span>
                    ))}
                    {m.unallocated > 0 && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        ບໍ່ມີ PO ຮອງຮັບ {fmt(m.unallocated)}
                      </span>
                    )}
                  </div>
                )}

                {/* ຕົວເລືອກສິນຄ້າອື່ນ */}
                {m.candidates.length > 0 && (!m.item_code || !m.confident) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.candidates.map((c) => (
                      <button
                        key={c.item_code}
                        type="button"
                        disabled={busy}
                        onClick={() => void mapLine(m.id, c.item_code, true)}
                        title={`${c.item_name ?? ""} · ຄ້າງລວມ ${c.total_remaining} · PO ${c.pos.join(", ")}`}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition disabled:opacity-50 ${
                          c.item_code === m.item_code
                            ? "bg-emerald-600 text-white ring-emerald-600"
                            : "bg-white text-zinc-600 ring-zinc-200 hover:bg-emerald-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
                        }`}
                      >
                        {c.item_code} · ຄ້າງ {fmt(c.total_remaining)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => void runMatch()} disabled={matching || busy} className={ghostBtn}>ຄຳນວນຄືນ</button>
            <button type="button" onClick={() => void applyMatches()} disabled={busy || match.lines.every((m) => !m.item_code)} className={primaryBtn}>
              <CheckIcon className="h-4 w-4" />ນຳໃຊ້ຄຳແນະນຳທັງໝົດ
            </button>
          </div>
        </section>
      )}

      {/* ລາຍການ */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">ລາຍການໃນໃບ packing ({shown.length}/{data.lines.length})</span>
          <button type="button" onClick={() => setOnlyIssues((v) => !v)} className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
            {onlyIssues ? "ສະແດງທັງໝົດ" : "ສະເພາະທີ່ມີບັນຫາ"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">PO</th>
                <th className="px-3 py-2.5">ສິນຄ້າ</th>
                <th className="px-3 py-2.5 text-right">ຈຳນວນ</th>
                <th className="px-3 py-2.5 text-right">ສັ່ງ</th>
                <th className="px-3 py-2.5 text-right">ຄ້າງຮັບ</th>
                <th className="px-3 py-2.5">ຜົນກວດ</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {shown.map((l) => (
                <tr key={l.roworder} className={l.check_status === 2 ? "bg-rose-50/50 dark:bg-rose-950/20" : l.check_status === 1 ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                  <td className="px-3 py-2 font-mono text-[10px] text-zinc-400">{l.src_row}</td>
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">{l.po_no || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      {l.item_code ?? l.raw_item_code}
                      {l.is_isn && <span className="ml-1 rounded bg-aqua-100 px-1 text-[9px] text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">SN</span>}
                    </div>
                    {/* ຊື່ຈາກ SML ເປັນຫຼັກ; ຂໍ້ຄວາມຈາກໄຟລ໌ຜູ້ສະໜອງສະແດງເປັນອ້າງອີງ */}
                    <div className="max-w-sm truncate text-[11px] text-zinc-600 dark:text-zinc-400" title={l.item_name}>{l.item_name || "—"}</div>
                    {(l.src_text || l.raw_item_code) && l.src_text !== l.item_name && (
                      <div className="max-w-sm truncate text-[10px] text-zinc-400" title={l.src_text ?? l.raw_item_code}>
                        ຕາມໄຟລ໌: {l.src_text || l.raw_item_code}
                      </div>
                    )}
                    {!l.item_code && h.status < 5 && (
                      <ItemPicker wh={h.wh_code} busy={busy} onPick={(code, remember) => void mapLine(l.roworder, code, remember)} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{fmt(l.qty)} <span className="text-[10px] font-normal text-zinc-400">{l.unit_code}</span></td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">{fmt(l.ordered)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmt(l.remaining)}</td>
                  <td className="px-3 py-2">
                    {l.check_status === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><CheckIcon className="h-3.5 w-3.5" />ຜ່ານ</span>
                    ) : (
                      <span className={`text-[11px] font-semibold ${l.check_status === 2 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {l.check_status === 2 ? "⛔ " : "⚠ "}{l.check_note}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {h.status < 5 && (
                      <button
                        type="button"
                        onClick={() => void removeLine(l.roworder)}
                        disabled={busy}
                        title="ລຶບແຖວນີ້"
                        className="rounded-md px-1.5 py-1 text-[11px] font-bold text-zinc-400 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/20"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={busy} className={ghostBtn}>ກວດສອບຄືນ</button>
            {h.status < 5 && (
              <button type="button" onClick={() => void runMatch()} disabled={busy || matching} className={ghostBtn}>
                {matching ? "ກຳລັງກວດ..." : "ກວດສິນຄ້າ SML + ແນະນຳ PO"}
              </button>
            )}
            {h.status === 1 && <button type="button" onClick={() => void act("reopen")} disabled={busy} className={ghostBtn}>ຍົກເລີກການຢືນຢັນ</button>}
            {h.status < 5 && <button type="button" onClick={() => void act("cancel")} disabled={busy} className={ghostBtn}>ຍົກເລີກໃບນີ້</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {h.status === 0 && (
              <button type="button" onClick={() => void act("verify")} disabled={busy || !data.can_verify} className={primaryBtn} title={data.can_verify ? "" : "ຍັງມີແຖວທີ່ຕ້ອງແກ້"}>
                <CheckIcon className="h-4 w-4" />ຢືນຢັນໃບ packing
              </button>
            )}
            {h.status === 1 && (
              <button type="button" onClick={buildPreview} disabled={busy || !data.can_count} className={primaryBtn}>
                <ListIcon className="h-4 w-4" />ກວດຂໍ້ມູນກ່ອນສ້າງໃບກວດນັບ
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ຂັ້ນກວດຂໍ້ມູນກ່ອນບັນທຶກເປັນໃບກວດນັບ */}
      {preview && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-2 ring-emerald-400 dark:bg-zinc-900 dark:ring-emerald-700">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ກວດຂໍ້ມູນກ່ອນບັນທຶກເປັນໃບກວດນັບ</h3>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ລະຫັດ · ຊື່ · ຫົວໜ່ວຍ ຈາກ SML
            </span>
            <button type="button" onClick={() => setPreview(null)} className="ml-auto text-xs font-semibold text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">ປິດ</button>
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>ສາງ: <b className="text-zinc-800 dark:text-zinc-200">{h.wh_code}{h.wh_name ? ` · ${h.wh_name}` : ""}</b></span>
            <span>ໃບ packing: <b className="text-zinc-800 dark:text-zinc-200">{h.doc_no}</b>{h.ref_no ? ` (${h.ref_no})` : ""}</span>
            <span>ຜູ້ສະໜອງ: <b className="text-zinc-800 dark:text-zinc-200">{h.supplier_name ?? h.supplier_code ?? "—"}</b></span>
            <span>PO: <b className="text-zinc-800 dark:text-zinc-200">{Array.from(new Set(preview.filter((p) => p.include).flatMap((p) => p.pos))).join(", ") || "—"}</b></span>
          </div>

          <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-3 py-2.5">ເອົາ</th>
                  <th className="px-3 py-2.5">ລະຫັດ (SML)</th>
                  <th className="px-3 py-2.5">ຊື່ສິນຄ້າ (SML)</th>
                  <th className="px-3 py-2.5">PO</th>
                  <th className="px-3 py-2.5 text-right">ຄ້າງຮັບ</th>
                  <th className="px-3 py-2.5 text-center">ຈຳນວນທີ່ຈະນັບ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {preview.map((p, i) => {
                  const over = p.remaining > 0 && p.qty > p.remaining + 1e-6;
                  return (
                    <tr key={p.item_code} className={p.include ? "" : "opacity-40"}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={p.include}
                          onChange={(e) => setPreview((prev) => prev!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                          className="h-4 w-4 accent-emerald-600"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        {p.item_code}
                        {p.is_isn && <span className="ml-1 rounded bg-aqua-100 px-1 text-[9px] text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">SN</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300"><span className="block max-w-sm truncate" title={p.item_name}>{p.item_name || "—"}</span></td>
                      <td className="px-3 py-2 font-mono text-[10px] text-zinc-500">{p.pos.join(", ")}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{p.remaining > 0 ? fmt(p.remaining) : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={p.qty}
                            onChange={(e) => setPreview((prev) => prev!.map((x, j) => (j === i ? { ...x, qty: Number.parseFloat(e.target.value) || 0 } : x)))}
                            className={`w-24 rounded-lg bg-white px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums ring-1 focus:outline-none focus:ring-2 dark:bg-zinc-950 ${over ? "ring-rose-400 focus:ring-rose-500" : "ring-zinc-200 focus:ring-emerald-500 dark:ring-zinc-800"}`}
                          />
                          <span className="w-10 text-[10px] text-zinc-400">{p.unit_code}</span>
                        </div>
                        {over && <div className="mt-0.5 text-center text-[10px] text-rose-500">ເກີນຄ້າງຮັບ</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-800/50">
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300" colSpan={5}>
                    ລວມ {preview.filter((p) => p.include && p.qty > 0).length} ລາຍການ
                  </td>
                  <td className="px-3 py-2 text-center font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {fmt(preview.filter((p) => p.include).reduce((s, p) => s + p.qty, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className={ghostBtn}>ຍົກເລີກ</button>
            <button
              type="button"
              onClick={() => void saveCountSheet()}
              disabled={busy || preview.filter((p) => p.include && p.qty > 0).length === 0}
              className={primaryBtn}
            >
              <CheckIcon className="h-4 w-4" />
              {busy ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກເປັນໃບກວດນັບ (${preview.filter((p) => p.include && p.qty > 0).length} ລາຍການ)`}
            </button>
          </div>
        </section>
      )}

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
