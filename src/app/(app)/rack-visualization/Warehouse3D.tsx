"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Object3D } from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Bounds,
  ContactShadows,
  Edges,
  Grid,
  Html,
  OrbitControls,
  useBounds,
} from "@react-three/drei";

type Registry = { current: Map<string, Object3D> };

// How high a selected rack floats above the rest.
const LIFT = 0.55;

// Drives the camera. Whenever the focus target changes we re-fit to that object
// (whole warehouse → rack → floor → location). Lives inside <Bounds>.
function CameraFocus({
  targetKey,
  registry,
}: {
  targetKey: string | null;
  registry: Registry;
}) {
  const api = useBounds();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const obj = targetKey ? registry.current.get(targetKey) : null;
      if (obj) api.refresh(obj).clip().fit();
      else api.refresh().clip().fit();
    });
    return () => cancelAnimationFrame(id);
  }, [targetKey, api, registry]);
  return null;
}

export type Rack3DCell = {
  code: string;
  pct: number;
  empty: boolean;
  negative: boolean;
};

export type Rack3DFloor = {
  floor: number;
  cells: Rack3DCell[];
};

export type Rack3DDatum = {
  id: number;
  code: string;
  name: string | null;
  isBanner: boolean;
  groupLabel: string | null;
  aisleAfter?: boolean;
  floors: Rack3DFloor[];
  occupiedLocations: number;
  totalLocations: number;
  qty: number;
};

export type Warehouse3DDoor = { label: string; atRackCode: string };

const SLOT_W = 1.06;
const SLOT_H = 0.72;
// Real spacing between location towers along a rack's length. Kept generous so
// the field reads as separated towers instead of a dense wall — and so we never
// have to distort the scene by stretching the z axis.
const SLOT_D = 0.98;
const RACK_PITCH_X = 1.72;
const GROUP_GAP = 1.6;
const AISLE_GAP = 1.15;

function heatColor(pct: number, empty: boolean, negative: boolean) {
  if (negative) return "#ef4444";
  if (empty) return "#e2e8f0";
  if (pct > 100) return "#e11d48";
  if (pct >= 90) return "#f43f5e";
  if (pct >= 75) return "#f97316";
  if (pct >= 50) return "#f59e0b";
  if (pct >= 25) return "#22c55e";
  if (pct > 0) return "#14b8a6";
  return "#34d399"; // occupied, unknown volume
}

function shortCode(code: string) {
  return code.split("-").pop() ?? code;
}

