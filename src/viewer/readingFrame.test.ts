import { describe, expect, it } from "vitest";
import type { Rotation } from "../bindings/Rotation";
import { toScreen, toUser, viewportTransform } from "../coords";
import { fromReading, mergeLines, readingBox, readingQuad, toReading } from "./readingFrame";

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe("reading frame", () => {
  it("fromReading undoes toReading at every rotation", () => {
    for (const r of [...ROTATIONS, -90, 450]) {
      const [x, y] = toReading(r, 13, -7);
      expect(fromReading(r, x, y)).toEqual([13, -7]);
    }
  });

  it("joins boxes of a line, gaps included, and keeps lines apart", () => {
    const lines = mergeLines([
      { x0: 120, y0: 10, x1: 200, y1: 34 }, // line 1, second word
      { x0: 10, y0: 60, x1: 90, y1: 84 }, // line 2
      { x0: 10, y0: 11, x1: 100, y1: 33 }, // line 1, first word
      { x0: 95, y0: 62, x1: 140, y1: 80 }, // line 2, a smaller run
    ]);
    expect(lines).toEqual([
      { x0: 10, y0: 10, x1: 200, y1: 34 },
      { x0: 10, y0: 60, x1: 140, y1: 84 },
    ]);
  });

  it("does not join lines that only touch", () => {
    // Overlap of 4 px between two 24 px lines: less than half.
    expect(mergeLines([{ x0: 0, y0: 0, x1: 10, y1: 24 }, { x0: 0, y0: 20, x1: 10, y1: 44 }])).toHaveLength(2);
  });

  // A line of upright text in user space (y up), drawn on a page shown at each rotation:
  // through the screen and back, its quad must start at the upper left as the text reads.
  it.each(ROTATIONS)("gives the quad in Acrobat order on a page shown at %i°", (r) => {
    const box = { x0: 0, y0: 0, x1: 595, y1: 842 };
    const t = viewportTransform(box, r, 1.5);
    const corners = [
      { x: 60, y: 779 },
      { x: 300, y: 779 },
      { x: 60, y: 755 },
      { x: 300, y: 755 },
    ].map((p) => toScreen(t, p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const client = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const quad = readingQuad(r, readingBox(r, client)).map((p) => toUser(t, p));
    const expected = [
      { x: 60, y: 779 },
      { x: 300, y: 779 },
      { x: 60, y: 755 },
      { x: 300, y: 755 },
    ];
    quad.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 6);
      expect(p.y).toBeCloseTo(expected[i].y, 6);
    });
  });
});
