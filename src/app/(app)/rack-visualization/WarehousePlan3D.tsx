"use client";

import { useEffect, useMemo, useRef } from "react";
import { Box3 } from "three";
import type { Object3D } from "three";
import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Edges, Grid, Html, OrbitControls, useBounds } from "@react-three/drei";
import { cmToM, heatColor, type LayoutShape, type PlanCell } from "@/lib/warehouseLayout";

/**
 * 3D ຂອງຜັງພື້ນທີ່ຈິງ — ຕ່າງຈາກ Warehouse3D.tsx ທີ່ແຕ້ມ "ຫໍຊັ້ນວາງ" ຕາມລຳດັບ
 * rack. ອັນນີ້ຍົກສີ່ຫຼ່ຽມຈາກຜັງຈິງ (x/y/w/d ຈາກ odg_wms_layout_shape) ຂຶ້ນເປັນ
 * ກ້ອນຕາມຄວາມສູງຂອງບ່ອນເກັບ ຈຶ່ງເໝາະກັບສາງແບບ **ວາງພື້ນ/ຊ້ອນກອງ** (ເຊັ່ນ 1404
 * ທີ່ floor ເປັນ NULL ໝົດ) ບໍ່ແມ່ນສາງຊັ້ນວາງຫຼາຍຊັ້ນ.
 *
 * ແກນ: x ຂອງຜັງ → x ຂອງ 3D, y ຂອງຜັງ (ລົງລຸ່ມ) → z ຂອງ 3D, ຄວາມສູງ → y.
 * ຈຸດ 0 ຂອງສາກຢູ່ກາງອາຄານ ເພື່ອໃຫ້ OrbitControls ໝຸນອ້ອມກາງສາງ.
 */

const MIN_BLOCK_H = 0.05;

type Registry = { current: Map<string, Object3D> };

/**
 * ກ້ອງ — ກົດບລ໋ອກໃດ ກ້ອງຊູມເຂົ້າຫາບລ໋ອກນັ້ນ, ຍົກເລີກແລ້ວຖອຍອອກເຫັນທັງສາງ.
 * ກົນໄກດຽວກັນກັບ 3D ຂອງສາງ 1201 (CameraFocus ໃນ Warehouse3D.tsx) — ຢູ່ໃນ <Bounds>.
 */
function CameraFocus({
  targetCode,
  highlightLocs,
  registry,
}: {
  targetCode: string | null;
  highlightLocs: Set<string>;
  registry: Registry;
}) {
  const api = useBounds();
  const highlightKey = useMemo(() => [...highlightLocs].sort().join(","), [highlightLocs]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      // 1) ບລ໋ອກທີ່ຖືກເລືອກ ມາກ່ອນສະເໝີ
      const obj = targetCode ? registry.current.get(targetCode) : null;
      if (obj) {
        api.refresh(obj).clip().fit();
        return;
      }
      // 2) ຄົ້ນຫາສິນຄ້າແລ້ວ → ຈັບກອບທຸກບ່ອນທີ່ມີສິນຄ້ານັ້ນ
      if (highlightLocs.size > 0) {
        const box = new Box3();
        let any = false;
        for (const code of highlightLocs) {
          const o = registry.current.get(code);
          if (o) {
            box.expandByObject(o);
            any = true;
          }
        }
        if (any) {
          api.refresh(box).clip().fit();
          return;
        }
      }
      // 3) ບໍ່ໄດ້ເລືອກຫຍັງ → ເຫັນທັງສາງ
      api.refresh().clip().fit();
    });
    return () => cancelAnimationFrame(id);
  }, [targetCode, highlightKey, highlightLocs, api, registry]);
  return null;
}

