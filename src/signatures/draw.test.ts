import { describe, expect, it } from "vitest";
import { hasTransparency, inkBounds, strokeWidth } from "./draw";

/** RGBA data of a w x h image with ink at the given pixels. */
function image(w: number, h: number, ink: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of ink) d[(y * w + x) * 4 + 3] = 255;
  return d;
}

describe("inkBounds", () => {
  it("is null for an empty pad", () => {
    expect(inkBounds(image(10, 5, []), 10, 5, 2)).toBeNull();
  });

  it("wraps the ink with padding", () => {
    expect(inkBounds(image(20, 10, [[5, 3], [9, 6]]), 20, 10, 2)).toEqual({ x: 3, y: 1, w: 9, h: 8 });
  });

  it("keeps the padding inside the pad", () => {
    expect(inkBounds(image(20, 10, [[0, 0], [19, 9]]), 20, 10, 4)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
});

describe("strokeWidth", () => {
  it("follows a pen's pressure and keeps mouse strokes even", () => {
    expect(strokeWidth(2, "mouse", 0.5)).toBe(2);
    expect(strokeWidth(2, "touch", 0.9)).toBe(2);
    expect(strokeWidth(2, "pen", 0)).toBe(2);
    expect(strokeWidth(2, "pen", 0.5)).toBe(2);
    expect(strokeWidth(2, "pen", 1)).toBe(3);
    expect(strokeWidth(2, "pen", 0.1)).toBeCloseTo(1.2);
  });
});

describe("hasTransparency", () => {
  it("tells transparent PNGs from opaque photos", () => {
    const opaque = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(hasTransparency(opaque)).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]))).toBe(true);
  });
});
