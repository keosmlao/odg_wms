"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, SearchIcon } from "@/components/ui/Icons";
import { useBinNames } from "@/components/useBinNames";
import { nodeName } from "@/lib/locationLabel";
import {
  DEFECT_GRADES,
  DEFECT_GRADE_LABEL,
  type DefectGrade,
  type DefectWarehouseOption,
} from "@/lib/defects-shared";

/**
 * ບັນທຶກເຄື່ອງມີຕຳນິ — register one defective item with photos.
 *
 * Ports the legacy `addproduct_deface` form. The item is picked from the master
 * via the shared item search, and its name/unit/brand are re-read server-side on
 * submit, so what lands in the register always matches the master.
 */

type ItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  item_brand: string | null;
  wh_balance: string | null;
};

/** One serial from /api/defects/sn-lookup — carries both numbers and its position. */
type SnHit = {
  sn: string | null;
  isn: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  item_brand: string | null;
  wh_code: string | null;
  warehouse_name: string | null;
  is_defect_warehouse: boolean;
  rack: string | null;
  location: string | null;
  pallet: string | null;
  in_stock: boolean;
  registered_ref: string | null;
  registered_status: number | null;
};

const inputCls =
  "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-rose-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

export default function NewDefectForm({
  warehouses,
}: {
  warehouses: DefectWarehouseOption[];
}) {
  const router = useRouter();
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [item, setItem] = useState<ItemHit | null>(null);
  const [qty, setQty] = useState("1");
  const [sn, setSn] = useState("");
  const [grade, setGrade] = useState<DefectGrade>("B");
  const [remark, setRemark] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Serial scan: `picked` is the resolved serial whose details are on screen.
  const [scan, setScan] = useState("");
  const [snHits, setSnHits] = useState<SnHit[]>([]);
  const [snBusy, setSnBusy] = useState(false);
  const [snNote, setSnNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<SnHit | null>(null);
  /** ຊື່ຊັ້ນວາງ/ບ່ອນເກັບ ຂອງສາງທີ່ serial ນີ້ຢູ່ — ສະແດງແທນລະຫັດ. */
  const binNames = useBinNames(picked?.wh_code ?? null);

  /** Fill the form from a scanned serial — item, warehouse and SN all at once. */
  const applyHit = useCallback(
    (h: SnHit) => {
      setPicked(h);
      setItem({
        item_code: h.item_code,
        item_name: h.item_name,
        unit_code: h.unit_code,
        item_brand: h.item_brand,
        wh_balance: null,
      });
      // The register stores one serial per entry; prefer sn, fall back to the
      // isn that ISN-only stock carries instead.
      setSn(h.sn || h.isn || "");
      // Only adopt the serial's warehouse if it is one this form can register
      // into — otherwise leave the picker alone and let the warning explain.
      if (h.wh_code && warehouses.some((w) => w.code === h.wh_code)) setWh(h.wh_code);
      setQ("");
      setHits([]);
    },
    [warehouses],
  );

  // Scan or type a serial: both sn and isn are matched, and both come back.
  useEffect(() => {
    const term = scan.trim();
    if (term.length < 4) {
      setSnHits([]);
      setSnNote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSnBusy(true);
      try {
        const res = await fetch(`/api/defects/sn-lookup?q=${encodeURIComponent(term)}`);
        const data = (await res.json()) as {
          hits?: SnHit[];
          out_of_scope?: boolean;
          error?: string;
        };
        if (cancelled) return;
        const found = data.hits ?? [];
        setSnHits(found);
        if (found.length === 1) {
          applyHit(found[0]);
          setSnNote(null);
        } else if (found.length === 0) {
          setSnNote(
            data.error ??
              (data.out_of_scope
                ? "ພົບ serial ນີ້ ແຕ່ຢູ່ໃນສາງທີ່ທ່ານບໍ່ມີສິດເຂົ້າເຖິງ"
                : "ບໍ່ພົບ serial ນີ້ — ຄົ້ນຫາດ້ວຍລະຫັດ ຫຼື ຊື່ສິນຄ້າແທນໄດ້"),
          );
        } else {
          setSnNote(null);
        }
      } catch {
        if (!cancelled) {
          setSnHits([]);
          setSnNote("ຄົ້ນຫາບໍ່ສຳເລັດ");
        }
      } finally {
        if (!cancelled) setSnBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scan, applyHit]);

  // Item search is scoped to the chosen warehouse so the balance shown is that
  // warehouse's — picking the warehouse first is the natural order anyway.
  useEffect(() => {
    const term = q.trim();
    if (!wh || term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ warehouse: wh, q: term, limit: "20" });
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: ItemHit[] };
        if (!cancelled) setHits(data.items ?? []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, wh]);

  function reset() {
    setItem(null);
    setQ("");
    setHits([]);
    setScan("");
    setSnHits([]);
    setSnNote(null);
    setPicked(null);
    setQty("1");
    setSn("");
    setGrade("B");
    setRemark("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    setMsg(null);
    if (!wh) return setMsg({ tone: "err", text: "ກະລຸນາເລືອກສາງ" });
    if (!item) return setMsg({ tone: "err", text: "ກະລຸນາເລືອກສິນຄ້າ" });
    const n = Number.parseFloat(qty);
    if (!Number.isFinite(n) || n <= 0) {
      return setMsg({ tone: "err", text: "ຈຳນວນຕ້ອງໃຫຍ່ກວ່າ 0" });
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("item_code", item.item_code);
      form.set("warehouse", wh);
      form.set("qty", qty);
      form.set("sn", sn);
      // Only a scan knows the counterpart number; typed serials have none.
      form.set("isn", picked?.isn ?? "");
      form.set("grade", grade);
      form.set("remark", remark);
      for (const f of files) form.append("files", f);

      const res = await fetch("/api/defects", { method: "POST", body: form });
      const data = (await res.json()) as { code_ref?: string; images?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setMsg({
        tone: "ok",
        text: `ບັນທຶກສຳເລັດ · ເລກອ້າງອີງ #${data.code_ref}${data.images ? ` · ${data.images} ຮູບ` : ""}`,
      });
      reset();
      // Keep the report's totals in step for anyone navigating straight there.
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200">1 · ສະແກນ serial ຫຼື ເລືອກສາງ ແລະ ສິນຄ້າ</h2>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            ສະແກນ SN / ISN
            <span className="ml-1 font-normal text-zinc-400">(ຕື່ມສາງ, ລະຫັດ, ຊື່ ແລະ ອື່ນໆ ໃຫ້ອັດຕະໂນມັດ)</span>
          </span>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="ສະແກນ ຫຼື ພິມ SN / ISN..."
              className={`${inputCls} pl-8 font-mono`}
            />
            {snBusy && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">
                ກຳລັງຄົ້ນຫາ...
              </span>
            )}
          </div>
        </label>

        {snNote && (
          <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">{snNote}</p>
        )}

        {snHits.length > 1 && (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {snHits.map((h) => (
                <li key={`${h.item_code}·${h.sn ?? ""}·${h.isn ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => {
                      applyHit(h);
                      setSnHits([]);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-sky-50/50 dark:hover:bg-sky-950/20"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] font-bold text-sky-700 dark:text-sky-400">
                        SN {h.sn || "—"} · ISN {h.isn || "—"}
                      </div>
                      <div className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                        {h.item_name ?? h.item_code}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] text-zinc-400">
                      <div>{h.wh_code ?? "—"}</div>
                      {h.registered_ref && (
                        <div className="font-semibold text-amber-600 dark:text-amber-400">ລົງທະບຽນແລ້ວ</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {picked && (
          <div className="mt-3 rounded-xl bg-sky-50/60 p-3 ring-1 ring-sky-200 dark:bg-sky-950/20 dark:ring-sky-900/50">
            {/* Both numbers are shown side by side: a label may carry either one,
                and the operator needs to match what is in their hand. */}
            <div className="grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">SN</span>{" "}
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                  {picked.sn || "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">ISN</span>{" "}
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                  {picked.isn || "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">ສາງ</span>{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                  {picked.wh_code ?? "—"}
                  {picked.warehouse_name ? ` · ${picked.warehouse_name}` : ""}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">ຕຳແໜ່ງ</span>{" "}
                <span
                  title={[picked.rack, picked.location, picked.pallet].filter(Boolean).join(" / ")}
                  className="text-zinc-700 dark:text-zinc-200"
                >
                  {nodeName(picked, binNames, "—")}
                </span>
              </div>
            </div>

            {picked.registered_ref && (
              <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                ⚠ serial ນີ້ລົງທະບຽນເປັນເຄື່ອງມີຕຳນິແລ້ວ · ເລກອ້າງອີງ #{picked.registered_ref}
              </p>
            )}
            {!picked.in_stock && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                ⚠ serial ນີ້ບໍ່ຢູ່ໃນສະຕັອກແລ້ວ
              </p>
            )}
            {picked.wh_code && !warehouses.some((w) => w.code === picked.wh_code) && (
              <p className="mt-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                ⚠ ສາງ {picked.wh_code} ບໍ່ມີບ່ອນເກັບເຄື່ອງມີຕຳນິ ຫຼື ທ່ານບໍ່ມີສິດ — ກະລຸນາເລືອກສາງເອງ
              </p>
            )}
          </div>
        )}

        <div className="my-4 border-t border-zinc-100 dark:border-zinc-800" />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງທີ່ເກັບເຄື່ອງມີຕຳນິ *</span>
            <select
              value={wh}
              onChange={(e) => {
                setWh(e.target.value);
                setItem(null);
                setHits([]);
                setPicked(null);
              }}
              className={inputCls}
            >
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} · {w.name ?? ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຄົ້ນຫາສິນຄ້າ *</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={!wh}
                placeholder={wh ? "ລະຫັດ ຫຼື ຊື່ສິນຄ້າ..." : "ເລືອກສາງກ່ອນ"}
                className={`${inputCls} pl-8 disabled:opacity-50`}
              />
            </div>
          </label>
        </div>

        {q.trim().length >= 2 && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            {searching && <div className="px-4 py-4 text-center text-xs text-zinc-400">ກຳລັງຄົ້ນຫາ...</div>}
            {!searching && hits.length === 0 && (
              <div className="px-4 py-4 text-center text-xs text-zinc-400">ບໍ່ພົບສິນຄ້າ</div>
            )}
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {hits.map((h) => (
                <li key={h.item_code}>
                  <button
                    type="button"
                    onClick={() => {
                      setItem(h);
                      setQ("");
                      setHits([]);
                      // Picking an item by hand replaces whatever the scan found.
                      setPicked(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-rose-50/40 dark:hover:bg-rose-950/20"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold text-rose-700 dark:text-rose-400">{h.item_code}</div>
                      <div className="truncate text-xs text-zinc-700 dark:text-zinc-300">{h.item_name ?? "—"}</div>
                      {h.item_brand && (
                        <div className="truncate text-[10px] text-zinc-400">{h.item_brand}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[10px] text-zinc-400">
                      ຄົງເຫຼືອ {Number.parseFloat(h.wh_balance ?? "0").toLocaleString("en-US")} {h.unit_code}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {item && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-rose-50/60 p-3 ring-1 ring-rose-200 dark:bg-rose-950/20 dark:ring-rose-900/50">
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-bold text-rose-700 dark:text-rose-400">{item.item_code}</div>
              <div className="text-xs text-zinc-700 dark:text-zinc-200">{item.item_name ?? "—"}</div>
              {/* Unit and brand are what the register stores alongside the item,
                  so both are shown on the confirmed pick rather than left to the
                  10px sub-line the search results use. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>
                  ຫົວໜ່ວຍ{" "}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {item.unit_code ?? "—"}
                  </span>
                </span>
                <span>
                  ຍີ່ຫໍ້{" "}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {item.item_brand ?? "—"}
                  </span>
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setItem(null);
                setPicked(null);
              }}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/40"
            >
              ປ່ຽນ
            </button>
          </div>
        )}
      </section>

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200">2 · ລາຍລະອຽດຕຳນິ</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              ຈຳນວນ *
              <span className="ml-1 font-normal text-zinc-400">(ລ໋ອກໄວ້ 1 ຕໍ່ 1 ລາຍການ)</span>
            </span>
            {/* One entry = one unit: the register is per-serial, and photos and
                the SN below describe a single physical item. */}
            <input
              type="number"
              value={qty}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
              className={`${inputCls} cursor-not-allowed bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ເກຣດສະພາບ *</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value as DefectGrade)} className={inputCls}>
              {DEFECT_GRADES.map((g) => (
                <option key={g} value={g}>
                  {DEFECT_GRADE_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              SN / ໝາຍເລກເຄື່ອງ
              <span className="ml-1 font-normal text-zinc-400">
                {picked ? "(ມາຈາກການສະແກນ — ແກ້ບໍ່ໄດ້)" : "(ໃສ່ຖ້າເປັນເຄື່ອງທີ່ມີ serial)"}
              </span>
            </span>
            {/* Locked once a scan resolved it: the serial then matches a real
                sn_inventory row, and hand-editing would break that link. */}
            <input
              type="text"
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              readOnly={picked !== null}
              aria-readonly={picked !== null}
              placeholder="ສະແກນ ຫຼື ພິມ..."
              className={`${inputCls} font-mono ${
                picked ? "cursor-not-allowed bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" : ""
              }`}
            />
            {picked && (
              <span className="mt-1 block text-[10px] text-zinc-400">
                ຢາກແກ້ເອງ? ກົດ &ldquo;ປ່ຽນ&rdquo; ທີ່ບັດສິນຄ້າ ຫຼື ລ້າງກ່ອງສະແກນ
              </span>
            )}
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ອາການຕຳນິ / ໝາຍເຫດ</span>
            <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="ເຊັ່ນ: ຕຳນິຈາກການຂົນສົ່ງ, ຮອຍບຸບຂ້າງຊ້າຍ..." className={inputCls} />
          </label>
        </div>
      </section>

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <h2 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">3 · ຮູບພາບຫຼັກຖານ</h2>
        <p className="mb-3 text-[11px] text-zinc-400">ຖ່າຍໄດ້ຫຼາຍຮູບ · ສູງສຸດ 20 ຮູບ ຕໍ່ຄັ້ງ, ບໍ່ເກີນ 12MB ຕໍ່ຮູບ</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full cursor-pointer rounded-lg bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600 ring-1 ring-zinc-200 file:mr-3 file:rounded-md file:border-0 file:bg-rose-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
        />
        {files.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {files.map((f) => (
              <div key={f.name} className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(f)} alt={f.name} className="h-20 w-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </section>

      {msg && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-semibold ring-1 ${
            msg.tone === "ok"
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50"
              : "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !item || !wh}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-500/20 transition hover:shadow-lg disabled:opacity-50"
        >
          <CheckIcon className="h-4 w-4" />
          {busy ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກເຄື່ອງມີຕຳນິ"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
        >
          ລ້າງຟອມ
        </button>
      </div>
    </div>
  );
}
