// Pure layout math for the continuous page view and the thumbnail list.
import type { Page } from "../bindings/Page";

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
/** Zoom steps for the +/- buttons and Ctrl+wheel (SPEC 6.2: 25–400%). */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** Vertical gap between pages and padding around the column, in CSS px. */
export const PAGE_GAP = 16;
export const VIEW_PADDING = 24;

export type Size = { w: number; h: number };

/** Unscaled display size in pt: the box, with width and height swapped at 90°/270°. */
export function pageDisplaySize(page: Page): Size {
  const w = page.box.x1 - page.box.x0;
  const h = page.box.y1 - page.box.y0;
  const r = (page.baseRotation + page.userRotation) % 360;
  return r === 90 || r === 270 ? { w: h, h: w } : { w, h };
}

export type Layout = {
  /** Top of each page in CSS px, from the top of the scroll content. */
  tops: number[];
  widths: number[];
  heights: number[];
  totalHeight: number;
  maxWidth: number;
};

/** Stacks pages vertically. `scaleOf(i)` gives each page's scale (one scale for the view). */
export function computeLayout(sizes: Size[], scaleOf: (i: number) => number, gap = PAGE_GAP, padding = VIEW_PADDING): Layout {
  const tops: number[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  let y = padding;
  let maxWidth = 0;
  sizes.forEach((s, i) => {
    const k = scaleOf(i);
    const w = s.w * k;
    const h = s.h * k;
    tops.push(y);
    widths.push(w);
    heights.push(h);
    maxWidth = Math.max(maxWidth, w);
    y += h + gap;
  });
  const totalHeight = sizes.length ? y - gap + padding : 0;
  return { tops, widths, heights, totalHeight, maxWidth };
}

/** Index of the last page whose top is <= y (0 when y is above the first page). */
export function pageAtY(layout: Layout, y: number): number {
  let lo = 0;
  let hi = layout.tops.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Inclusive range of pages that intersect [scrollTop, scrollTop + viewportHeight). */
export function visibleRange(layout: Layout, scrollTop: number, viewportHeight: number): [number, number] {
  const n = layout.tops.length;
  if (n === 0) return [0, -1];
  let first = pageAtY(layout, scrollTop);
  if (layout.tops[first] + layout.heights[first] <= scrollTop && first < n - 1) first++;
  const bottom = scrollTop + viewportHeight;
  let last = first;
  while (last + 1 < n && layout.tops[last + 1] < bottom) last++;
  return [first, last];
}

/**
 * The current page: the page under a line one third down the viewport, or the last page
 * when the view is scrolled to the end (a short last page may never reach that line).
 */
export function currentPageAt(layout: Layout, scrollTop: number, viewportHeight: number): number {
  const n = layout.tops.length;
  if (n > 0 && scrollTop + viewportHeight >= layout.totalHeight - 1) return n - 1;
  return Math.max(0, pageAtY(layout, scrollTop + viewportHeight / 3));
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Next zoom step above (dir > 0) or below (dir < 0) the current scale. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > scale + eps) ?? MAX_SCALE;
  return [...ZOOM_STEPS].reverse().find((z) => z < scale - eps) ?? MIN_SCALE;
}

/** Scale that makes `size` fill the container width (minus padding). */
export function fitWidthScale(size: Size, containerWidth: number, padding = VIEW_PADDING): number {
  return clampScale((containerWidth - 2 * padding) / size.w);
}

/** Scale that shows the whole page in the container. */
export function fitPageScale(size: Size, containerWidth: number, containerHeight: number, padding = VIEW_PADDING): number {
  return clampScale(Math.min((containerWidth - 2 * padding) / size.w, (containerHeight - 2 * padding) / size.h));
}
