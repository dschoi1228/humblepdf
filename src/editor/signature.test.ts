// Signature placement and ratio-keeping resize (SPEC 6.8, D31), and the delete rule.
import { describe, expect, it } from "vitest";
import type { Document } from "../bindings/Document";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { screenAxes, viewportTransform } from "../coords";
import { signaturePages } from "../signatures/usage";
import { shortcutFor } from "../app/shortcuts";
import { handlesOf, hitTest, MIN_SIZE, moveObject, newSignature, objectBounds, resizeObject, SIGNATURE_WIDTH_RATIO, signatureWidth } from "./geometry";

const box = { x0: 0, y0: 0, x1: 600, y1: 800 };
type Sig = Extract<PageObject, { type: "signature" }>;
const place = (r: Rotation, at = { x: 300, y: 400 }, aspect = 3, width?: number) =>
  newSignature({ id: "s", signatureId: "sg-1", at, aspect, box, axes: screenAxes(viewportTransform(box, r, 1)), rotation: r, width }) as Sig;
const w = (o: Sig) => o.rect.x1 - o.rect.x0;
const h = (o: Sig) => o.rect.y1 - o.rect.y0;

describe("newSignature", () => {
  it("is 20% of the page width on screen, centered, upright", () => {
    const s = place(0);
    expect(SIGNATURE_WIDTH_RATIO).toBe(0.2);
    expect(w(s)).toBeCloseTo(120, 9);
    expect(h(s)).toBeCloseTo(40, 9);
    expect(s.rect).toEqual({ x0: 240, y0: 380, x1: 360, y1: 420 });
    expect(s).toMatchObject({ rotation: 0, signatureId: "sg-1" });
  });
  it.each([90, 270] as Rotation[])("rotation %i: the screen width is the user height", (r) => {
    const s = place(r);
    // Shown rotated, the page is 800 wide on screen.
    expect(h(s)).toBeCloseTo(160, 9);
    expect(w(s)).toBeCloseTo(160 / 3, 9);
    expect(s.rotation).toBe(r);
  });
  it("stays inside the page", () => {
    const s = place(0, { x: 590, y: 5 });
    expect(s.rect.x1).toBe(600);
    expect(s.rect.y0).toBe(0);
    expect(w(s)).toBeCloseTo(120, 9);
  });
  it("a very tall image is shrunk to fit with its ratio", () => {
    const s = place(0, { x: 300, y: 400 }, 0.1);
    expect(h(s)).toBeCloseTo(800, 9);
    expect(w(s) / h(s)).toBeCloseTo(0.1, 9);
  });
});

describe("remembered width (D50)", () => {
  it.each([0, 90, 180, 270] as Rotation[])("rotation %i: placed at the width, whatever the page", (r) => {
    const s = place(r, { x: 300, y: 400 }, 3, 90);
    expect(signatureWidth(s)).toBeCloseTo(90, 9);
    // Upright on screen: the other side follows the ratio.
    expect((r % 180 === 0 ? h(s) : w(s))).toBeCloseTo(30, 9);
  });
  it("a width larger than the page is shrunk to fit with its ratio", () => {
    const s = place(0, { x: 300, y: 400 }, 3, 900);
    expect(w(s)).toBeCloseTo(600, 9);
    expect(h(s)).toBeCloseTo(200, 9);
  });
  it("signatureWidth reads back the upright width after a resize", () => {
    const s = place(90, { x: 300, y: 400 }, 3, 90);
    const r = resizeObject(s, { sx: 1, sy: 1 }, { x: 400, y: 500 }, box) as Sig;
    const again = place(90, { x: 300, y: 400 }, 3, signatureWidth(r));
    expect(again.rect.x1 - again.rect.x0).toBeCloseTo(r.rect.x1 - r.rect.x0, 9);
    expect(again.rect.y1 - again.rect.y0).toBeCloseTo(r.rect.y1 - r.rect.y0, 9);
  });
});

describe("editing a signature", () => {
  const s = place(0, { x: 300, y: 400 }, 3, 150); // the 25%-wide box these cases were written for
  it("has four corner handles", () => {
    expect(handlesOf(s).map((x) => x.handle)).toEqual([
      { sx: -1, sy: 1 },
      { sx: 1, sy: 1 },
      { sx: -1, sy: -1 },
      { sx: 1, sy: -1 },
    ]);
  });
  it("corner drags keep the ratio and the opposite corner", () => {
    const r = resizeObject(s, { sx: 1, sy: 1 }, { x: 525, y: 430 }, box) as Sig;
    expect(r.rect.x0).toBe(225);
    expect(r.rect.y0).toBe(375);
    expect(w(r) / h(r)).toBeCloseTo(3, 9);
    expect(w(r)).toBeCloseTo(300, 9);
    const l = resizeObject(s, { sx: -1, sy: -1 }, { x: 0, y: 0 }, box) as Sig;
    expect(l.rect.x1).toBe(375);
    expect(l.rect.y1).toBe(425);
    expect(w(l) / h(l)).toBeCloseTo(3, 9);
    // Limited by the page edge it reaches first (left: 375 pt of room).
    expect(w(l)).toBeCloseTo(375, 9);
  });
  it("keeps a minimum size and edge handles do nothing", () => {
    const r = resizeObject(s, { sx: 1, sy: 1 }, { x: 0, y: 0 }, box) as Sig;
    expect(Math.min(w(r), h(r))).toBeCloseTo(MIN_SIZE, 9);
    expect(resizeObject(s, { sx: 1, sy: 0 }, { x: 999, y: 0 }, box)).toEqual(s);
  });
  it("moves, hit-tests and keeps its rotation", () => {
    const m = moveObject(place(90), 1000, 0, box) as Sig;
    expect(m.rect.x1).toBe(600);
    expect(m.rotation).toBe(90);
    expect(objectBounds(s)).toEqual(s.rect);
    expect(hitTest([s], { x: 300, y: 400 }, 0)).toBe("s");
    expect(hitTest([s], { x: 100, y: 100 }, 0)).toBeNull();
  });
});

describe("library delete rule", () => {
  it("lists the pages that place a signature", () => {
    const page = (id: string, objects: PageObject[]) => ({
      id,
      sourceId: "x",
      pageIndex: 0,
      imageFit: null,
      box,
      baseRotation: 0 as const,
      userRotation: 0 as const,
      objects,
    });
    const doc: Document = { schemaVersion: 1, sources: [], pages: [page("a", [place(0)]), page("b", []), page("c", [place(0)])] };
    expect(signaturePages(doc, "sg-1")).toEqual([1, 3]);
    expect(signaturePages(doc, "other")).toEqual([]);
  });
  it("S picks the signature tool", () => {
    expect(shortcutFor({ code: "KeyS", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toEqual({ kind: "tool", tool: "signature" });
  });
});