function RackTowers({
  rack,
  x,
  selected,
  rackDimmed,
  focusFloor,
  selectedLoc,
  registry,
  onSelectRack,
  onSelectCell,
}: {
  rack: Rack3DDatum;
  x: number;
  selected: boolean;
  rackDimmed: boolean;
  focusFloor: number | null;
  selectedLoc: string | null;
  registry: Registry;
  onSelectRack: (code: string) => void;
  onSelectCell: (rackCode: string, locCode: string, floor: number) => void;
}) {
  const groupRef = useRef<Group>(null);
  const [hover, setHover] = useState<{ key: string; tip: string } | null>(null);

  const maxFloor = rack.floors.reduce((m, f) => Math.max(m, f.floor), 1);
  const maxCells = rack.floors.reduce((m, f) => Math.max(m, f.cells.length), 1);
  const towerH = maxFloor * SLOT_H;
  const lengthLen = maxCells * SLOT_D;
  const label = rack.name || rack.code;

  useEffect(() => {
    if (groupRef.current) registry.current.set(`rack:${rack.code}`, groupRef.current);
  }, [rack.code, registry]);

  // Smoothly lift / settle the selected rack so it stands out above the rest.
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const targetY = selected ? LIFT : 0;
    g.position.y += (targetY - g.position.y) * 0.14;
  });

  // When another rack is in focus, collapse this one to a faint flat footprint
  // so it never blocks the view of the selected rack. Still clickable to switch.
  if (rackDimmed) {
    return (
      <group ref={groupRef} position={[x, 0, 0]}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onSelectRack(rack.code);
          }}
          onPointerOver={() => (document.body.style.cursor = "pointer")}
          onPointerOut={() => (document.body.style.cursor = "auto")}
        >
          <boxGeometry args={[SLOT_W * 0.92, 0.06, lengthLen + 0.12]} />
          <meshBasicMaterial color="#dbe1ea" transparent opacity={0.45} depthWrite={false} />
        </mesh>
        <Html position={[0, 0.32, 0]} center distanceFactor={13}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRack(rack.code);
            }}
            className="pointer-events-auto cursor-pointer select-none whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[8px] font-bold text-slate-400 transition hover:text-sky-600"
          >
            {label}
          </button>
        </Html>
      </group>
    );
  }

  return (
    <group ref={groupRef} position={[x, 0, 0]}>
      {/* Base pad — clicking it selects the whole rack. Bold so each rack reads
          as a seated, distinct unit. */}
      <mesh
        position={[0, -0.04, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectRack(rack.code);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <boxGeometry args={[SLOT_W * 0.96, 0.1, lengthLen + 0.18]} />
        <meshStandardMaterial
          color={selected ? "#0ea5e9" : rackDimmed ? "#dbe1ea" : "#64748b"}
          roughness={0.8}
          metalness={0.1}
          transparent={rackDimmed}
          opacity={rackDimmed ? 0.45 : 1}
          emissive={selected ? "#0ea5e9" : "#000000"}
          emissiveIntensity={selected ? 0.3 : 0}
        />
      </mesh>

      {/* Back + side panels: give the rack a body so it looks like a shelf bay,
          not a loose field of bars. */}
      <mesh position={[0, towerH / 2, -lengthLen / 2 - 0.04]} raycast={() => null}>
        <boxGeometry args={[SLOT_W * 0.94, towerH, 0.04]} />
        <meshStandardMaterial
          color={selected ? "#bae6fd" : "#aab6c6"}
          roughness={0.85}
          transparent
          opacity={rackDimmed ? 0.12 : 0.5}
        />
      </mesh>

      {/* Rack cage outline — always visible so the rack boundary is obvious. */}
      <mesh position={[0, towerH / 2, 0]} raycast={() => null}>
        <boxGeometry args={[SLOT_W * 0.96, towerH + 0.04, lengthLen + 0.12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges
          threshold={15}
          color={selected ? "#0284c7" : rackDimmed ? "#cbd5e1" : "#475569"}
        />
      </mesh>

      {/* Vertical corner posts to reinforce the rack silhouette. */}
      {[
        [-SLOT_W * 0.48, -lengthLen / 2 - 0.06],
        [SLOT_W * 0.48, -lengthLen / 2 - 0.06],
        [-SLOT_W * 0.48, lengthLen / 2 + 0.06],
        [SLOT_W * 0.48, lengthLen / 2 + 0.06],
      ].map(([px, pz], i) => (
        <mesh key={`post-${i}`} position={[px, towerH / 2, pz]} raycast={() => null}>
          <boxGeometry args={[0.05, towerH + 0.08, 0.05]} />
          <meshStandardMaterial
            color={selected ? "#0284c7" : "#334155"}
            roughness={0.5}
            metalness={0.4}
            transparent={rackDimmed}
            opacity={rackDimmed ? 0.25 : 1}
          />
        </mesh>
      ))}

      {/* ຂັ້ນຫ້ອງ — vertical partitions between each location cell. */}
      {Array.from({ length: maxCells + 1 }, (_, i) => -lengthLen / 2 + i * SLOT_D).map(
        (offset, i) => {
          if (i === 0 || i === maxCells) return null;
          return (
            <group key={`divider-${i}`}>
              <mesh position={[-SLOT_W * 0.48, towerH / 2, offset]} raycast={() => null}>
                <boxGeometry args={[0.04, towerH + 0.06, 0.04]} />
                <meshStandardMaterial
                  color="#475569"
                  roughness={0.6}
                  metalness={0.3}
                  transparent={rackDimmed}
                  opacity={rackDimmed ? 0.2 : 0.9}
                />
              </mesh>
              <mesh position={[SLOT_W * 0.48, towerH / 2, offset]} raycast={() => null}>
                <boxGeometry args={[0.04, towerH + 0.06, 0.04]} />
                <meshStandardMaterial
                  color="#475569"
                  roughness={0.6}
                  metalness={0.3}
                  transparent={rackDimmed}
                  opacity={rackDimmed ? 0.2 : 0.9}
                />
              </mesh>
              {/* thin wall pane so the room boundary is obvious */}
              <mesh position={[0, towerH / 2, offset]} raycast={() => null}>
                <boxGeometry args={[SLOT_W * 0.9, towerH, 0.012]} />
                <meshStandardMaterial
                  color="#94a3b8"
                  transparent
                  opacity={rackDimmed ? 0.05 : 0.14}
                  roughness={0.95}
                />
              </mesh>
            </group>
          );
        },
      )}

      {rack.floors.map((floor) => {
        const floorBaseY = (floor.floor - 1) * SLOT_H;
        const floorDimmed = focusFloor != null && floor.floor !== focusFloor;
        return (
          <group
            key={floor.floor}
            ref={(o) => {
              if (o) registry.current.set(`floor:${rack.code}:${floor.floor}`, o);
            }}
          >
            {/* ຊັ້ນ — shelf deck plate that the towers sit on. */}
            <mesh position={[0, floorBaseY + 0.015, 0]} receiveShadow>
              <boxGeometry args={[SLOT_W * 0.9, 0.03, lengthLen]} />
              <meshStandardMaterial
                color="#cbd5e1"
                transparent
                opacity={floorDimmed || rackDimmed ? 0.12 : 0.55}
                roughness={0.85}
                metalness={0.1}
              />
            </mesh>
            {/* front + back shelf beams (industrial orange) mark each level. */}
            {[lengthLen / 2, -lengthLen / 2].map((bz, bi) => (
              <mesh key={`beam-${bi}`} position={[0, floorBaseY + 0.02, bz]} raycast={() => null}>
                <boxGeometry args={[SLOT_W * 0.92, 0.055, 0.045]} />
                <meshStandardMaterial
                  color={floorDimmed && !rackDimmed ? "#94a3b8" : "#f97316"}
                  roughness={0.5}
                  metalness={0.3}
                  transparent={floorDimmed || rackDimmed}
                  opacity={floorDimmed || rackDimmed ? 0.25 : 1}
                />
              </mesh>
            ))}

            {floor.cells.map((cell, p) => {
              const off = -lengthLen / 2 + SLOT_D * (p + 0.5);
              const isSel = selectedLoc === cell.code;
              const locDimmed = selectedLoc != null && !isSel;
              const dimmed = rackDimmed || floorDimmed || locDimmed;
              const active = isSel || hover?.key === `${floor.floor}-${p}`;

              const fill = cell.empty
                ? 0
                : Math.max(0.18, Math.min(1, cell.pct > 0 ? cell.pct / 100 : 0.5));
              // Tower height encodes fill %: tall = full, flat tile = empty.
              const barH = cell.empty ? 0.05 : Math.max(0.08, SLOT_H * 0.86 * fill);
              const barY = floorBaseY + 0.03 + barH / 2;
              const foot = cell.empty ? SLOT_D * 0.6 : SLOT_D * 0.66;
              const color = heatColor(cell.pct, cell.empty, cell.negative);
              const key = `${floor.floor}-${p}`;

              return (
                <group
                  key={key}
                  ref={(o) => {
                    if (o) registry.current.set(`loc:${cell.code}`, o);
                  }}
                >
                  <mesh
                    position={[0, barY, off]}
                    castShadow
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      setHover({
                        key,
                        tip: `${label} · F${floor.floor} · ${shortCode(cell.code)}\n${
                          cell.negative
                            ? "ຕິດລົບ"
                            : cell.empty
                              ? "ຫວ່າງ"
                              : cell.pct > 0
                                ? `${Math.round(cell.pct)}%`
                                : "ມີສິນຄ້າ"
                        }`,
                      });
                      document.body.style.cursor = "pointer";
                    }}
                    onPointerOut={() => {
                      setHover((h) => (h?.key === key ? null : h));
                      document.body.style.cursor = "auto";
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCell(rack.code, cell.code, floor.floor);
                    }}
                  >
                    <boxGeometry args={[SLOT_W * 0.66, barH, foot]} />
                    <meshStandardMaterial
                      color={isSel ? "#0284c7" : dimmed ? "#cbd5e1" : color}
                      transparent={dimmed}
                      opacity={dimmed ? 0.25 : 1}
                      emissive={isSel ? "#0ea5e9" : dimmed ? "#000000" : color}
                      emissiveIntensity={active && !dimmed ? 0.55 : dimmed ? 0 : 0.28}
                      roughness={0.4}
                      metalness={0.05}
                    />
                    {active && !dimmed && <Edges threshold={15} color={isSel ? "#0ea5e9" : "#1e293b"} />}
                  </mesh>

                  {/* Cell label (ປ້າຍຫ້ອງ): persistent + clickable on the focused
                      rack; hover-only in the overview to avoid 600 DOM labels. */}
                  {((selected && !floorDimmed) || (active && !dimmed)) && (
                    <Html
                      position={[0, barY + barH / 2 + 0.13, off]}
                      center
                      distanceFactor={selected ? 10 : 9}
                      zIndexRange={[30, 0]}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCell(rack.code, cell.code, floor.floor);
                        }}
                        className={`pointer-events-auto cursor-pointer select-none whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shadow-lg transition ${
                          isSel
                            ? "bg-sky-600 text-white ring-1 ring-sky-300"
                            : "bg-slate-950/85 text-white hover:bg-sky-600"
                        }`}
                      >
                        {shortCode(cell.code)}
                      </button>
                    </Html>
                  )}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* Rack name — clickable to focus this rack. */}
      <Html position={[0, towerH + 0.34, 0]} center distanceFactor={11}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRack(rack.code);
          }}
          className={`pointer-events-auto cursor-pointer select-none whitespace-nowrap rounded-lg px-2 py-1 font-mono text-[10px] font-bold shadow-lg ring-1 backdrop-blur transition ${
            selected
              ? "bg-sky-600 text-white ring-sky-400"
              : rackDimmed
                ? "bg-white/60 text-slate-400 ring-slate-200 hover:bg-white/90 hover:text-slate-700"
                : "bg-white/95 text-slate-700 ring-slate-200 hover:bg-sky-50 hover:text-sky-700"
          }`}
        >
          {label}
          <span className="ml-1.5 font-sans text-[8px] font-semibold opacity-65">
            {rack.occupiedLocations}/{rack.totalLocations}
          </span>
        </button>
      </Html>

      {hover && (
        <Html position={[0, towerH + 0.9, 0]} center distanceFactor={12} pointerEvents="none">
          <div className="whitespace-pre rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 text-[11px] leading-snug text-white shadow-2xl backdrop-blur">
            {hover.tip}
          </div>
        </Html>
      )}
    </group>
  );
}

export default function Warehouse3D({
  racks,
  side,
  zoneLabel,
  doors,
  selectedCode,
  selectedLoc,
  onSelectRack,
  onSelectCell,
}: {
  racks: Rack3DDatum[];
  side: Rack3DDatum | null;
  zoneLabel?: string;
  doors?: Warehouse3DDoor[];
  selectedCode: string | null;
  selectedLoc: string | null;
  onSelectRack: (code: string | null) => void;
  onSelectCell: (rackCode: string, locCode: string) => void;
}) {
  const registry = useRef<Map<string, Object3D>>(new Map());
  const [focusFloor, setFocusFloor] = useState<number | null>(null);

  useEffect(() => {
    setFocusFloor(null);
  }, [selectedCode]);

  const allRackData = useMemo(() => (side ? [...racks, side] : racks), [racks, side]);
  const focusRack = selectedCode
    ? allRackData.find((r) => r.code === selectedCode) ?? null
    : null;
  const focusFloors = focusRack
    ? focusRack.floors.map((f) => f.floor).sort((a, b) => a - b)
    : [];

  // Clicking a location should NOT zoom into the tiny cell — keep the camera at
  // the floor level (or rack) and let the popup show the detail.
  const targetKey =
    selectedCode && focusFloor != null
      ? `floor:${selectedCode}:${focusFloor}`
      : selectedCode
        ? `rack:${selectedCode}`
        : null;

  const pickRack = (code: string) => {
    onSelectRack(code);
    setFocusFloor(null);
  };
  const pickCell = (rackCode: string, locCode: string, floor: number) => {
    onSelectCell(rackCode, locCode);
    setFocusFloor(floor);
  };
  const goAll = () => {
    onSelectRack(null);
    setFocusFloor(null);
  };
  const goRack = () => {
    if (selectedCode) onSelectRack(selectedCode);
    setFocusFloor(null);
  };
  const goFloor = (f: number) => {
    if (selectedCode) onSelectRack(selectedCode);
    setFocusFloor((prev) => (prev === f ? null : f));
  };
  const goFloorCrumb = () => {
    if (selectedCode) onSelectRack(selectedCode);
  };

  const layout = useMemo(() => {
    let x = 0;
    const placedCols = racks.map((rack) => {
      const px = x;
      x += RACK_PITCH_X;
      if (rack.aisleAfter) x += AISLE_GAP;
      return { rack, x: px };
    });
    const minX = placedCols.length ? placedCols[0].x : 0;
    const maxX = placedCols.length ? placedCols[placedCols.length - 1].x : 0;
    const mid = (minX + maxX) / 2;
    const cols = placedCols.map((c) => ({ rack: c.rack, x: c.x - mid }));

    const groupMap = new Map<string, number[]>();
    for (const c of cols) {
      if (!c.rack.groupLabel) continue;
      const arr = groupMap.get(c.rack.groupLabel) ?? [];
      arr.push(c.x);
      groupMap.set(c.rack.groupLabel, arr);
    }
    const groupLabels = Array.from(groupMap.entries()).map(([label, xs]) => ({
      label,
      x: xs.reduce((s, v) => s + v, 0) / xs.length,
    }));

    const maxFloor = racks.reduce(
      (m, r) => Math.max(m, r.floors.reduce((mm, f) => Math.max(mm, f.floor), 1)),
      1,
    );
    const allRacks = side ? [...racks, side] : racks;
    const maxCells = allRacks.reduce(
      (m, r) => Math.max(m, r.floors.reduce((mm, f) => Math.max(mm, f.cells.length), 1)),
      1,
    );
    const warehouseDepth = Math.max(6.5, maxCells * SLOT_D);
    const sideX = maxX - mid + RACK_PITCH_X + GROUP_GAP;

    const doorMarks = (doors ?? [])
      .map((d) => {
        const col = cols.find((c) => c.rack.code === d.atRackCode);
        return col ? { label: d.label, x: col.x } : null;
      })
      .filter((d): d is { label: string; x: number } => d !== null);

    return {
      cols,
      groupLabels,
      doorMarks,
      maxFloor,
      depth: warehouseDepth,
      span: maxX - minX + (side ? sideX + 2 : 2),
      leftX: minX - mid,
      sideX,
    };
  }, [racks, side, doors]);

  const towerH = layout.maxFloor * SLOT_H;
  // No z-stretch — towers keep their true cubic shape (real SLOT_D spacing).
  const scaledDepth = layout.depth;
  const frontZ = scaledDepth / 2;
  const backZ = -frontZ;
  const R = Math.max(layout.span, scaledDepth) + 3;
  const floorW = Math.max(layout.span + 5, 12);
  const floorD = Math.max(scaledDepth + 5, 9);
  const selecting = selectedCode != null;

  const crumb = (activeCrumb: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-bold transition ${
      activeCrumb
        ? "bg-sky-600 text-white shadow"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
    }`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-slate-100 via-slate-50 to-white dark:from-slate-950 dark:via-slate-950 dark:to-zinc-950">
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-xl border border-white/80 bg-white/85 px-3 py-2 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/80">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">
          Heatmap towers
        </div>
        <div className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
          {racks.length + (side ? 1 : 0)} racks · {layout.maxFloor} levels
        </div>
      </div>

      {/* Drill-down navigator: ທັງໝົດ › RACK › ຊັ້ນ › Location */}
      <div className="absolute left-1/2 top-4 z-20 flex max-w-[92%] -translate-x-1/2 flex-col items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-full border border-white/80 bg-white/90 px-1.5 py-1 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/85">
          <button type="button" onClick={goAll} className={crumb(!selectedCode)}>
            ທັງໝົດ
          </button>
          {focusRack && (
            <>
              <span className="text-slate-300">›</span>
              <button
                type="button"
                onClick={goRack}
                className={crumb(!selectedLoc && focusFloor == null)}
              >
                {focusRack.name || focusRack.code}
              </button>
            </>
          )}
          {focusRack && focusFloor != null && (
            <>
              <span className="text-slate-300">›</span>
              <button type="button" onClick={goFloorCrumb} className={crumb(!selectedLoc)}>
                ຊັ້ນ {focusFloor}
              </button>
            </>
          )}
          {selectedLoc && (
            <>
              <span className="text-slate-300">›</span>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white dark:bg-white dark:text-slate-900">
                {shortCode(selectedLoc)}
              </span>
            </>
          )}
        </div>

        {focusRack && focusFloors.length > 0 && (
          <div className="flex items-center gap-1 rounded-full border border-white/80 bg-white/90 px-2 py-1 shadow-md backdrop-blur dark:border-white/10 dark:bg-slate-900/85">
            <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              ຊັ້ນ
            </span>
            {focusFloors.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => goFloor(f)}
                className={`h-6 min-w-6 rounded-full px-1.5 text-[11px] font-bold transition ${
                  focusFloor === f
                    ? "bg-emerald-500 text-white shadow"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 z-10 hidden rounded-xl border border-white/80 bg-white/85 px-3 py-2 text-[10px] text-slate-500 shadow-lg backdrop-blur sm:block dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-400">
        ສູງ = ເຕັມ · ສີຮ້ອນ = ໃກ້ເຕັມ · ເລືອກ rack ແລ້ວ ໝຸນ 360° ໄດ້
      </div>

      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{
          // Low, near-frontal angle so racks read as shelf fronts on open
          // (Bounds fits the distance; this sets the viewing direction).
          // Negative X so RACK A (left end of the world) reads on the LEFT.
          position: [-R * 0.26, towerH + R * 0.12, R * 0.95],
          fov: 38,
          near: 0.1,
          far: 320,
        }}
        onPointerMissed={() => goAll()}
      >
        <fog attach="fog" args={["#eef2f7", R * 2.6, R * 7]} />
        <ambientLight intensity={0.7} />
        <hemisphereLight args={["#ffffff", "#cbd5e1", 1.1]} />
        <directionalLight
          position={[layout.span * 0.6, towerH + 10, layout.span * 0.6]}
          intensity={1.6}
          color="#ffffff"
        />
        <directionalLight
          position={[-layout.span, towerH + 6, -layout.span]}
          intensity={0.5}
          color="#bfdbfe"
        />

        {/* Clean grid floor — the heatmap stage. */}
        <Grid
          position={[0, 0, 0]}
          args={[floorW, floorD]}
          cellSize={SLOT_D}
          cellThickness={0.6}
          cellColor="#cbd5e1"
          sectionSize={SLOT_D * 4}
          sectionThickness={1.1}
          sectionColor="#94a3b8"
          fadeDistance={R * 3.2}
          fadeStrength={1.5}
          followCamera={false}
          infiniteGrid
        />

        {zoneLabel && (
          <Html position={[0, towerH + 1.5, frontZ]} center distanceFactor={13} pointerEvents="none">
            <div className="select-none whitespace-nowrap rounded-md bg-zinc-800 px-2 py-0.5 text-[12px] font-bold tracking-wider text-white shadow">
              {zoneLabel}
            </div>
          </Html>
        )}

        {layout.doorMarks.map((d, i) => (
          <Html
            key={`${d.label}-${i}`}
            position={[d.x, towerH + 2.1, backZ - 0.6]}
            center
            distanceFactor={13}
            pointerEvents="none"
          >
            <div className="flex select-none flex-col items-center">
              <div className="whitespace-nowrap rounded-md bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                🚪 {d.label}
              </div>
              <div className="h-3 w-px bg-sky-500/60" />
            </div>
          </Html>
        ))}

        {layout.groupLabels.map((g) => (
          <Html key={g.label} position={[g.x, towerH + 0.95, backZ]} center distanceFactor={12} pointerEvents="none">
            <div className="select-none whitespace-nowrap rounded bg-zinc-100/90 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200">
              {g.label}
            </div>
          </Html>
        ))}

        {/* Zone tag for the side block (e.g. Z03) — its rack keeps its real name. */}
        {side?.groupLabel && (
          <Html position={[layout.sideX, towerH + 0.95, backZ]} center distanceFactor={12} pointerEvents="none">
            <div className="select-none whitespace-nowrap rounded bg-zinc-100/90 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200">
              {side.groupLabel}
            </div>
          </Html>
        )}

        {Array.from({ length: layout.maxFloor }, (_, i) => i + 1).map((f) => (
          <Html
            key={f}
            position={[layout.leftX - RACK_PITCH_X * 0.7, (f - 0.5) * SLOT_H, frontZ]}
            center
            distanceFactor={12}
            pointerEvents="none"
          >
            <div
              className={`select-none whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-bold ${
                focusFloor === f ? "bg-emerald-500 text-white" : "bg-zinc-100/90 text-zinc-500"
              }`}
            >
              F{f}
            </div>
          </Html>
        ))}

        <Bounds fit clip margin={0.82} maxDuration={0.85}>
          <CameraFocus targetKey={targetKey} registry={registry} />
          <group>
            {layout.cols.map(({ rack, x }) => (
              <RackTowers
                key={rack.id}
                rack={rack}
                x={x}
                selected={rack.code === selectedCode}
                rackDimmed={selecting && rack.code !== selectedCode}
                focusFloor={rack.code === selectedCode ? focusFloor : null}
                selectedLoc={selectedLoc}
                registry={registry}
                onSelectRack={pickRack}
                onSelectCell={pickCell}
              />
            ))}

            {side && (
              <RackTowers
                rack={side}
                x={layout.sideX}
                selected={side.code === selectedCode}
                rackDimmed={selecting && side.code !== selectedCode}
                focusFloor={side.code === selectedCode ? focusFloor : null}
                selectedLoc={selectedLoc}
                registry={registry}
                onSelectRack={pickRack}
                onSelectCell={pickCell}
              />
            )}
          </group>
        </Bounds>

        <ContactShadows
          position={[0, 0.005, 0]}
          opacity={0.32}
          scale={Math.max(floorW, floorD)}
          blur={2.8}
          far={towerH + 4}
          resolution={512}
          frames={1}
          color="#1e293b"
        />

        <OrbitControls
          makeDefault
          enablePan
          enableZoom
          enableDamping
          dampingFactor={0.075}
          rotateSpeed={0.6}
          zoomSpeed={1}
          panSpeed={0.65}
          zoomToCursor
          minDistance={1.5}
          maxDistance={R * 4 + 14}
          // A selected rack floats free, so let the camera orbit fully around it.
          minPolarAngle={selecting ? 0.08 : Math.PI / 8}
          maxPolarAngle={selecting ? Math.PI * 0.88 : Math.PI / 2.08}
          target={[0, towerH / 2, 0]}
        />
      </Canvas>
    </div>
  );
}
