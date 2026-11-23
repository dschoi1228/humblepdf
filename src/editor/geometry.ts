// Object editing geometry in page user space (pt, y up), D28. Screen pixels never appear
// here: callers convert with the coords module and pass user-space points, tolerances and
// screen axes.
import type { PageObject } from "../bindings/PageObject";
import type { Point } from "../bindings/Point";
import type { Rect } from "../bindings/Rect";
import type { Rotation } from "../bindings/Rotation";
import { arrowLength, ARROW_BASE_RATIO } from "../shapes/spec";
import type { DrawTool, HighlightProps, LineProps, ShapeProps } from "./tools";

/** Smallest width and height of a shape, and length of a line (pt). */
export const MIN_SIZE = 4;
/** Size of a shape made with a click, along the screen axes (pt). */
export const CLICK_SHAPE_SIZE = { w: 120, h: 80 };
/** Length of a line made with a click, to the right on screen (pt). */
export const CLICK_LINE_LENGTH = 120;

/** Rect handles name the edges they move: -1 = x0/y0 side, 1 = x1/y1 side, 0 = neither. */
export type RectHandle = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };
export type Handle = RectHandle | "from" | "to";

export function normRect(a: Point, b: Point): Rect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export function clampPoint(p: Point, box: Rect): Point {
  return { x: Math.min(Math.max(p.x, box.x0), box.x1), y: Math.min(Math.max(p.y, box.y0), box.y1) };
}

function inflate(r: Rect, d: number): Rect {
  return { x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d };
}

function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

