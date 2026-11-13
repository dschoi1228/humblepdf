// Object geometry shared by the overlay. Mirrors crates/core/src/export/appearance.rs
// using the SPEC numbers in ./spec.ts, so the screen and the PDF draw the same shapes.
import type { Line } from "../bindings/Line";
import type { Point } from "../bindings/Point";
import type { Rect } from "../bindings/Rect";
import type { Rotation } from "../bindings/Rotation";
import type { Matrix } from "../coords";
import { ARROW_BASE_RATIO, arrowLength } from "./spec";

export type LineGeometry = {
  /** End of the drawn segment: the arrowhead base center, or `to`. */
  lineEnd: Point;
  /** Arrowhead: tip, base left, base right. */
  head: [Point, Point, Point] | null;
};

export function lineGeometry(l: Line): LineGeometry {
  if (!l.arrow) return { lineEnd: l.to, head: null };
  const dx = l.to.x - l.from.x;
  const dy = l.to.y - l.from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { lineEnd: l.to, head: null };
  const ux = dx / len;
  const uy = dy / len;
  const headLen = arrowLength(l.strokeWidth);
  const half = (headLen * ARROW_BASE_RATIO) / 2;
  const base = { x: l.to.x - ux * headLen, y: l.to.y - uy * headLen };
  const px = -uy;
  const py = ux;
  return {
    lineEnd: base,
    head: [
      l.to,
      { x: base.x + px * half, y: base.y + py * half },
      { x: base.x - px * half, y: base.y - py * half },
    ],
  };
}

/** cos/sin of a counter-clockwise rotation. */
export function ccw(r: Rotation): [number, number] {
  switch (r) {
    case 90:
      return [0, 1];
    case 180:
      return [-1, 0];
    case 270:
      return [0, -1];
    default:
      return [1, 0];
  }
}

/** Maps the unit square (image upright, v up) into `r` rotated counter-clockwise. */
export function rotatedImageMatrix(r: Rect, rot: Rotation): Matrix {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  switch (rot) {
    case 90:
      return [0, h, -w, 0, r.x1, r.y0];
    case 180:
      return [-w, 0, 0, -h, r.x1, r.y1];
    case 270:
      return [0, -h, w, 0, r.x0, r.y1];
    default:
      return [w, 0, 0, h, r.x0, r.y0];
  }
}
