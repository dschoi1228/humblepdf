// The only place that converts between page user space (pt, y up) and screen pixels
// (SPEC 5, D6). The transform is the pdf.js viewport transform: for PDF pages it must
// equal `page.getViewport({ scale, rotation }).transform`; image pages use the same
// formula with their own box.
import type { Point } from "../bindings/Point";
import type { Rect } from "../bindings/Rect";
import type { Rotation } from "../bindings/Rotation";

/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

export type PageTransform = {
  /** user space -> screen pixels (CSS px at the given scale) */
  matrix: Matrix;
  width: number;
  height: number;
};

/** (baseRotation + userRotation) % 360, clockwise. */
export function displayRotation(base: Rotation, user: Rotation): Rotation {
  return ((base + user) % 360) as Rotation;
}

/** Same computation as pdf.js `PageViewport` with offsetX = offsetY = 0, dontFlip = false. */
export function viewportTransform(box: Rect, rotation: Rotation, scale: number): PageTransform {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  let a: number, b: number, c: number, d: number;
  switch (rotation) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let offX: number, offY: number, width: number, height: number;
  if (a === 0) {
    offX = Math.abs(cy - box.y0) * scale;
    offY = Math.abs(cx - box.x0) * scale;
    width = (box.y1 - box.y0) * scale;
    height = (box.x1 - box.x0) * scale;
  } else {
    offX = Math.abs(cx - box.x0) * scale;
    offY = Math.abs(cy - box.y0) * scale;
    width = (box.x1 - box.x0) * scale;
    height = (box.y1 - box.y0) * scale;
  }
  const matrix: Matrix = [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    offX - a * scale * cx - c * scale * cy,
    offY - b * scale * cx - d * scale * cy,
  ];
  return { matrix, width, height };
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function toScreen(t: PageTransform, p: Point): Point {
  return apply(t.matrix, p);
}

export function toUser(t: PageTransform, p: Point): Point {
  return apply(invert(t.matrix), p);
}

/** CSS `matrix(...)` for an SVG group that draws user-space content on screen. */
export function cssMatrix(m: Matrix): string {
  return `matrix(${m.join(" ")})`;
}

/** A screen-pixel displacement as a user-space displacement (no translation). */
export function deltaToUser(t: PageTransform, dx: number, dy: number): Point {
  const m = invert(t.matrix);
  return { x: m[0] * dx + m[2] * dy, y: m[1] * dx + m[3] * dy };
}

/** Unit user-space vectors that point right and down on screen. */
export function screenAxes(t: PageTransform): { right: Point; down: Point } {
  const unit = (p: Point) => {
    const len = Math.hypot(p.x, p.y);
    return { x: p.x / len, y: p.y / len };
  };
  return { right: unit(deltaToUser(t, 1, 0)), down: unit(deltaToUser(t, 0, 1)) };
}

/** Screen-pixel rectangle covering a user-space rectangle. */
export function rectToScreen(t: PageTransform, r: Rect): Rect {
  const a = apply(t.matrix, { x: r.x0, y: r.y0 });
  const b = apply(t.matrix, { x: r.x1, y: r.y1 });
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}
