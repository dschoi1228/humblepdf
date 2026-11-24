// Pure helpers for creating signatures (SPEC 6.8, D44): the drawing pad's ink and strokes,
// cropping a drawing to its ink, and the default of the white removal switch.

/** Ink colours of the drawing pad: black and ballpoint blue. */
export const INK_COLORS = { black: "#111111", blue: "#1d3a9e" } as const;
export type InkColor = keyof typeof INK_COLORS;

/** Default strength of the white background removal (slider 0..100). */
export const DEFAULT_STRENGTH = 50;
/** Line width of the pad's strokes, in CSS pixels. */
export const STROKE_WIDTH = 2.6;
/** Transparent margin kept around the ink when a drawing is saved, in canvas pixels. */
export const CROP_PADDING = 12;

/** Line width at a point: a pen follows its pressure (0.5x to 1.5x); mouse and touch are even. */
export function strokeWidth(base: number, pointerType: string, pressure: number): number {
  if (pointerType !== "pen" || !(pressure > 0)) return base;
  return base * (0.5 + Math.min(1, pressure));
}

export type Box = { x: number; y: number; w: number; h: number };

/** Box around the pixels with ink (alpha > 0) in RGBA data, padded and kept inside; null when empty. */
export function inkBounds(data: ArrayLike<number>, width: number, height: number, pad: number): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(width, x1 + 1 + pad) - x, h: Math.min(height, y1 + 1 + pad) - y };
}

/**
 * Whether an image already has transparent parts. The white removal switch starts on for
 * images without any (photos, scans, JPEG) and off for transparent PNGs.
 */
export function hasTransparency(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}