function boundsOf(points: Point[]): Rect {
  return points.reduce(
    (r, p) => ({ x0: Math.min(r.x0, p.x), y0: Math.min(r.y0, p.y), x1: Math.max(r.x1, p.x), y1: Math.max(r.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
}

/** Geometry rectangle of an editable object (stroke width not included); null otherwise. */
export function objectBounds(o: PageObject): Rect | null {
  switch (o.type) {
    case "highlight":
      return boundsOf(o.quads.flat());
    case "rect":
    case "ellipse":
      return o.rect;
    case "line":
      return normRect(o.from, o.to);
    case "signature":
      return o.rect;
    default:
      return null;
  }
}

function mapPoints(o: PageObject, f: (p: Point) => Point): PageObject {
  switch (o.type) {
    case "highlight":
      return { ...o, quads: o.quads.map((q) => q.map(f) as [Point, Point, Point, Point]) };
    case "rect":
    case "ellipse":
    case "signature": {
      const a = f({ x: o.rect.x0, y: o.rect.y0 });
      const b = f({ x: o.rect.x1, y: o.rect.y1 });
      return { ...o, rect: normRect(a, b) };
    }
    case "line":
      return { ...o, from: f(o.from), to: f(o.to) };
    default:
      return o;
  }
}

/** Moves the object by (dx, dy), reduced so it stays inside `box`. */
export function moveObject(o: PageObject, dx: number, dy: number, box: Rect): PageObject {
  const b = objectBounds(o);
  if (!b) return o;
  const cx = Math.min(Math.max(dx, box.x0 - b.x0), box.x1 - b.x1);
  const cy = Math.min(Math.max(dy, box.y0 - b.y0), box.y1 - b.y1);
  if (cx === 0 && cy === 0) return o;
  return mapPoints(o, (p) => ({ x: p.x + cx, y: p.y + cy }));
}

/** Handles of an editable object with their user-space positions. */
export function handlesOf(o: PageObject): { handle: Handle; at: Point }[] {
  if (o.type === "line") {
    return [
      { handle: "from", at: o.from },
      { handle: "to", at: o.to },
    ];
  }
  const b = objectBounds(o);
  if (!b) return [];
  const xs = { [-1]: b.x0, 0: (b.x0 + b.x1) / 2, 1: b.x1 } as Record<number, number>;
  const ys = { [-1]: b.y0, 0: (b.y0 + b.y1) / 2, 1: b.y1 } as Record<number, number>;
  const out: { handle: Handle; at: Point }[] = [];
  // Signatures keep their proportions: corners only.
  const corners = o.type === "signature";
  for (const sy of [1, 0, -1] as const) {
    for (const sx of [-1, 0, 1] as const) {
      if (sx === 0 && sy === 0) continue;
      if (corners && (sx === 0 || sy === 0)) continue;
      out.push({ handle: { sx, sy }, at: { x: xs[sx], y: ys[sy] } });
    }
  }
  return out;
}

export function handleKey(h: Handle): string {
  return typeof h === "string" ? h : `${h.sx},${h.sy}`;
}

export function parseHandle(key: string): Handle | null {
  if (key === "from" || key === "to") return key;
  const [sx, sy] = key.split(",").map(Number);
  const ok = (v: number) => v === -1 || v === 0 || v === 1;
  return ok(sx) && ok(sy) && (sx || sy) ? { sx: sx as -1 | 0 | 1, sy: sy as -1 | 0 | 1 } : null;
}

/** Point on the 45° grid around `from`, as far from it as `to`. */
export function snap45(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return to;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const r = (v: number) => Math.round(v * 1e9) / 1e9;
  return { x: r(from.x + len * Math.cos(a)), y: r(from.y + len * Math.sin(a)) };
}

/** The point on the segment from `from` (inside `box`) towards `to` that stays inside `box`. */
export function clampAlong(from: Point, to: Point, box: Rect): Point {
  let t = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx > 0) t = Math.min(t, (box.x1 - from.x) / dx);
  if (dx < 0) t = Math.min(t, (box.x0 - from.x) / dx);
  if (dy > 0) t = Math.min(t, (box.y1 - from.y) / dy);
  if (dy < 0) t = Math.min(t, (box.y0 - from.y) / dy);
  t = Math.max(0, t);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/**
 * Drags `handle` to `p`. Rect handles move their edges without crossing the opposite edge
 * (at least MIN_SIZE apart); line handles move an end point (45° steps with `snap`).
 * Everything stays inside `box`. Returns `o` unchanged when the result would be degenerate.
 */
export function resizeObject(o: PageObject, handle: Handle, p: Point, box: Rect, snap = false): PageObject {
  if (o.type === "line") {
    if (typeof handle !== "string") return o;
    const fixed = handle === "from" ? o.to : o.from;
    const moved = clampAlong(fixed, snap ? snap45(fixed, p) : clampPoint(p, box), box);
    if (Math.hypot(moved.x - fixed.x, moved.y - fixed.y) < MIN_SIZE) return o;
    return handle === "from" ? { ...o, from: moved } : { ...o, to: moved };
  }
  const b = objectBounds(o);
  if (!b || typeof handle === "string") return o;
  if (o.type === "signature") return { ...o, rect: resizeKeepingRatio(b, handle, p, box) };
  const q = clampPoint(p, box);
  const n = { ...b };
  if (handle.sx === -1) n.x0 = Math.min(q.x, b.x1 - MIN_SIZE);
  if (handle.sx === 1) n.x1 = Math.max(q.x, b.x0 + MIN_SIZE);
  if (handle.sy === -1) n.y0 = Math.min(q.y, b.y1 - MIN_SIZE);
  if (handle.sy === 1) n.y1 = Math.max(q.y, b.y0 + MIN_SIZE);
  if (o.type === "rect" || o.type === "ellipse") return { ...o, rect: n };
  // Highlight quads scale with the bounds.
  const sx = (n.x1 - n.x0) / (b.x1 - b.x0 || 1);
  const sy = (n.y1 - n.y0) / (b.y1 - b.y0 || 1);
  return mapPoints(o, (pt) => ({ x: n.x0 + (pt.x - b.x0) * sx, y: n.y0 + (pt.y - b.y0) * sy }));
}

/**
 * Corner drag that keeps the width/height ratio: the opposite corner stays, the size
 * follows the pointer's larger relative move, at least MIN_SIZE on the short side and
 * inside `box`.
 */
function resizeKeepingRatio(b: Rect, h: RectHandle, p: Point, box: Rect): Rect {
  if (!h.sx || !h.sy) return b;
  const w = b.x1 - b.x0;
  const ht = b.y1 - b.y0;
  const fx = h.sx === 1 ? b.x0 : b.x1;
  const fy = h.sy === 1 ? b.y0 : b.y1;
  const want = Math.max((h.sx * (p.x - fx)) / w, (h.sy * (p.y - fy)) / ht);
  const room = Math.min(
    (h.sx === 1 ? box.x1 - fx : fx - box.x0) / w,
    (h.sy === 1 ? box.y1 - fy : fy - box.y0) / ht,
  );
  const least = MIN_SIZE / Math.min(w, ht);
  const s = Math.min(Math.max(want, least), room);
  const x = fx + h.sx * w * s;
  const y = fy + h.sy * ht * s;
  return normRect({ x: fx, y: fy }, { x, y });
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Id of the topmost editable object under `p`; `tol` is the pick tolerance in pt. */
export function hitTest(objects: readonly PageObject[], p: Point, tol: number): string | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    switch (o.type) {
      case "highlight":
        if (o.quads.some((q) => contains(inflate(boundsOf(q), tol), p))) return o.id;
        break;
      case "rect":
      case "ellipse":
        if (contains(inflate(o.rect, tol + (o.stroke ? o.strokeWidth / 2 : 0)), p)) return o.id;
        break;
      case "line": {
        const head = o.arrow ? (arrowLength(o.strokeWidth) * ARROW_BASE_RATIO) / 2 : 0;
        if (distToSegment(p, o.from, o.to) <= Math.max(o.strokeWidth / 2, tol, head)) return o.id;
        break;
      }
      case "signature":
        if (contains(inflate(o.rect, tol), p)) return o.id;
        break;
    }
  }
  return null;
}

/** Shifts `r` into `box`, shrinking it when it is larger. */
function fitInBox(r: Rect, box: Rect): Rect {
  const w = Math.min(r.x1 - r.x0, box.x1 - box.x0);
  const h = Math.min(r.y1 - r.y0, box.y1 - box.y0);
  const x0 = Math.min(Math.max(r.x0, box.x0), box.x1 - w);
  const y0 = Math.min(Math.max(r.y0, box.y0), box.y1 - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

export type NewObjectInput = {
  tool: DrawTool;
  id: string;
  /** Press point (user space, inside `box`). */
  start: Point;
  /** Current point, or null for a click (moved less than the click slop on screen). */
  end: Point | null;
  props: HighlightProps | ShapeProps | LineProps;
  box: Rect;
  /** Unit user-space vectors of the screen's right and down directions (coords.screenAxes). */
  axes: { right: Point; down: Point };
  /** Shift held: lines snap to 45°. */
  snap?: boolean;
};

/** The object a draw tool makes from a press and a drag (or click); null for none. */
export function newObject(input: NewObjectInput): PageObject | null {
  const { tool, id, start, box, axes } = input;
  const end = input.end ? clampPoint(input.end, box) : null;

  if (tool === "line" || tool === "arrow") {
    const props = input.props as LineProps;
    const target = end
      ? input.snap
        ? snap45(start, end)
        : end
      : { x: start.x + axes.right.x * CLICK_LINE_LENGTH, y: start.y + axes.right.y * CLICK_LINE_LENGTH };
    const to = clampAlong(start, target, box);
    if (Math.hypot(to.x - start.x, to.y - start.y) < MIN_SIZE) return null;
    return { type: "line", id, from: start, to, arrow: tool === "arrow", ...props };
  }

  let rect: Rect;
  if (end) {
    rect = normRect(start, end);
    // A thin drag still makes a usable shape: grow to the minimum size towards the drag.
    if (rect.x1 - rect.x0 < MIN_SIZE) {
      if (end.x >= start.x) rect.x1 = rect.x0 + MIN_SIZE;
      else rect.x0 = rect.x1 - MIN_SIZE;
    }
    if (rect.y1 - rect.y0 < MIN_SIZE) {
      if (end.y >= start.y) rect.y1 = rect.y0 + MIN_SIZE;
      else rect.y0 = rect.y1 - MIN_SIZE;
    }
    rect = fitInBox(rect, box);
  } else {
    if (tool === "highlight") return null;
    const { w, h } = CLICK_SHAPE_SIZE;
    const hx = (Math.abs(axes.right.x) * w + Math.abs(axes.down.x) * h) / 2;
    const hy = (Math.abs(axes.right.y) * w + Math.abs(axes.down.y) * h) / 2;
    rect = fitInBox({ x0: start.x - hx, y0: start.y - hy, x1: start.x + hx, y1: start.y + hy }, box);
  }

  if (tool === "highlight") {
    const { x0, y0, x1, y1 } = rect;
    // Acrobat point order: upper left, upper right, lower left, lower right (SPEC 7.4).
    const quad: [Point, Point, Point, Point] = [
      { x: x0, y: y1 },
      { x: x1, y: y1 },
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ];
    return { type: "highlight", id, quads: [quad], ...(input.props as HighlightProps) };
  }
  return { type: tool, id, rect, ...(input.props as ShapeProps) };
}

/** Width of a placed signature as a fraction of the page width on screen (SPEC 6.8). */
export const SIGNATURE_WIDTH_RATIO = 0.25;

export type NewSignatureInput = {
  id: string;
  signatureId: string;
  /** Click point (user space). */
  at: Point;
  /** Image width / height as stored (upright). */
  aspect: number;
  box: Rect;
  /** Unit user-space vectors of the screen's right and down directions. */
  axes: { right: Point; down: Point };
  /** The page's display rotation: the signature is upright on screen (SPEC 5). */
  rotation: Rotation;
};

/** A signature 25% of the page width on screen, centered on the click, inside the page. */
export function newSignature(input: NewSignatureInput): PageObject {
  const { box, axes } = input;
  const pageW = Math.abs(axes.right.x) * (box.x1 - box.x0) + Math.abs(axes.right.y) * (box.y1 - box.y0);
  const pageH = Math.abs(axes.down.x) * (box.x1 - box.x0) + Math.abs(axes.down.y) * (box.y1 - box.y0);
  // Size on screen (pt), shrunk to fit the page with the ratio kept.
  let w = pageW * SIGNATURE_WIDTH_RATIO;
  let h = w / input.aspect;
  const fit = Math.min(1, pageW / w, pageH / h);
  w *= fit;
  h *= fit;
  // Screen width/height as user-space extents.
  const ex = Math.abs(axes.right.x) * w + Math.abs(axes.down.x) * h;
  const ey = Math.abs(axes.right.y) * w + Math.abs(axes.down.y) * h;
  const rect = fitInBox({ x0: input.at.x - ex / 2, y0: input.at.y - ey / 2, x1: input.at.x + ex / 2, y1: input.at.y + ey / 2 }, box);
  return { type: "signature", id: input.id, signatureId: input.signatureId, rect, rotation: input.rotation };
}
