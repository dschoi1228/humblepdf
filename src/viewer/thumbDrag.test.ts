import { describe, expect, it } from "vitest";
import { computeLayout } from "./layout";
import { AUTO_SCROLL_EDGE, AUTO_SCROLL_MAX, autoScrollStep, dropIndex, dropLineY, DROP_LINE_OFFSET } from "./thumbDrag";

// Three thumbnails 100px high, 28px label gap, 12px padding: tops 12, 140, 268.
const layout = computeLayout(
  [
    { w: 100, h: 100 },
    { w: 100, h: 100 },
    { w: 100, h: 100 },
  ],
  () => 1,
  28,
  12,
);

describe("dropIndex", () => {
  it("inserts before the first page whose middle is below the pointer", () => {
    expect(layout.tops).toEqual([12, 140, 268]);
    expect(dropIndex(layout, 0)).toBe(0);
    expect(dropIndex(layout, 61)).toBe(0);
    expect(dropIndex(layout, 62)).toBe(1);
    expect(dropIndex(layout, 189)).toBe(1);
    expect(dropIndex(layout, 190)).toBe(2);
    expect(dropIndex(layout, 318)).toBe(3);
    expect(dropIndex(layout, 10_000)).toBe(3);
  });
  it("handles an empty list", () => {
    expect(dropIndex(computeLayout([], () => 1), 50)).toBe(0);
  });
});

describe("dropLineY", () => {
  it("draws the line just above the target page, or after the last one", () => {
    expect(dropLineY(layout, 0, 28)).toBe(12 - DROP_LINE_OFFSET);
    expect(dropLineY(layout, 2, 28)).toBe(268 - DROP_LINE_OFFSET);
    expect(dropLineY(layout, 3, 28)).toBe(268 + 100 + 28 - DROP_LINE_OFFSET);
  });
});

describe("autoScrollStep", () => {
  it("scrolls faster closer to the edge and not in the middle", () => {
    expect(autoScrollStep(300, 0, 600)).toBe(0);
    expect(autoScrollStep(AUTO_SCROLL_EDGE + 1, 0, 600)).toBe(0);
    expect(autoScrollStep(AUTO_SCROLL_EDGE / 2, 0, 600)).toBeLessThan(0);
    expect(autoScrollStep(-50, 0, 600)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollStep(600 - AUTO_SCROLL_EDGE / 2, 0, 600)).toBeGreaterThan(0);
    expect(autoScrollStep(700, 0, 600)).toBe(AUTO_SCROLL_MAX);
  });
});
