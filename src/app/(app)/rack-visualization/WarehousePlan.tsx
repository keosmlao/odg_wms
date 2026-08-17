"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  HEAT_LEGEND,
  formatMeters,
  heatColor,
  type LayoutShape,
  type PlanCell,
  type WarehouseLayout,
} from "@/lib/warehouseLayout";

// WebGL ຕ້ອງ render ຝັ່ງ client ເທົ່ານັ້ນ.
const WarehousePlan3D = dynamic(() => import("./WarehousePlan3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">ກຳລັງໂຫຼດ 3D…</div>
  ),
});

export type PlanLocationMaster = {
  code: string;
  name: string | null;
  rackCode: string;
  widthCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
};

export type PlanMode = "2d" | "3d";
type ColorMode = "heat" | "rack";

const SNAP = 10; // ຊມ.
const PAD = 700; // ຂອບນອກກຳແພງ ສຳລັບປ້າຍຂະໜາດ (ຊມ.)

function snap(v: number) {
  return Math.round(v / SNAP) * SNAP;
}

/** ຕົວອັກສອນດຳ ຫຼື ຂາວ ຕາມຄວາມເຂັ້ມຂອງພື້ນ ເພື່ອໃຫ້ອ່ານອອກທັງໂໝດສີ. */
function labelColor(fill: string): string {
  const hex = fill.replace("#", "");
  if (hex.length !== 6) return "#111827";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

/** client px → ພິກັດພາຍໃນ SVG (ຊມ.) */
function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

type DragState = {
  code: string;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origD: number;
};

export default function WarehousePlan({
  whCode,
  mode,
  cells,
  masters,
  canEdit,
  selectedLoc,
  highlightLocs,
  onSelectLoc,
}: {
  whCode: string;
  /** 2D ຫຼື 3D — ຄວບຄຸມຈາກແຖບແທັບຫຼັກຂອງໜ້າ ບໍ່ແມ່ນປຸ່ມພາຍໃນ. */
  mode: PlanMode;
  cells: Map<string, PlanCell>;
  masters: PlanLocationMaster[];
  canEdit: boolean;
  selectedLoc: string | null;
  highlightLocs: Set<string>;
  /** locationCode = null ໝາຍເຖິງ "ຍົກເລີກການເລືອກ" (ກົດພື້ນຫວ່າງ ຫຼື ກົດຊ້ຳ). */
  onSelectLoc: (rackCode: string, locationCode: string | null) => void;
}) {
  const [layout, setLayout] = useState<WarehouseLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ຄ່າເລີ່ມຕົ້ນ = ສີຕາມຮູບຜັງທີ່ທີມສາງແຕ້ມ (A ແດງ, B ນ້ຳຕານ, C ຟ້າ, D ເຫຼືອງແກ່,
  // Z ເຫຼືອງ, GR ຂຽວ) ເພື່ອໃຫ້ຄົນສາງເຫັນແລ້ວຈຳໄດ້ທັນທີ. heat = ໂໝດວິເຄາະ.
  const [colorMode, setColorMode] = useState<ColorMode>("rack");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const load = useCallback(
    async (auto = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/warehouse-layout?wh=${encodeURIComponent(whCode)}${auto ? "&auto=1" : ""}`);
        const data = (await res.json().catch(() => ({}))) as { layout?: WarehouseLayout; error?: string };
        if (!res.ok || !data.layout) {
          setError(data.error ?? "ໂຫຼດຜັງບໍ່ສຳເລັດ");
          setLayout(null);
          return;
        }
        setLayout(data.layout);
        setDirty(auto);
      } catch {
        setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
        setLayout(null);
      } finally {
        setLoading(false);
      }
    },
    [whCode],
  );

  useEffect(() => {
    setEditing(false);
    setDirty(false);
    setSaveMsg(null);
    void load();
  }, [load]);

  const patchShape = useCallback((code: string, patch: Partial<LayoutShape>) => {
    setLayout((prev) =>
      prev
        ? { ...prev, shapes: prev.shapes.map((s) => (s.code === code ? { ...s, ...patch } : s)) }
        : prev,
    );
    setDirty(true);
  }, []);

  function handlePointerDown(e: React.PointerEvent<SVGRectElement>, shape: LayoutShape, kind: "move" | "resize") {
    if (!editing || !svgRef.current) return;
    e.stopPropagation();
    const p = toSvgPoint(svgRef.current, e.clientX, e.clientY);
    dragRef.current = {
      code: shape.code,
      kind,
      startX: p.x,
      startY: p.y,
      origX: shape.x,
      origY: shape.y,
      origW: shape.w,
      origD: shape.d,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const p = toSvgPoint(svgRef.current, e.clientX, e.clientY);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (drag.kind === "move") {
      patchShape(drag.code, { x: snap(drag.origX + dx), y: snap(drag.origY + dy) });
    } else {
      patchShape(drag.code, {
        w: Math.max(SNAP, snap(drag.origW + dx)),
        d: Math.max(SNAP, snap(drag.origD + dy)),
      });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function handleSave() {
    if (!layout) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/warehouse-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh: whCode, width: layout.width, depth: layout.depth, shapes: layout.shapes }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; saved?: number };
      if (!res.ok || !data.ok) {
        setSaveMsg(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
        return;
      }
      setDirty(false);
      setEditing(false);
      setLayout((prev) => (prev ? { ...prev, source: "db" } : prev));
      setSaveMsg(`ບັນທຶກແລ້ວ ${data.saved ?? layout.shapes.length} ຮູບ`);
    } catch {
      setSaveMsg("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setSaving(false);
    }
  }

  /** ບ່ອນເກັບທີ່ມີໃນ master ແຕ່ຍັງບໍ່ມີເທິງຜັງ — ວາງເພີ່ມເປັນແຖວລຸ່ມສຸດ. */
  const missing = useMemo(() => {
    if (!layout) return [];
    const onPlan = new Set(layout.shapes.map((s) => s.code));
    return masters.filter((m) => !onPlan.has(m.code));
  }, [layout, masters]);

  function addMissing() {
    if (!layout || missing.length === 0) return;
    let x = 200;
    const y = layout.depth + 300;
    const added: LayoutShape[] = missing.map((m, i) => {
      const w = m.widthCm && m.widthCm > 0 ? m.widthCm : 400;
      const d = m.lengthCm && m.lengthCm > 0 ? m.lengthCm : 400;
      const shape: LayoutShape = {
        kind: "location",
        code: m.code,
        label: m.name ?? m.code,
        x,
        y,
        w,
        d,
        h: m.heightCm && m.heightCm > 0 ? m.heightCm : 500,
        color: null,
        sort: 1000 + i,
      };
      x += w + 60;
      return shape;
    });
    const maxRight = Math.max(...added.map((s) => s.x + s.w), layout.width);
    const maxBottom = Math.max(...added.map((s) => s.y + s.d), layout.depth);
    setLayout({ ...layout, width: maxRight + 200, depth: maxBottom + 200, shapes: [...layout.shapes, ...added] });
    setDirty(true);
  }

  const shapeFill = useCallback(
    (shape: LayoutShape) => {
      if (shape.kind === "zone") return shape.color ?? "#e2e8f0";
      if (colorMode === "rack") return shape.color ?? "#cbd5e1";
      const cell = cells.get(shape.code);
      return heatColor({
        pct: cell?.pct ?? null,
        empty: !cell || cell.qty === 0,
        negative: cell?.negative ?? false,
      });
    },
    [cells, colorMode],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">ກຳລັງໂຫຼດຜັງສາງ…</div>
    );
  }

  if (error || !layout) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        {error ?? "ບໍ່ມີຜັງສາງ"}
      </div>
    );
  }

  const sorted = [...layout.shapes].sort((a, b) => a.sort - b.sort);

  return (
    // 3D ຖືກວາງໃນກອບຄວາມສູງຄົງທີ່ຂອງແທັບ (ຄືກັນກັບ 1201) ຈຶ່ງໃຫ້ຢຽດເຕັມກອບ
    // ແທນທີ່ຈະກຳນົດຄວາມສູງເອງ ບໍ່ດັ່ງນັ້ນຈະລົ້ນອອກນອກ section.
    <div className={mode === "3d" ? "flex h-full flex-col gap-3" : "space-y-4"}>
      {/* ແຖບຄວບຄຸມ — 2D/3D ຢູ່ແຖບແທັບຫຼັກຂອງໜ້າແລ້ວ ຈຶ່ງເຫຼືອແຕ່ໂໝດສີ ແລະ ການແກ້ໄຂ */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
            {(
              [
                ["heat", "ສີຕາມຄວາມແໜ້ນ"],
                ["rack", "ສີຕາມ rack"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setColorMode(value)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                  colorMode === value
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-medium text-zinc-400">
            {formatMeters(layout.width)} × {formatMeters(layout.depth)}
            {layout.source === "auto" && " · ຜັງອັດຕະໂນມັດ (ຍັງບໍ່ໄດ້ບັນທຶກ)"}
          </span>

          {canEdit && (
            <div className="flex items-center gap-2">
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  ແກ້ໄຂຜັງ
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
                  >
                    {saving ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກຜັງ"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      void load();
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    ຍົກເລີກ
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <span className="font-semibold">✏️ ໂໝດແກ້ໄຂ:</span>
          <span>ລາກບລ໋ອກ = ຍ້າຍ · ລາກມູມຂວາລຸ່ມ = ປັບຂະໜາດ (ຂັ້ນລະ {SNAP} ຊມ.)</span>
          <label className="flex items-center gap-1.5">
            ກວ້າງ (ຊມ.)
            <input
              type="number"
              value={layout.width}
              onChange={(e) => {
                setLayout({ ...layout, width: Math.max(100, Number(e.target.value) || 0) });
                setDirty(true);
              }}
              className="w-24 rounded border border-sky-300 bg-white px-2 py-1 dark:border-sky-800 dark:bg-zinc-900"
            />
          </label>
          <label className="flex items-center gap-1.5">
            ເລິກ (ຊມ.)
            <input
              type="number"
              value={layout.depth}
              onChange={(e) => {
                setLayout({ ...layout, depth: Math.max(100, Number(e.target.value) || 0) });
                setDirty(true);
              }}
              className="w-24 rounded border border-sky-300 bg-white px-2 py-1 dark:border-sky-800 dark:bg-zinc-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded-lg border border-sky-300 px-2.5 py-1 font-semibold hover:bg-sky-100 dark:border-sky-800 dark:hover:bg-sky-900/40"
          >
            ຈັດຜັງອັດຕະໂນມັດໃໝ່
          </button>
          {missing.length > 0 && (
            <button
              type="button"
              onClick={addMissing}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              ເພີ່ມບ່ອນເກັບທີ່ຂາດ ({missing.length})
            </button>
          )}
        </div>
      )}

      {saveMsg && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {saveMsg}
        </div>
      )}

      {!editing && missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠ ມີ {missing.length} ບ່ອນເກັບໃນຖານຂໍ້ມູນທີ່ຍັງບໍ່ມີເທິງຜັງ: {missing.slice(0, 8).map((m) => m.name ?? m.code).join(", ")}
          {missing.length > 8 && " …"}
        </div>
      )}

      {mode === "3d" ? (
        <div className="relative min-h-[320px] w-full flex-1 touch-none overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <WarehousePlan3D
            shapes={sorted}
            cells={cells}
            width={layout.width}
            depth={layout.depth}
            colorMode={colorMode}
            selectedLoc={selectedLoc}
            highlightLocs={highlightLocs}
            onSelectLoc={onSelectLoc}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <svg
            ref={svgRef}
            // ເຜື່ອຂອບໄວ້ນອກກຳແພງ ເພື່ອວາງປ້າຍຂະໜາດ (ຄືຮູບຜັງຕົ້ນສະບັບ)
            viewBox={`${-PAD} ${-PAD} ${layout.width + PAD * 2} ${layout.depth + PAD * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-auto w-full min-w-[720px] touch-none select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* ພື້ນສາງ — ພື້ນດຳ + ຕາຕະລາງ 5 ມ. ຄືຮູບຜັງທີ່ທີມສາງແຕ້ມ */}
            <defs>
              <pattern id="wms-grid-5m" width="500" height="500" patternUnits="userSpaceOnUse">
                <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#27272a" strokeWidth="4" />
              </pattern>
            </defs>
            {/* ກົດພື້ນຫວ່າງ = ຍົກເລີກການເລືອກ ກັບໄປເຫັນທັງສາງ */}
            <rect
              width={layout.width}
              height={layout.depth}
              fill="#000000"
              onClick={() => {
                if (!editing) onSelectLoc("", null);
              }}
            />
            <rect width={layout.width} height={layout.depth} fill="url(#wms-grid-5m)" />
            <rect
              width={layout.width}
              height={layout.depth}
              fill="none"
              stroke="#000000"
              strokeWidth="26"
            />

            {sorted.map((shape) => {
              const cell = cells.get(shape.code);
              const isZone = shape.kind === "zone";
              const selected = selectedLoc === shape.code;
              // ກົດບລ໋ອກໃດ → ອັນອື່ນຈາງລົງ ໃຫ້ເຫັນສະເພາະອັນທີ່ກົດ (ຄື 3D ແລະ 1201)
              const dimmed =
                selectedLoc != null && !editing
                  ? selectedLoc !== shape.code
                  : highlightLocs.size > 0 && !highlightLocs.has(shape.code);
              const label = shape.label ?? shape.code;
              // ບລ໋ອກແຄບແຕ່ຍາວ (ເຊັ່ນ RECEIVE & PACKING) ຂຽນປ້າຍຕັ້ງ ບໍ່ດັ່ງນັ້ນ
              // ຂໍ້ຄວາມຈະລົ້ນອອກນອກກອບ. ຂະໜາດຕົວອັກສອນຈຳກັດດ້ວຍດ້ານທີ່ຂຽນຕາມ.
              const vertical = shape.d > shape.w * 1.6;
              const along = vertical ? shape.d : shape.w;
              const across = vertical ? shape.w : shape.d;
              const cx = shape.x + shape.w / 2;
              const cy = shape.y + shape.d / 2;
              const labelSize = Math.max(
                55,
                Math.min(across / 2.4, (along * 1.5) / Math.max(3, label.length), 190),
              );
              return (
                <g key={shape.code} opacity={dimmed ? 0.22 : 1}>
                  <rect
                    x={shape.x}
                    y={shape.y}
                    width={shape.w}
                    height={shape.d}
                    rx={8}
                    fill={shapeFill(shape)}
                    fillOpacity={1}
                    stroke={selected ? "#0284c7" : "#000000"}
                    strokeWidth={selected ? 26 : 8}
                    className={editing ? "cursor-move" : isZone ? "" : "cursor-pointer"}
                    onPointerDown={(e) => handlePointerDown(e, shape, "move")}
                    onClick={() => {
                      if (editing || isZone) return;
                      onSelectLoc(cell?.rackCode ?? "", shape.code);
                    }}
                  >
                    <title>
                      {`${shape.label ?? shape.code} · ${formatMeters(shape.w)} × ${formatMeters(shape.d)}`}
                      {!isZone && cell
                        ? `\nສິນຄ້າ ${cell.itemCount} ລາຍການ · ${cell.qty.toLocaleString("en-US")} ໜ່ວຍ${
                            cell.pct != null ? ` · ເຕັມ ${Math.round(cell.pct)}%` : ""
                          }`
                        : ""}
                    </title>
                  </rect>

                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={labelSize}
                    fontWeight={800}
                    fill={labelColor(shapeFill(shape))}
                    transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
                    pointerEvents="none"
                  >
                    {label}
                  </text>
                  {!isZone && cell && cell.pct != null && !vertical && shape.d > 300 && (
                    <text
                      x={cx}
                      y={cy + labelSize}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={labelSize * 0.72}
                      fill={labelColor(shapeFill(shape))}
                      pointerEvents="none"
                    >
                      {Math.round(cell.pct)}%
                    </text>
                  )}

                  {editing && (
                    <rect
                      x={shape.x + shape.w - 90}
                      y={shape.y + shape.d - 90}
                      width={90}
                      height={90}
                      fill="#0284c7"
                      className="cursor-nwse-resize"
                      onPointerDown={(e) => handlePointerDown(e, shape, "resize")}
                    />
                  )}
                </g>
              );
            })}

            {/* ປ້າຍຂະໜາດອາຄານ — ແຖບຂາວ + ໂຕເລກແດງ ຄືຮູບຜັງຕົ້ນສະບັບ */}
            <g pointerEvents="none">
              {/* ດ້ານລຸ່ມ = ຄວາມກວ້າງ */}
              <rect x={0} y={layout.depth + 300} width={layout.width} height={30} fill="#3f3f46" />
              <text
                x={layout.width / 2}
                y={layout.depth + 500}
                textAnchor="middle"
                fontSize={190}
                fontWeight={800}
                fill="#dc2626"
              >
                {formatMeters(layout.width)}
              </text>
              {/* ດ້ານຊ້າຍ = ຄວາມເລິກ */}
              <rect x={-330} y={0} width={30} height={layout.depth} fill="#3f3f46" />
              <text
                x={-450}
                y={layout.depth / 2}
                textAnchor="middle"
                fontSize={190}
                fontWeight={800}
                fill="#dc2626"
                transform={`rotate(-90 -450 ${layout.depth / 2})`}
              >
                {formatMeters(layout.depth)}
              </text>
            </g>
          </svg>
        </div>
      )}

      {/* ຄຳອະທິບາຍສີ */}
      {colorMode === "heat" && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <span className="font-semibold uppercase tracking-wider text-zinc-400">ຄວາມແໜ້ນ:</span>
          {HEAT_LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-3 w-5 rounded" style={{ backgroundColor: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
