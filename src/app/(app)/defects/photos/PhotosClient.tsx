"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/Icons";
import { DEFECT_STATUS, type DefectWarehouseOption } from "@/lib/defects-shared";

/**
 * ລາຍງານເກັບຮູບພາບ ແລະ ໝາຍເລກເຄື່ອງໃນສາງມີຕຳນິ — an evidence gallery over the
 * defect register: one card per entry with its serial and every photo.
 *
 * Laid out as a photo-first grid rather than full-width rows: the page exists to
 * be looked at, and at 300 entries a row each is a scroll nobody finishes. Cards
 * carry the photo as the subject and the identifying fields under it, so a
 * screen shows a dozen entries instead of three.
 *
 * Also the tool for spotting gaps in the evidence: the "ບໍ່ມີຮູບ" filter lists
 * entries nobody photographed, which is what the legacy report was used to chase
 * — so a missing photo is rendered as a loud placeholder, not an empty space.
 */

type PhotoRow = {
  code_ref: string;
  ic_code: string;
  ic_name: string | null;
  qty: string;
  unit_code: string | null;
  item_brand: string | null;
  sn: string | null;
  remark: string | null;
  grade: string | null;
  status: number;
  warehouse: string | null;
  warehouse_name: string | null;
  date_register: string | null;
  images: { image_url: string; url: string }[];
};

type Kpi = { entries: number; images: number; no_photo: number; no_sn: number };

/** Lightbox target: an entry plus which of its photos is on screen. */
type Viewing = { row: PhotoRow; index: number };

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-rose-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

const fmtQty = (v: string) =>
  Number.parseFloat(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function PhotosClient({
  warehouses,
}: {
  warehouses: DefectWarehouseOption[];
}) {
  const [wh, setWh] = useState("");
  const [status, setStatus] = useState("all");
  const [photos, setPhotos] = useState("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ status, photos, limit: "300" });
    if (wh) p.set("wh", wh);
    return p;
  }, [status, photos, wh]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/defects/photos?${params}`);
      const data = (await res.json()) as { kpi?: Kpi; rows?: PhotoRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setKpi(data.kpi ?? null);
      setRows(data.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      setRows([]);
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes; arrows step through the photos of the entry being viewed.
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setViewing(null);
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setViewing((v) => {
        if (!v) return v;
        const n = v.row.images.length;
        const step = e.key === "ArrowRight" ? 1 : -1;
        return { ...v, index: (v.index + step + n) % n };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.ic_code.toLowerCase().includes(s) ||
        (r.ic_name ?? "").toLowerCase().includes(s) ||
        (r.sn ?? "").toLowerCase().includes(s),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທຸກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} · {w.name ?? ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສະຖານະ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-full`}>
              <option value="all">ທັງໝົດ</option>
              <option value="0">ຍັງບໍ່ເບີກຈ່າຍ</option>
              <option value="1">ເບີກຈ່າຍແລ້ວ</option>
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຮູບພາບ</label>
            <select value={photos} onChange={(e) => setPhotos(e.target.value)} className={`${inputCls} w-full`}>
              <option value="all">ທັງໝົດ</option>
              <option value="with">ມີຮູບ</option>
              <option value="without">ບໍ່ມີຮູບ</option>
            </select>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ກອງລະຫັດ / ຊື່ / SN..."
              className={`${inputCls} pl-8`}
            />
          </div>
        </div>
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
      </section>

      {kpi && (
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="ລາຍການ" value={kpi.entries} sub="ສູງສຸດ 300 ລ່າສຸດ" />
          <Stat label="ຮູບພາບ" value={kpi.images} tone="indigo" />
          {/* Zero is the good outcome for these two — colour the problem, not the row. */}
          <Stat label="ບໍ່ມີຮູບ" value={kpi.no_photo} tone={kpi.no_photo > 0 ? "rose" : "ok"} sub="ຄວນຖ່າຍຮູບເພິ່ມ" />
          <Stat label="ບໍ່ມີ SN" value={kpi.no_sn} tone={kpi.no_sn > 0 ? "amber" : "ok"} sub="ຄວນໃສ່ໝາຍເລກເຄື່ອງ" />
        </section>
      )}

      {loading && (
        <div className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          ກຳລັງໂຫຼດ...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
          ບໍ່ມີລາຍການ
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          <p className="text-[11px] text-zinc-400">
            ສະແດງ {filtered.length.toLocaleString("en-US")} ລາຍການ
            {q.trim() && ` (ກອງຈາກ ${rows.length.toLocaleString("en-US")})`}
          </p>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((r) => (
              <Card key={r.code_ref} row={r} onOpen={(index) => setViewing({ row: r, index })} />
            ))}
          </section>
        </>
      )}

      {viewing && <Lightbox viewing={viewing} onChange={setViewing} />}
    </div>
  );
}

/* ---------------------------------------------------------------- card ---- */

