// Geometry for dragging thumbnails to reorder pages (SPEC 6.3, D24). Pure functions on the
// thumbnail layout; the panel handles pointer events.
import type { Layout } from "./layout";

/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;
/** Distance from the panel edge (px) where auto-scroll starts. */
export const AUTO_SCROLL_EDGE = 48;
/** Auto-scroll speed at the very edge (px per frame). */
export const AUTO_SCROLL_MAX = 18;

/**
 * Insertion index (0..n) for a pointer at content y: before the first page whose middle is
 * below the pointer.
 */
export function dropIndex(layout: Layout, y: number): number {
  let lo = 0;
  let hi = layout.tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (y < layout.tops[mid] + layout.heights[mid] / 2) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Space between the insertion line and the page it precedes (clears the selection ring). */
export const DROP_LINE_OFFSET = 7;

/**
 * Content y of the insertion line for `index`: just above that page, or for the end, where
 * a next page would start (`gapAfterPage` is the label space below each thumbnail).
 */
export function dropLineY(layout: Layout, index: number, gapAfterPage: number): number {
  const n = layout.tops.length;
  if (!n) return 0;
  const top = index < n ? layout.tops[index] : layout.tops[n - 1] + layout.heights[n - 1] + gapAfterPage;
  return Math.max(0, top - DROP_LINE_OFFSET);
}

/** Scroll step for a pointer at `clientY` in a panel spanning [top, bottom]. */
export function autoScrollStep(clientY: number, top: number, bottom: number): number {
  if (clientY < top + AUTO_SCROLL_EDGE) {
    const t = Math.min(1, (top + AUTO_SCROLL_EDGE - clientY) / AUTO_SCROLL_EDGE);
    return -Math.ceil(t * AUTO_SCROLL_MAX);
  }
  if (clientY > bottom - AUTO_SCROLL_EDGE) {
    const t = Math.min(1, (clientY - (bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
    return Math.ceil(t * AUTO_SCROLL_MAX);
  }
  return 0;
}
