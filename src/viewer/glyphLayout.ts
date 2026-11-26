// Where each character of a text item really is (M14, D49). The text layer lays its spans out
// in a browser font and only stretches each span to the PDF width, so inside a span the
// characters drift from the glyphs (much so when the PDF font and the browser font differ,
// e.g. digits after Hangul). Here the page's operator list is walked the way pdf.js paints
// text (canvas.js showText) to get each glyph's advance, and the glyphs are matched to the
// characters of the text items. The result is, per item, the position of every character
// boundary as a fraction of the item's length along its line.

/** A glyph from the operator list (fields pdf.js sends with showText). */
type Glyph = { unicode?: string; width?: number; isSpace?: boolean };
type Matrix = [number, number, number, number, number, number];

/** pdf.js OPS codes used here (pdfjs-dist `OPS`). */
export type TextOps = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginText: number;
  setCharSpacing: number;
  setWordSpacing: number;
  setHScale: number;
  setLeading: number;
  setFont: number;
  setTextRise: number;
  moveText: number;
  setLeadingMoveText: number;
  setTextMatrix: number;
  nextLine: number;
  showText: number;
};

export type OperatorList = { fnArray: readonly number[]; argsArray: readonly unknown[] };
/** Font facts needed for advances: the font matrix and whether it writes vertically. */
export type FontInfo = { fontMatrix?: readonly number[]; vertical?: boolean } | null;

/** One character of the painted glyph stream, with its start and end on the page (user space). */
type Painted = { ch: string; x0: number; y0: number; x1: number; y1: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m1 × m2 (apply m1 first, then m2), as PDF matrices. */
const mul = (m1: readonly number[], m2: readonly number[]): Matrix => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

type State = {
  ctm: Matrix;
  tm: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  fontSize: number;
  fontDirection: number;
  fontMatrix: readonly number[];
  vertical: boolean;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
};

/** The characters pdf.js paints, in content order, with their positions. Vertical text is left out. */
export function paintedChars(ops: OperatorList, OPS: TextOps, fontOf: (name: string) => FontInfo): Painted[] {
  const out: Painted[] = [];
  let s: State = {
    ctm: IDENTITY,
    tm: IDENTITY,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
    fontSize: 0,
    fontDirection: 1,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    vertical: false,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: State[] = [];
  const moveText = (x: number, y: number) => {
    s.x = s.lineX += x;
    s.y = s.lineY += y;
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = (ops.argsArray[i] ?? []) as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...s });
        break;
      case OPS.restore:
        s = stack.pop() ?? s;
        break;
      case OPS.transform:
        s.ctm = mul(args as number[], s.ctm);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...s });
        if (Array.isArray(args[0])) s.ctm = mul(args[0] as number[], s.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        s = stack.pop() ?? s;
        break;
      case OPS.beginText:
        s.tm = IDENTITY;
        s.x = s.lineX = s.y = s.lineY = 0;
        break;
      case OPS.setCharSpacing:
        s.charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        s.wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        s.hScale = (Number(args[0]) || 0) / 100;
        break;
      case OPS.setLeading:
        s.leading = -(Number(args[0]) || 0);
        break;
      case OPS.setTextRise:
        s.rise = Number(args[0]) || 0;
        break;
      case OPS.setFont: {
        const font = fontOf(String(args[0]));
        let size = Number(args[1]) || 0;
        s.fontDirection = size < 0 ? -1 : 1;
        size = Math.abs(size);
        s.fontSize = size;
        s.fontMatrix = font?.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
        s.vertical = !!font?.vertical;
        break;
      }
      case OPS.moveText:
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setLeadingMoveText:
        s.leading = Number(args[1]) || 0;
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setTextMatrix: {
        const m = (Array.isArray(args[0]) ? args[0] : args) as number[];
        s.tm = [m[0], m[1], m[2], m[3], m[4], m[5]];
        s.x = s.lineX = s.y = s.lineY = 0;
        break;
      }
      case OPS.nextLine:
        moveText(0, s.leading);
        break;
      case OPS.showText:
        showText((args[0] ?? []) as (Glyph | number)[]);
        break;
    }
  }
  return out;

  function showText(glyphs: (Glyph | number)[]) {
    if (!s.fontSize) return;
    const h = s.hScale * s.fontDirection;
    const advanceScale = s.fontSize * (s.fontMatrix[0] || 0.001);
    // Text space -> user space for this run.
    const m = mul(s.tm, s.ctm);
    let x = 0;
    for (const g of glyphs) {
      if (typeof g === "number") {
        // TJ adjustment (thousandths of the font size), as pdf.js applies it.
        x += (s.vertical ? 1 : -1) * ((g * s.fontSize) / 1000);
        continue;
      }
      const spacing = (g.isSpace ? s.wordSpacing : 0) + s.charSpacing;
      const glyphWidth = (g.width ?? 0) * advanceScale;
      const advance = glyphWidth + spacing * s.fontDirection;
      if (!s.vertical) {
        const [x0, y0] = apply(m, s.x + x * h, s.y + s.rise);
        const [x1, y1] = apply(m, s.x + (x + glyphWidth) * h, s.y + s.rise);
        const u = g.unicode ?? "";
        // A ligature ("fi") or a surrogate pair: its characters share the glyph evenly.
        const n = u.length;
        for (let k = 0; k < n; k++) {
          out.push({
            ch: u[k],
            x0: x0 + ((x1 - x0) * k) / n,
            y0: y0 + ((y1 - y0) * k) / n,
            x1: x0 + ((x1 - x0) * (k + 1)) / n,
            y1: y0 + ((y1 - y0) * (k + 1)) / n,
          });
        }
      }
      x += advance;
    }
    if (s.vertical) s.y -= x;
    else s.x += x * h;
  }
}

