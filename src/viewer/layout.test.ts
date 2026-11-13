import { describe, expect, it } from "vitest";
import type { Page } from "../bindings/Page";
import type { Rotation } from "../bindings/Rotation";
import {
  clampScale,
  computeLayout,
  currentPageAt,
  fitPageScale,
  fitWidthScale,
  PAGE_GAP,
  pageDisplaySize,
  stepZoom,
  visibleRange,
  VIEW_PADDING,
} from "./layout";

function page(w: number, h: number, base: Rotation = 0, user: Rotation = 0): Page {
  return {
    id: "p",
    sourceId: "s",
    pageIndex: 0,
    imageFit: null,
    box: { x0: 10, y0: 20, x1: 10 + w, y1: 20 + h },
    baseRotation: base,
    userRotation: user,
    objects: [],
  };
}

describe("pageDisplaySize", () => {
  it("swaps width and height at 90 and 270 degrees", () => {
    expect(pageDisplaySize(page(600, 800))).toEqual({ w: 600, h: 800 });
    expect(pageDisplaySize(page(600, 800, 90))).toEqual({ w: 800, h: 600 });
    expect(pageDisplaySize(page(600, 800, 180, 90))).toEqual({ w: 800, h: 600 });
    expect(pageDisplaySize(page(600, 800, 90, 270))).toEqual({ w: 600, h: 800 });
  });
});

describe("computeLayout and ranges", () => {
  const sizes = [
    { w: 600, h: 800 },
    { w: 800, h: 600 },
    { w: 600, h: 800 },
  ];
  const l = computeLayout(sizes, () => 0.5);

  it("stacks pages with gap and padding", () => {
    expect(l.tops).toEqual([VIEW_PADDING, VIEW_PADDING + 400 + PAGE_GAP, VIEW_PADDING + 400 + PAGE_GAP + 300 + PAGE_GAP]);
    expect(l.widths).toEqual([300, 400, 300]);
    expect(l.maxWidth).toBe(400);
    expect(l.totalHeight).toBe(l.tops[2] + 400 + VIEW_PADDING);
  });

  it("finds visible pages", () => {
    expect(visibleRange(l, 0, 100)).toEqual([0, 0]);
    expect(visibleRange(l, 0, 500)).toEqual([0, 1]);
    // Scrolled past page 0 entirely.
    expect(visibleRange(l, l.tops[1] + 10, 100)).toEqual([1, 1]);
    // In the gap after page 0: page 1 is the first visible one.
    expect(visibleRange(l, l.tops[0] + 401, 50)).toEqual([1, 1]);
    expect(visibleRange(l, 0, 10_000)).toEqual([0, 2]);
    expect(visibleRange(computeLayout([], () => 1), 0, 100)).toEqual([0, -1]);
  });

  it("current page is the one a third down the viewport", () => {
    expect(currentPageAt(l, 0, 300)).toBe(0);
    expect(currentPageAt(l, l.tops[1] - 50, 300)).toBe(1);
    expect(currentPageAt(l, l.totalHeight, 300)).toBe(2);
    // Scrolled to the very end: the last page even if it is above the one-third line.
    expect(currentPageAt(l, l.totalHeight - 900, 900)).toBe(2);
  });
});

describe("zoom", () => {
  it("clamps to 25–400%", () => {
    expect(clampScale(0.1)).toBe(0.25);
    expect(clampScale(9)).toBe(4);
  });

  it("steps through the zoom list and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.03, 1)).toBe(1.1);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("fit width and fit page", () => {
    expect(fitWidthScale({ w: 600, h: 800 }, 600 + 2 * VIEW_PADDING)).toBeCloseTo(1);
    expect(fitPageScale({ w: 600, h: 800 }, 2000, 400 + 2 * VIEW_PADDING)).toBeCloseTo(0.5);
    expect(fitWidthScale({ w: 100, h: 100 }, 100_000)).toBe(4);
  });
});
