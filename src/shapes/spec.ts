// Numbers that define how objects look (SPEC 6.6, 6.7). Must equal
// crates/core/src/shape_spec.rs; crates/core/tests/shape_spec.rs checks this file.
export const ARROW_MIN_LENGTH = 8;
export const ARROW_LENGTH_PER_WIDTH = 4;
export const ARROW_BASE_RATIO = 0.6;
export const LINE_HEIGHT = 1.3;
export const ELLIPSE_KAPPA = 0.5522847498307936;
export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 12;

export function arrowLength(strokeWidth: number): number {
  return Math.max(ARROW_MIN_LENGTH, ARROW_LENGTH_PER_WIDTH * strokeWidth);
}
