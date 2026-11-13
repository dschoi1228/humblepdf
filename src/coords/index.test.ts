import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rotation } from "../bindings/Rotation";
import { displayRotation, toScreen, toUser, viewportTransform } from "./index";

const fixtures = join(import.meta.dirname, "..", "..", "tests", "fixtures");
// [file, page number] with different boxes: A4, CropBox inside MediaBox, negative origin.
const PAGES: [string, number][] = [
  ["rotated.pdf", 1],
  ["cropbox.pdf", 1],
  ["cropbox.pdf", 2],
];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const docs = new Map<string, PDFDocumentProxy>();
beforeAll(async () => {
  for (const [f] of PAGES) {
    if (!docs.has(f)) {
      const data = new Uint8Array(readFileSync(join(fixtures, f)));
      docs.set(f, await getDocument({ data }).promise);
    }
  }
});
afterAll(async () => {
  for (const d of docs.values()) await d.loadingTask.destroy();
});

describe("viewportTransform equals the pdf.js viewport", () => {
  for (const [file, n] of PAGES) {
    for (const rotation of ROTATIONS) {
      for (const scale of [1, 1.5]) {
        it(`${file} p${n} rotation ${rotation} scale ${scale}`, async () => {
          const page = await docs.get(file)!.getPage(n);
          const [x0, y0, x1, y1] = page.view;
          const box = { x0, y0, x1, y1 };
          const vp = page.getViewport({ scale, rotation });
          const t = viewportTransform(box, rotation, scale);
          t.matrix.forEach((v, i) => expect(v).toBeCloseTo(vp.transform[i], 9));
          expect(t.width).toBeCloseTo(vp.width, 9);
          expect(t.height).toBeCloseTo(vp.height, 9);

          // Box corners land on canvas corners.
          for (const c of [toScreen(t, { x: x0, y: y0 }), toScreen(t, { x: x1, y: y1 })]) {
            expect(Math.min(Math.abs(c.x), Math.abs(c.x - t.width))).toBeCloseTo(0, 9);
            expect(Math.min(Math.abs(c.y), Math.abs(c.y - t.height))).toBeCloseTo(0, 9);
          }
          // Same point as pdf.js, and a round trip back to user space.
          const p = { x: x0 + 12.5, y: y1 - 30.25 };
          const [sx, sy] = vp.convertToViewportPoint(p.x, p.y);
          const s = toScreen(t, p);
          expect(s.x).toBeCloseTo(sx, 9);
          expect(s.y).toBeCloseTo(sy, 9);
          const back = toUser(t, s);
          expect(back.x).toBeCloseTo(p.x, 9);
          expect(back.y).toBeCloseTo(p.y, 9);
        });
      }
    }
  }

  it("display rotation adds base and user rotation", () => {
    expect(displayRotation(270, 180)).toBe(90);
    expect(displayRotation(90, 0)).toBe(90);
  });
});
