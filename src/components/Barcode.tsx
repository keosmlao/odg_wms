import { code128B } from "@/lib/code128";

/**
 * Renders a Code 128-B barcode as inline SVG (scales to container width).
 * `quiet` adds the required blank quiet-zone on each side (in modules).
 */
export default function Barcode({ value, height = 44, quiet = 10 }: { value: string; height?: number; quiet?: number }) {
  const { bars, width } = code128B(value);
  const total = width + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${total} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`barcode ${value}`}
    >
      <rect x={0} y={0} width={total} height={height} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x + quiet} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}