function Block({
  shape,
  cell,
  width,
  depth,
  colorMode,
  selected,
  dimmed,
  registry,
  onSelect,
}: {
  shape: LayoutShape;
  cell: PlanCell | undefined;
  width: number;
  depth: number;
  colorMode: "heat" | "rack";
  selected: boolean;
  dimmed: boolean;
  registry: Registry;
  onSelect: () => void;
}) {
  const groupRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (groupRef.current) registry.current.set(shape.code, groupRef.current);
  }, [shape.code, registry]);

  const w = cmToM(shape.w);
  const d = cmToM(shape.d);
  const cx = cmToM(shape.x) + w / 2 - cmToM(width) / 2;
  const cz = cmToM(shape.y) + d / 2 - cmToM(depth) / 2;

  const isZone = shape.kind === "zone";
  const capH = Math.max(cmToM(shape.h ?? 0), isZone ? MIN_BLOCK_H : 1);

  const pct = cell?.pct ?? null;
  const hasStock = (cell?.qty ?? 0) !== 0;
  const color =
    isZone || colorMode === "rack"
      ? (shape.color ?? "#cbd5e1")
      : heatColor({ pct, empty: !hasStock, negative: cell?.negative ?? false });

  // ສ່ວນທີ່ມີເຄື່ອງແທ້ = ຄວາມສູງ × %ເຕັມ. ບໍ່ຮູ້ % (ຂາດຂະໜາດສິນຄ້າ) ແຕ່ມີເຄື່ອງ
  // → ຍົກເຄິ່ງໜຶ່ງໄວ້ ເພື່ອບໍ່ໃຫ້ເບິ່ງຄືວ່າຫວ່າງ.
  const fillRatio = isZone ? 0 : pct != null ? Math.min(1, Math.max(0, pct / 100)) : hasStock ? 0.5 : 0;
  const fillH = fillRatio > 0 ? Math.max(capH * fillRatio, 0.08) : 0;

  return (
    // ບລ໋ອກທີ່ຖືກເລືອກ ລອຍຂຶ້ນເລັກນ້ອຍ ໃຫ້ແຍກອອກຈາກບລ໋ອກອື່ນ (ຄື LIFT ຂອງ 1201)
    <group ref={groupRef} position={[cx, selected ? 0.6 : 0, cz]}>
      {/* ກ້ອນຫຼັກ — ຍົກສີ່ຫຼ່ຽມຈາກຜັງ 2D ຂຶ້ນເປັນກ້ອນທຶບ ສີດຽວກັນກັບຜັງ */}
      <mesh
        position={[0, capH / 2, 0]}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <boxGeometry args={[w, capH, d]} />
        <meshStandardMaterial
          // ຈາງ = ປ່ຽນເປັນເທົາອ່ອນ + ໂປ່ງໃສ ຄືວິທີຂອງ 1201 ບໍ່ແມ່ນພຽງລົດ opacity
          color={dimmed ? "#cbd5e1" : color}
          roughness={0.7}
          metalness={0.05}
          transparent={dimmed}
          opacity={dimmed ? 0.25 : 1}
          emissive={selected ? "#0ea5e9" : "#000000"}
          emissiveIntensity={selected ? 0.5 : 0}
        />
        <Edges
          scale={1}
          threshold={15}
          color={selected ? "#0ea5e9" : dimmed ? "#cbd5e1" : "#111827"}
        />
      </mesh>

      {/* ແຖບລະດັບເຄື່ອງ — ໂໝດ heat ບອກ %ເຕັມ ດ້ວຍປອກສີອ້ອມກ້ອນ */}
      {colorMode === "heat" && fillH > 0 && fillH < capH && (
        <mesh position={[0, fillH, 0]} raycast={() => null}>
          <boxGeometry args={[w * 1.02, 0.06, d * 1.02]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      )}

      {/* ບລ໋ອກທີ່ຈາງ ບໍ່ຕ້ອງສະແດງປ້າຍ ບໍ່ດັ່ງນັ້ນປ້າຍຈະບັງອັນທີ່ກົດ */}
      {!dimmed && (
        <Html position={[0, capH + 0.35, 0]} center distanceFactor={26} pointerEvents="none">
          {/* ຮູບແບບປ້າຍ: ຂະໜາດ/ສີ/ພື້ນຫຼັງ ດຽວກັນທຸກກ້ອນ ແລະ ຄືກັນກັບປ້າຍໃນຜັງ 2D
              (ຕົວອັກສອນເຂັ້ມ ພື້ນຂາວ) — ອັນທີ່ເລືອກເນັ້ນດ້ວຍຂອບຟ້າ ບໍ່ແມ່ນປ່ຽນສີຕົວ. */}
          <div
            className={`whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-bold text-slate-900 shadow-sm ${
              selected ? "ring-2 ring-sky-500" : ""
            }`}
          >
            {shape.label ?? shape.code}
            {!isZone && pct != null && <span className="ml-1 font-mono">{Math.round(pct)}%</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

export default function WarehousePlan3D({
  shapes,
  cells,
  width,
  depth,
  colorMode,
  selectedLoc,
  highlightLocs,
  onSelectLoc,
}: {
  shapes: LayoutShape[];
  cells: Map<string, PlanCell>;
  width: number;
  depth: number;
  colorMode: "heat" | "rack";
  selectedLoc: string | null;
  highlightLocs: Set<string>;
  onSelectLoc: (rackCode: string, locationCode: string | null) => void;
}) {
  const w = cmToM(width);
  const d = cmToM(depth);
  const span = Math.max(w, d);
  const registry = useRef<Map<string, Object3D>>(new Map());

  const sorted = useMemo(() => [...shapes].sort((a, b) => a.sort - b.sort), [shapes]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      // ມູມສູງພໍທີ່ຈະເຫັນຄົບ 4 ແຖວ ບໍ່ໃຫ້ແຖວໜ້າບັງແຖວຫຼັງ (ກ້ອນສູງ 5–6 ມ).
      camera={{ position: [0, span * 0.62, span * 0.42], fov: 45, far: span * 8 }}
      // ກົດບ່ອນຫວ່າງ (ບໍ່ຖືກກ້ອນໃດ) = ຍົກເລີກການເລືອກ ຖອຍອອກເຫັນທັງສາງ
      onPointerMissed={() => onSelectLoc("", null)}
    >
      {/* ແສງ ແລະ ໂທນສີ — ຊຸດດຽວກັນກັບ 3D ຂອງ 1201 (ພື້ນອ່ອນ ບໍ່ໃຊ້ພື້ນດຳ) */}
      <color attach="background" args={["#eef2f7"]} />
      <hemisphereLight args={["#ffffff", "#cbd5e1", 1.1]} />
      <directionalLight position={[span * 0.4, span * 0.8, span * 0.3]} intensity={1.1} castShadow />
      <directionalLight position={[-span * 0.5, span * 0.5, -span * 0.4]} intensity={0.35} color="#bfdbfe" />

      {/* ພື້ນອາຄານ */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
      </mesh>
      <Grid
        args={[w, d]}
        position={[0, 0.006, 0]}
        cellSize={5}
        cellColor="#cbd5e1"
        sectionSize={10}
        sectionColor="#94a3b8"
        fadeDistance={span * 4}
        infiniteGrid={false}
      />

      {/* ຂອບອາຄານ — ເສັ້ນເທົາອ່ອນ ບໍ່ແມ່ນກຳແພງດຳ */}
      {(
        [
          [0, -d / 2, w, 0.2],
          [0, d / 2, w, 0.2],
          [-w / 2, 0, 0.2, d],
          [w / 2, 0, 0.2, d],
        ] as const
      ).map(([wx, wz, ww, wd], i) => (
        <mesh key={`wall-${i}`} position={[wx, 0.15, wz]} raycast={() => null}>
          <boxGeometry args={[ww, 0.3, wd]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
      ))}

      {/* ກົດບລ໋ອກ → ຊູມເຂົ້າ, ກົດພື້ນຫວ່າງ → ຖອຍອອກເຫັນທັງສາງ (ຄື 1201) */}
      <Bounds fit clip margin={0.9} maxDuration={0.85}>
        <CameraFocus targetCode={selectedLoc} highlightLocs={highlightLocs} registry={registry} />
        <group>
          {sorted.map((shape) => (
            <Block
              key={shape.code}
              shape={shape}
              cell={cells.get(shape.code)}
              width={width}
              depth={depth}
              colorMode={colorMode}
              selected={selectedLoc === shape.code}
              // ກົດບລ໋ອກໃດ → ບລ໋ອກອື່ນຈາງລົງໝົດ ໃຫ້ເຫັນສະເພາະອັນທີ່ກົດ (ຄື 1201).
              // ຄົ້ນຫາສິນຄ້າກໍ່ຄືກັນ — ບ່ອນທີ່ບໍ່ມີສິນຄ້ານັ້ນຈາງລົງ.
              dimmed={
                selectedLoc != null
                  ? selectedLoc !== shape.code
                  : highlightLocs.size > 0 && !highlightLocs.has(shape.code)
              }
              registry={registry}
              onSelect={() => {
                const cell = cells.get(shape.code);
                if (shape.kind === "location") onSelectLoc(cell?.rackCode ?? "", shape.code);
              }}
            />
          ))}
        </group>
      </Bounds>

      <ContactShadows position={[0, 0.002, 0]} scale={span * 1.4} opacity={0.32} blur={2.4} far={12} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
