import { describe, expect, it } from "vitest";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { deltaToUser, screenAxes, viewportTransform } from "../coords";
import {
  clampAlong,
  handlesOf,
  hitTest,
  MIN_SIZE,
  moveObject,
  newObject,
  objectBounds,
  parseHandle,
  handleKey,
  highlightFromQuads,
  resizeObject,
  snap45,
} from "./geometry";
import { DEFAULT_PROPS } from "./tools";

const box = { x0: 0, y0: 0, x1: 600, y1: 800 };
const rect = (x0: number, y0: number, x1: number, y1: number): PageObject => ({
  type: "rect",
  id: "r",
  rect: { x0, y0, x1, y1 },
  ...DEFAULT_PROPS.rect,
});
const line = (fx: number, fy: number, tx: number, ty: number, arrow = false): PageObject => ({
  type: "line",
  id: "l",
  from: { x: fx, y: fy },
  to: { x: tx, y: ty },
  arrow,
  ...DEFAULT_PROPS.line,
});
const axes0 = screenAxes(viewportTransform(box, 0, 1));

describe("moveObject", () => {
  it("moves every point and stays inside the page", () => {
    expect(moveObject(rect(100, 100, 200, 150), 10, -20, box)).toMatchObject({ rect: { x0: 110, y0: 80, x1: 210, y1: 130 } });
    expect(moveObject(rect(100, 100, 200, 150), -500, 900, box)).toMatchObject({ rect: { x0: 0, y0: 750, x1: 100, y1: 800 } });
    expect(moveObject(line(10, 10, 50, 60), 1000, 0, box)).toMatchObject({ from: { x: 560, y: 10 }, to: { x: 600, y: 60 } });
  });
  it("returns the same object when it cannot move", () => {
    const o = rect(0, 0, 100, 100);
    expect(moveObject(o, -5, -5, box)).toBe(o);
  });
  it("works on a box with a negative origin (CropBox)", () => {
    const b = { x0: -100, y0: -50, x1: 300, y1: 400 };
    expect(moveObject(rect(0, 0, 50, 50), -500, -500, b)).toMatchObject({ rect: { x0: -100, y0: -50, x1: -50, y1: 0 } });
  });
});

