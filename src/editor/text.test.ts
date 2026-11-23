// Text objects (SPEC 6.7, D33): layout box, editing geometry, typed lines, properties.
import { describe, expect, it } from "vitest";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { shortcutFor } from "../app/shortcuts";
import { LINE_HEIGHT } from "../shapes/spec";
import { handlesOf, hitTest, keepInside, moveObject, objectBounds, resizeObject } from "./geometry";
import { linesOf, setTextMeasure, TEXT_ASCENT, TEXT_DESCENT, textBounds } from "./textLayout";
import { propsOf, PALETTE, toolOf, withProps } from "./tools";

type Text = Extract<PageObject, { type: "text" }>;
const box = { x0: 0, y0: 0, x1: 600, y1: 800 };
// One em per character keeps the arithmetic exact.
setTextMeasure((line, size) => [...line].length * size);
const text = (rotation: Rotation, lines = ["abcd", "ab"]): Text => ({
  type: "text",
  id: "t",
  origin: { x: 100, y: 500 },
  rotation,
  fontSize: 10,
  color: [0, 0, 0],
  lines,
});

describe("textBounds", () => {
  const up = TEXT_ASCENT * 10;
  const down = LINE_HEIGHT * 10 + TEXT_DESCENT * 10;
  it("rotation 0: widest line, from the first ascent to the last descent", () => {
    const b = textBounds(text(0));
    expect(b.x0).toBeCloseTo(100, 9);
    expect(b.x1).toBeCloseTo(140, 9);
    expect(b.y1).toBeCloseTo(500 + up, 9);
    expect(b.y0).toBeCloseTo(500 - down, 9);
  });
  it("rotation 90: the text runs up the page", () => {
    const b = textBounds(text(90));
    expect(b.y0).toBeCloseTo(500, 9);
    expect(b.y1).toBeCloseTo(540, 9);
    expect(b.x0).toBeCloseTo(100 - up, 9);
    expect(b.x1).toBeCloseTo(100 + down, 9);
  });
  it("rotations 180 and 270 mirror 0 and 90", () => {
    const b180 = textBounds(text(180));
    expect(b180.x1).toBeCloseTo(100, 9);
    expect(b180.x0).toBeCloseTo(60, 9);
    const b270 = textBounds(text(270));
    expect(b270.y1).toBeCloseTo(500, 9);
    expect(b270.y0).toBeCloseTo(460, 9);
  });
  it("is what objectBounds and hitTest use", () => {
    expect(objectBounds(text(0))).toEqual(textBounds(text(0)));
    expect(hitTest([text(0)], { x: 120, y: 495 }, 0)).toBe("t");
    expect(hitTest([text(0)], { x: 200, y: 495 }, 0)).toBeNull();
  });
});

describe("editing a text", () => {
  it("moves its origin and stays on the page", () => {
    expect(moveObject(text(0), 10, -20, box)).toMatchObject({ origin: { x: 110, y: 480 } });
    const far = moveObject(text(0), 1000, 0, box) as Text;
    expect(textBounds(far).x1).toBeCloseTo(600, 9);
  });
  it("a text that runs off the page is shifted back inside", () => {
    // 55 characters of 10pt from x=100: 550pt wide, ends at 650 > 600.
    const long = { ...text(0, ["x".repeat(55)]) };
    const inside = keepInside(long, box) as Text;
    expect(textBounds(inside).x1).toBeCloseTo(600, 9);
    expect(textBounds(inside).x0).toBeCloseTo(50, 9);
    // At 180 degrees the text runs towards -x: the same rule applies.
    const r180 = keepInside({ ...text(180, ["x".repeat(20)]), origin: { x: 100, y: 500 } }, box) as Text;
    expect(textBounds(r180).x0).toBeCloseTo(0, 9);
    // Already inside: unchanged.
    const ok = text(0);
    expect(keepInside(ok, box)).toBe(ok);
  });

  it("has no handles and cannot be resized", () => {
    const t = text(0);
    expect(handlesOf(t)).toEqual([]);
    expect(resizeObject(t, { sx: 1, sy: 1 }, { x: 0, y: 0 }, box)).toBe(t);
  });
  it("size and color are its properties", () => {
    const t = text(0);
    expect(toolOf(t)).toBe("text");
    expect(propsOf(t)).toEqual({ fontSize: 10, color: [0, 0, 0] });
    expect(withProps(t, { fontSize: 24, color: PALETTE.red, opacity: 0.5 })).toMatchObject({ fontSize: 24, color: PALETTE.red });
    expect(withProps(t, { fontSize: 24 })).not.toHaveProperty("opacity");
  });
});

describe("typed lines", () => {
  it("keeps inner blank lines, drops trailing ones, and is null when blank", () => {
    expect(linesOf("가나\n\n다")).toEqual(["가나", "", "다"]);
    expect(linesOf("가나\r\n다\n\n  \n")).toEqual(["가나", "다"]);
    expect(linesOf("  \n \n")).toBeNull();
    expect(linesOf("")).toBeNull();
  });
  it("T picks the text tool", () => {
    expect(shortcutFor({ code: "KeyT", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toEqual({ kind: "tool", tool: "text" });
  });
});
