// The reading frame of a text layer turned by a multiple of 90°: x grows along the line,
// y down the page, whatever the page rotation (M12, M13). Pure functions on client pixels;
// conversion to page user space stays in the coords module.

/** A box in the reading frame. */
export type Box = { x0: number; y0: number; x1: number; y1: number };
type ClientPoint = { x: number; y: number };
/** Four client points: upper left, upper right, lower left, lower right as the text reads. */
export type ClientQuad = [ClientPoint, ClientPoint, ClientPoint, ClientPoint];

const norm = (rotation: number) => ((rotation % 360) + 360) % 360;

/** Client point -> reading frame of a layer turned by `rotation` (multiple of 90). */
export function toReading(rotation: number, x: number, y: number): [number, number] {
  switch (norm(rotation)) {
    case 90:
      return [y, -x];
    case 180:
      return [-x, -y];
    case 270:
      return [-y, x];
    default:
      return [x, y];
  }
}

/** Reading frame -> client point (the inverse of `toReading`). */
export function fromReading(rotation: number, x: number, y: number): [number, number] {
  return toReading(360 - norm(rotation), x, y);
}

/** Bounding box in the reading frame of a client rectangle. */
export function readingBox(rotation: number, r: { left: number; top: number; right: number; bottom: number }): Box {
  const [ax, ay] = toReading(rotation, r.left, r.top);
  const [bx, by] = toReading(rotation, r.right, r.bottom);
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/**
 * Joins boxes on the same line (vertical overlap of at least half the shorter box) into one
 * box each, gaps between words included. Lines come out top to bottom.
 */
export function mergeLines(boxes: readonly Box[]): Box[] {
  const lines: Box[] = [];
  for (const b of [...boxes].sort((a, c) => a.y0 - c.y0 || a.x0 - c.x0)) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.y1, b.y1) - Math.max(l.y0, b.y0);
      return overlap >= Math.min(l.y1 - l.y0, b.y1 - b.y0) / 2;
    });
    if (line) {
      line.x0 = Math.min(line.x0, b.x0);
      line.x1 = Math.max(line.x1, b.x1);
      line.y0 = Math.min(line.y0, b.y0);
      line.y1 = Math.max(line.y1, b.y1);
    } else {
      lines.push({ ...b });
    }
  }
  return lines;
}

/** Client corners of a reading-frame box in quad order (upper left, upper right, lower left, lower right). */
export function readingQuad(rotation: number, b: Box): ClientQuad {
  const pt = (x: number, y: number) => {
    const [cx, cy] = fromReading(rotation, x, y);
    return { x: cx, y: cy };
  };
  return [pt(b.x0, b.y0), pt(b.x1, b.y0), pt(b.x0, b.y1), pt(b.x1, b.y1)];
}