describe("resizeObject", () => {
  const o = rect(100, 100, 300, 200);
  it("moves only the edges a handle names", () => {
    expect(resizeObject(o, { sx: 1, sy: 0 }, { x: 350, y: 999 }, box)).toMatchObject({ rect: { x0: 100, y0: 100, x1: 350, y1: 200 } });
    expect(resizeObject(o, { sx: -1, sy: 1 }, { x: 50, y: 250 }, box)).toMatchObject({ rect: { x0: 50, y0: 100, x1: 300, y1: 250 } });
    expect(resizeObject(o, { sx: 0, sy: -1 }, { x: 0, y: 120 }, box)).toMatchObject({ rect: { x0: 100, y0: 120, x1: 300, y1: 200 } });
  });
  it("never crosses the opposite edge and keeps the minimum size", () => {
    const r = resizeObject(o, { sx: 1, sy: 1 }, { x: 0, y: 0 }, box);
    expect(r).toMatchObject({ rect: { x0: 100, y0: 100, x1: 100 + MIN_SIZE, y1: 100 + MIN_SIZE } });
  });
  it("stays inside the page", () => {
    expect(resizeObject(o, { sx: 1, sy: 1 }, { x: 9999, y: 9999 }, box)).toMatchObject({ rect: { x1: 600, y1: 800 } });
  });
  it("scales highlight quads with the bounds", () => {
    const h: PageObject = {
      type: "highlight",
      id: "h",
      color: [1, 1, 0],
      opacity: 0.4,
      quads: [
        [
          { x: 0, y: 20 },
          { x: 100, y: 20 },
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
    };
    const r = resizeObject(h, { sx: 1, sy: 0 }, { x: 200, y: 0 }, box);
    expect(objectBounds(r)).toEqual({ x0: 0, y0: 0, x1: 200, y1: 20 });
  });
  it("moves a line end, snapping to 45 degrees with shift, and refuses a degenerate line", () => {
    const l = line(100, 100, 200, 100);
    expect(resizeObject(l, "to", { x: 300, y: 150 }, box)).toMatchObject({ from: { x: 100, y: 100 }, to: { x: 300, y: 150 } });
    const s = resizeObject(l, "to", { x: 200, y: 190 }, box, true) as Extract<PageObject, { type: "line" }>;
    expect(s.to.x - 100).toBeCloseTo(s.to.y - 100, 6);
    expect(resizeObject(l, "from", { x: 199, y: 100 }, box)).toBe(l);
  });
});

describe("handles", () => {
  it("rect-like objects have 8 handles, lines their 2 ends", () => {
    expect(handlesOf(rect(0, 0, 10, 10))).toHaveLength(8);
    expect(handlesOf(line(0, 0, 10, 10)).map((h) => h.handle)).toEqual(["from", "to"]);
  });
  it("handle keys round-trip", () => {
    for (const { handle } of [...handlesOf(rect(0, 0, 10, 10)), ...handlesOf(line(0, 0, 1, 1))]) {
      expect(parseHandle(handleKey(handle))).toEqual(handle);
    }
    expect(parseHandle("0,0")).toBeNull();
    expect(parseHandle("x")).toBeNull();
  });
});

describe("hitTest", () => {
  it("picks the topmost object", () => {
    const a = { ...rect(0, 0, 100, 100), id: "a" } as PageObject;
    const b = { ...rect(50, 50, 150, 150), id: "b" } as PageObject;
    expect(hitTest([a, b], { x: 75, y: 75 }, 1)).toBe("b");
    expect(hitTest([a, b], { x: 10, y: 10 }, 1)).toBe("a");
    expect(hitTest([a, b], { x: 300, y: 300 }, 1)).toBeNull();
  });
  it("uses the distance to a line", () => {
    const l = line(0, 0, 100, 0);
    expect(hitTest([l], { x: 50, y: 3 }, 4)).toBe("l");
    expect(hitTest([l], { x: 50, y: 8 }, 4)).toBeNull();
    expect(hitTest([l], { x: 120, y: 0 }, 4)).toBeNull();
  });
  it("includes the stroke of a shape", () => {
    const o = { ...rect(100, 100, 200, 200), strokeWidth: 12 } as PageObject;
    expect(hitTest([o], { x: 95, y: 150 }, 0)).toBe("r");
  });
});

describe("snap45 and clampAlong", () => {
  it("snaps to the nearest 45 degree direction, keeping the length", () => {
    const p = snap45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1), 8);
    expect(p.y).toBe(0);
    const q = snap45({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y, 9);
  });
  it("shortens a segment to stay in the box", () => {
    expect(clampAlong({ x: 500, y: 400 }, { x: 700, y: 500 }, box)).toEqual({ x: 600, y: 450 });
  });
});

describe("newObject", () => {
  const base = { id: "n", box, axes: axes0 };
  it("drag makes a shape from the two corners", () => {
    const o = newObject({ ...base, tool: "rect", props: DEFAULT_PROPS.rect, start: { x: 300, y: 100 }, end: { x: 100, y: 200 } });
    expect(o).toMatchObject({ type: "rect", rect: { x0: 100, y0: 100, x1: 300, y1: 200 }, stroke: DEFAULT_PROPS.rect.stroke });
  });
  it("a thin drag grows to the minimum size", () => {
    const o = newObject({ ...base, tool: "ellipse", props: DEFAULT_PROPS.ellipse, start: { x: 100, y: 100 }, end: { x: 200, y: 101 } });
    expect(objectBounds(o!)).toEqual({ x0: 100, y0: 100, x1: 200, y1: 100 + MIN_SIZE });
  });
  it("a highlight is one quad in Acrobat order; a click makes none", () => {
    const o = newObject({ ...base, tool: "highlight", props: DEFAULT_PROPS.highlight, start: { x: 10, y: 10 }, end: { x: 50, y: 30 } });
    expect(o).toMatchObject({
      type: "highlight",
      opacity: 0.4,
      quads: [
        [
          { x: 10, y: 30 },
          { x: 50, y: 30 },
          { x: 10, y: 10 },
          { x: 50, y: 10 },
        ],
      ],
    });
    expect(newObject({ ...base, tool: "highlight", props: DEFAULT_PROPS.highlight, start: { x: 10, y: 10 }, end: null })).toBeNull();
  });
  it("a click makes a 120x80 shape along the screen axes, inside the page", () => {
    const o = newObject({ ...base, tool: "rect", props: DEFAULT_PROPS.rect, start: { x: 300, y: 400 }, end: null });
    expect(objectBounds(o!)).toEqual({ x0: 240, y0: 360, x1: 360, y1: 440 });
    // On a page shown rotated 90 degrees, screen width is user height.
    const axes90 = screenAxes(viewportTransform(box, 90, 1));
    const r = newObject({ ...base, axes: axes90, tool: "rect", props: DEFAULT_PROPS.rect, start: { x: 300, y: 400 }, end: null });
    expect(objectBounds(r!)).toEqual({ x0: 260, y0: 340, x1: 340, y1: 460 });
    const edge = newObject({ ...base, tool: "rect", props: DEFAULT_PROPS.rect, start: { x: 5, y: 5 }, end: null });
    expect(objectBounds(edge!)).toEqual({ x0: 0, y0: 0, x1: 120, y1: 80 });
  });
  it("lines: a click goes right on screen; shift snaps; too short makes none", () => {
    const axes90 = screenAxes(viewportTransform(box, 90, 1));
    const l = newObject({ ...base, axes: axes90, tool: "arrow", props: DEFAULT_PROPS.arrow, start: { x: 300, y: 400 }, end: null });
    expect(l).toMatchObject({ type: "line", arrow: true, from: { x: 300, y: 400 } });
    const to = (l as Extract<PageObject, { type: "line" }>).to;
    expect(to.x).toBeCloseTo(300, 9);
    // Shown rotated 90 degrees clockwise: the page's +y points right on screen.
    expect(to.y).toBeCloseTo(520, 9);
    const s = newObject({ ...base, tool: "line", props: DEFAULT_PROPS.line, start: { x: 0, y: 0 }, end: { x: 100, y: 10 }, snap: true });
    expect(s).toMatchObject({ arrow: false, to: { y: 0 } });
    expect(newObject({ ...base, tool: "line", props: DEFAULT_PROPS.line, start: { x: 0, y: 0 }, end: { x: 2, y: 2 } })).toBeNull();
  });
});

describe("screen directions on rotated pages", () => {
  it.each([0, 90, 180, 270] as Rotation[])("rotation %i: one pixel right is one point along the screen's right", (r) => {
    const t = viewportTransform(box, r, 2);
    const d = deltaToUser(t, 2, 0);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
    const a = screenAxes(t);
    expect(d.x).toBeCloseTo(a.right.x, 9);
    expect(d.y).toBeCloseTo(a.right.y, 9);
  });
});

describe("highlightFromQuads (M13)", () => {
  const props = DEFAULT_PROPS.highlight;
  const q = (x0: number, y0: number, x1: number, y1: number) =>
    [
      { x: x0, y: y1 },
      { x: x1, y: y1 },
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ] as const;

  it("keeps the quads and their point order, with the tool's colour", () => {
    const h = highlightFromQuads("h", [q(60, 755, 300, 779), q(60, 705, 280, 729)], props, box);
    expect(h).toEqual({ type: "highlight", id: "h", quads: [q(60, 755, 300, 779), q(60, 705, 280, 729)], ...props });
  });

  it("clamps to the page box and drops quads left without area", () => {
    const h = highlightFromQuads("h", [q(-20, 790, 700, 830), q(10, 900, 50, 950)], props, box);
    expect(h?.type === "highlight" && h.quads).toEqual([q(0, 790, 600, 800)]);
    expect(highlightFromQuads("h", [q(10, 900, 50, 950)], props, box)).toBeNull();
    expect(highlightFromQuads("h", [], props, box)).toBeNull();
  });
});