const SPACE = /\s/u;
/** Painted characters skipped at most while looking for the next character of an item. */
const RESYNC = 8;

/**
 * For each text item: its painted length on the page (user space units, from its first
 * character's start to its last one's end) and the boundaries of its characters (UTF-16
 * units, `str.length + 1` values) as fractions of that length. Null for an item whose
 * characters could not be matched to painted glyphs (then the browser's layout is used).
 */
export function itemFractions(
  items: readonly string[],
  painted: readonly Painted[],
): ({ fractions: Float64Array; length: number } | null)[] {
  let g = 0;
  return items.map((str) => {
    if (!str.length) return null;
    // Start of each character, and the end of the last one, on the page.
    const starts: ([number, number] | null)[] = [];
    let end: [number, number] | null = null;
    let ok = true;
    for (const ch of str) {
      // `for…of` walks code points; boundaries are per UTF-16 unit.
      for (let u = 0; u < ch.length; u++) {
        const unit = ch[u];
        let k = g;
        while (k < painted.length && k < g + RESYNC && painted[k].ch !== unit) k++;
        if (k < painted.length && painted[k].ch === unit) {
          g = k + 1;
          starts.push([painted[k].x0, painted[k].y0]);
          end = [painted[k].x1, painted[k].y1];
        } else if (SPACE.test(unit)) {
          // A space pdf.js put in for a gap: no glyph; it starts where the last one ended.
          starts.push(end);
        } else {
          ok = false;
          starts.push(null);
        }
      }
    }
    const first = starts.find((p) => p !== null);
    if (!ok || !first || !end) return null;
    const dx = end[0] - first[0];
    const dy = end[1] - first[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return null;
    const out = new Float64Array(str.length + 1);
    let last = 0;
    for (let j = 0; j < str.length; j++) {
      const p = starts[j] ?? starts.slice(j).find((q) => q !== null) ?? end;
      const t = ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / len2;
      last = Math.min(1, Math.max(last, t));
      out[j] = last;
    }
    out[str.length] = 1;
    return { fractions: out, length: Math.sqrt(len2) };
  });
}
