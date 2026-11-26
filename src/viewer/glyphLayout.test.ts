import { describe, expect, it } from "vitest";
import { itemFractions, paintedChars, type OperatorList, type TextOps } from "./glyphLayout";

const OPS: TextOps = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginText: 31,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
};
const glyph = (unicode: string, width: number, isSpace = false) => ({ unicode, width, isSpace });
const list = (...ops: [number, unknown[]][]): OperatorList => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const font = () => ({ fontMatrix: [0.001, 0, 0, 0.001, 0, 0] });
const round = (v: number) => Math.round(v * 1000) / 1000;

describe("glyph layout", () => {
  it("advances by glyph widths, character and word spacing, TJ adjustments and Tz", () => {
    const chars = paintedChars(
      list(
        [OPS.beginText, []],
        [OPS.setFont, ["F1", 10]],
        [OPS.setTextMatrix, [[1, 0, 0, 1, 100, 700]]],
        [OPS.setCharSpacing, [1]],
        [OPS.setWordSpacing, [2]],
        // "A B" then a TJ kern of -500 (half the font size forward), then "C".
        [OPS.showText, [[glyph("A", 600), glyph(" ", 250, true), glyph("B", 600), -500, glyph("C", 700)]]],
        [OPS.setHScale, [50]],
        [OPS.showText, [[glyph("D", 1000)]]],
      ),
      OPS,
      font,
    );
    expect(chars.map((c) => [c.ch, round(c.x0), round(c.x1), c.y0])).toEqual([
      ["A", 100, 106, 700],
      [" ", 107, 109.5, 700],
      ["B", 112.5, 118.5, 700],
      ["C", 124.5, 131.5, 700],
      // Horizontal scale 50%: half as wide.
      ["D", 132.5, 137.5, 700],
    ]);
  });

  it("follows Td, T*, the text matrix, the CTM, forms and save/restore", () => {
    const chars = paintedChars(
      list(
        [OPS.transform, [2, 0, 0, 2, 10, 20]],
        [OPS.save, []],
        [OPS.beginText, []],
        [OPS.setFont, ["F1", 10]],
        [OPS.setLeading, [12]],
        [OPS.moveText, [5, 50]],
        [OPS.showText, [[glyph("a", 500)]]],
        [OPS.nextLine, []],
        [OPS.showText, [[glyph("b", 500)]]],
        [OPS.restore, []],
        [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 0], null]],
        [OPS.beginText, []],
        // The font went with the restored state.
        [OPS.setFont, ["F1", 10]],
        [OPS.showText, [[glyph("c", 500)]]],
        [OPS.paintFormXObjectEnd, []],
      ),
      OPS,
      font,
    );
    expect(chars.map((c) => [c.ch, round(c.x0), round(c.y0), round(c.x1)])).toEqual([
      ["a", 20, 120, 30],
      // Next line: back to the line start, 12 down (scaled by the CTM).
      ["b", 20, 96, 30],
      // Inside the form: its matrix before the CTM.
      ["c", 210, 20, 220],
    ]);
  });

  it("shares a ligature glyph among its characters and leaves vertical text out", () => {
    const chars = paintedChars(
      list([OPS.setFont, ["F1", 10]], [OPS.showText, [[glyph("fi", 600)]]], [OPS.setFont, ["V", 10]], [OPS.showText, [[glyph("縦", 1000)]]]),
      OPS,
      (name) => (name === "V" ? { fontMatrix: [0.001, 0, 0, 0.001, 0, 0], vertical: true } : font()),
    );
    expect(chars.map((c) => [c.ch, round(c.x0), round(c.x1)])).toEqual([
      ["f", 0, 3],
      ["i", 3, 6],
    ]);
  });

  it("maps items to the painted characters, with spaces pdf.js added for gaps", () => {
    const painted = [
      { ch: "가", x0: 60, y0: 660, x1: 80, y1: 660 },
      { ch: "0", x0: 90, y0: 660, x1: 100, y1: 660 },
      { ch: "1", x0: 100, y0: 660, x1: 108, y1: 660 },
      { ch: "x", x0: 200, y0: 600, x1: 210, y1: 600 },
    ];
    // "가 01": the space is a gap between glyphs, not a glyph; it starts where "가" ends.
    const [a, b] = itemFractions(["가 01", "x"], painted);
    expect(a!.length).toBe(48);
    expect(Array.from(a!.fractions).map(round)).toEqual([0, round(20 / 48), round(30 / 48), round(40 / 48), 1]);
    expect(Array.from(b!.fractions)).toEqual([0, 1]);
  });

  it("gives up on an item whose characters were not painted", () => {
    const painted = [{ ch: "a", x0: 0, y0: 0, x1: 5, y1: 0 }];
    expect(itemFractions(["zzz", ""], painted)).toEqual([null, null]);
  });
});