function Card({ row, onOpen }: { row: PhotoRow; onOpen: (index: number) => void }) {
  const cover = row.images[0];
  const issued = row.status === DEFECT_STATUS.dispatched;

  return (
    <article className="group shadow-card flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 transition hover:ring-rose-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-rose-800">
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {cover ? (
          <button
            type="button"
            onClick={() => onOpen(0)}
            aria-label={`ເປີດຮູບ #${row.code_ref}`}
            className="absolute inset-0 h-full w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.url}
              alt={cover.image_url}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
            />
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-rose-50/70 dark:bg-rose-950/20">
            <AlertIcon className="h-6 w-6 text-rose-400" />
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              ຍັງບໍ່ມີຮູບຫຼັກຖານ
            </span>
          </div>
        )}

        {/* Badges sit over the photo so the body below stays pure data. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <span className="rounded-md bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-700 shadow-sm backdrop-blur-sm dark:bg-zinc-900/90 dark:text-zinc-200">
            #{row.code_ref}
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            {row.grade && (
              <span className="rounded-full bg-rose-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                ເກຣດ {row.grade}
              </span>
            )}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm ${
                issued ? "bg-violet-600/90" : "bg-amber-500/90"
              }`}
            >
              {issued ? "ເບີກຈ່າຍແລ້ວ" : "ຍັງບໍ່ເບີກຈ່າຍ"}
            </span>
          </div>
        </div>

        {row.images.length > 1 && (
          <button
            type="button"
            onClick={() => onOpen(0)}
            className="absolute bottom-2 right-2 rounded-md bg-zinc-900/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm transition hover:bg-zinc-900"
          >
            +{row.images.length - 1} ຮູບ
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <div className="font-mono text-[11px] font-bold text-rose-700 dark:text-rose-400">{row.ic_code}</div>
          <div className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">
            {row.ic_name ?? "—"}
          </div>
        </div>

        {/* Labelled rows, not a run-on line: SN is what this page is scanned for. */}
        <dl className="space-y-1 text-[11px]">
          <Field label="SN">
            {row.sn ? (
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">{row.sn}</span>
            ) : (
              <span className="font-semibold italic text-rose-500">ບໍ່ມີ</span>
            )}
          </Field>
          <Field label="ຍີ່ຫໍ້">{row.item_brand ?? "—"}</Field>
          <Field label="ສາງ">
            <span className="font-mono">{row.warehouse ?? "—"}</span>
            {row.warehouse_name ? ` · ${row.warehouse_name}` : ""}
          </Field>
        </dl>

        {row.remark && (
          <p
            className="line-clamp-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-500 dark:bg-zinc-950/60 dark:text-zinc-400"
            title={row.remark}
          >
            {row.remark}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-2 text-[10px] text-zinc-400 dark:border-zinc-800">
          <span>{row.date_register ?? "—"}</span>
          <span className="font-mono text-xs font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
            {fmtQty(row.qty)}
            <span className="ml-1 text-[10px] font-normal text-zinc-400">{row.unit_code}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="w-10 shrink-0 text-zinc-400">{label}</dt>
      <dd className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------ lightbox ---- */

function Lightbox({
  viewing,
  onChange,
}: {
  viewing: Viewing;
  onChange: (v: Viewing | null) => void;
}) {
  const { row, index } = viewing;
  const total = row.images.length;
  const img = row.images[index];
  const step = (d: number) => onChange({ row, index: (index + d + total) % total });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="ປິດ"
        onClick={() => onChange(null)}
        className="absolute inset-0 bg-zinc-900/85 backdrop-blur-sm"
      />

      <div className="relative flex max-h-full max-w-5xl flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.image_url} className="max-h-[78vh] rounded-xl shadow-2xl" />

        <div className="mt-3 flex items-center gap-3 text-xs font-semibold text-white">
          <span className="font-mono">#{row.code_ref}</span>
          <span className="text-white/60">·</span>
          <span className="font-mono">{row.ic_code}</span>
          {row.sn && (
            <>
              <span className="text-white/60">·</span>
              <span className="font-mono">SN {row.sn}</span>
            </>
          )}
          {total > 1 && <span className="text-white/60">{index + 1}/{total}</span>}
        </div>

        {total > 1 && (
          <>
            <button
              type="button"
              aria-label="ຮູບກ່ອນໜ້າ"
              onClick={() => step(-1)}
              className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-zinc-800 shadow-lg transition hover:bg-white"
            >
              <ChevronRightIcon className="h-5 w-5 rotate-180" />
            </button>
            <button
              type="button"
              aria-label="ຮູບຕໍ່ໄປ"
              onClick={() => step(1)}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/90 p-2 text-zinc-800 shadow-lg transition hover:bg-white"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- kpi ---- */

const STAT_TONE = {
  zinc: "text-zinc-900 dark:text-zinc-50",
  indigo: "text-indigo-600 dark:text-indigo-400",
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
  ok: "text-emerald-600 dark:text-emerald-400",
} as const;

function Stat({
  label,
  value,
  sub,
  tone = "zinc",
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <div className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${STAT_TONE[tone]}`}>
        {value.toLocaleString("en-US")}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}
