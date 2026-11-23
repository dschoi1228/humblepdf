// Text object layout shared by selection, hit testing and the text editor (SPEC 6.7).
// Lines are LINE_HEIGHT x size apart; widths are default advances (no kerning). The
// vertical metrics are those of the bundled fonts (both: ascent 1949, descent 494 per
// 2048 units), as the core uses for the annotation box.
import type { PageObject } from "../bindings/PageObject";
import type { Point } from "../bindings/Point";
import type { Rect } from "../bindings/Rect";
import type { Rotation } from "../bindings/Rotation";
import { ccw } from "../shapes/geometry";
import { LINE_HEIGHT } from "../shapes/spec";

export const TEXT_ASCENT = 1949 / 2048;
export const TEXT_DESCENT = 494 / 2048;
export const FONT_SIZES: readonly number[] = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 72;

type Text = Extract<PageObject, { type: "text" }>;

/** Width of one line in pt at `size`. Replaced at start by a canvas measurement. */
let measureLine = (line: string, size: number): number => [...line].length * size * 0.6;

export function setTextMeasure(fn: (line: string, size: number) => number): void {
  measureLine = fn;
}

export function lineWidth(line: string, size: number): number {
  return measureLine(line, size);
}

/** Point at local (lx, ly) of a text box: x along the baseline, y up, rotated CCW. */
function local(t: { origin: Point; rotation: Rotation }, lx: number, ly: number): Point {
  const [cos, sin] = ccw(t.rotation);
  return { x: t.origin.x + cos * lx - sin * ly, y: t.origin.y + sin * lx + cos * ly };
}

/** The text's box in user space: widest line, first ascent to last descent. */
export function textBounds(t: Text): Rect {
  const size = t.fontSize;
  const w = Math.max(size * 0.3, ...t.lines.map((l) => lineWidth(l, size)));
  const lines = Math.max(1, t.lines.length);
  const y0 = -(lines - 1) * LINE_HEIGHT * size - TEXT_DESCENT * size;
  const y1 = TEXT_ASCENT * size;
  const pts = [local(t, 0, y0), local(t, w, y0), local(t, 0, y1), local(t, w, y1)];
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

/** Canvas measurement with the bundled fonts (call after they are loaded). */
export function canvasMeasure(fontFamily: string): (line: string, size: number) => number {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fontKerning = "none";
  const cache = new Map<string, number>();
  return (line, size) => {
    const key = `${size}|${line}`;
    let w = cache.get(key);
    if (w === undefined) {
      // Measure at a large size for precision, then scale.
      ctx.font = `100px ${fontFamily}`;
      w = (ctx.measureText(line).width * size) / 100;
      if (cache.size > 5000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

/** Lines of a typed value, without trailing blank lines; null when there is no text. */
export function linesOf(value: string): string[] | null {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.some((l) => l.trim()) ? lines : null;
}
