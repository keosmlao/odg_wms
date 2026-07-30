import type { CSSProperties } from "react";

/**
 * Shrink-to-fit sizing for printed table cells.
 *
 * Printed documents must never lose a character — a client holding the paper
 * cannot recover a name that ends in "…". But they also must not be padded out
 * to an unreadable 4px just to force one line: the catalogue reaches 180
 * advancing glyphs, and no realistic column can hold that on a single line.
 *
 * So: keep the text on ONE line by shrinking the font, down to a readable floor.
 * Past that floor, wrap instead. Either way the whole value is on the page.
 */

/** Lao vowels and tone marks stack on the base glyph and add no advance width. */
const LAO_ZERO_WIDTH = /[ັິ-ຼ່-ໍ]/g;

/** Glyphs that actually consume horizontal space (Lao combining marks do not). */
export function advanceLen(text: string | null | undefined): number {
  return (text ?? "").replace(LAO_ZERO_WIDTH, "").length;
}

/**
 * Average advance per glyph, as a fraction of the font size, for this catalogue's
 * mixed Lao + Latin + digit names. Deliberately on the WIDE side so the estimate
 * under-shoots the font size rather than overflowing the cell.
 */
const ADVANCE_EM = 0.55;

/**
 * Style for a cell that should keep `text` on one line if it can.
 *
 * @param widthPx usable inner width of the column (column width minus padding)
 * @param max     preferred font size when the text fits comfortably
 * @param min     smallest font size still worth reading on paper; below this the
 *                cell wraps at `min` instead of shrinking further
 */
export function fitCell(
  text: string | null | undefined,
  widthPx: number,
  max = 11,
  min = 7,
): CSSProperties {
  const n = advanceLen(text);
  if (n === 0) return { fontSize: `${max}px`, lineHeight: 1.3 };
  // Largest size at which the whole string still fits on one line.
  const ideal = Math.floor((widthPx / (n * ADVANCE_EM)) * 10) / 10;
  if (ideal >= min) {
    return { fontSize: `${Math.min(max, ideal)}px`, lineHeight: 1.3, whiteSpace: "nowrap" };
  }
  // Too long for one readable line — wrap it rather than shrink into illegibility.
  return { fontSize: `${min}px`, lineHeight: 1.3, overflowWrap: "anywhere", wordBreak: "break-word" };
}
