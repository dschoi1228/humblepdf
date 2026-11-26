import { describe, expect, it } from "vitest";
import { DEFAULT_PROPS, PALETTE } from "../editor/tools";
import { DEFAULT_PREFERENCES, MAX_SIGNATURE_WIDTHS, parsePreferences, serializePreferences, signatureWidthsFrom, type Preferences } from "./preferences";

describe("preferences (D38)", () => {
  const custom: Preferences = {
    toolProps: {
      ...DEFAULT_PROPS,
      rect: { stroke: null, fill: PALETTE.green, strokeWidth: 6, opacity: 0.5 },
      text: { fontSize: 24, color: PALETTE.blue },
      highlight: { color: [0.53, 0.81, 0.98], opacity: 0.3 },
    },
    thumbnailsOpen: false,
    zoomMode: "custom",
    scale: 1.5,
    signatureWidths: { "sg-a": 90, "sg-b": 120.5 },
  };

  it("round-trips", () => {
    expect(parsePreferences(serializePreferences(custom))).toEqual(custom);
  });

  it("falls back to the defaults for missing or broken data", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("[1,2]")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("{}")).toEqual(DEFAULT_PREFERENCES);
  });

  it("replaces only the invalid parts", () => {
    const bad = JSON.parse(serializePreferences(custom));
    bad.toolProps.rect.strokeWidth = 13; // above 12
    bad.toolProps.line.stroke = [2, 0, 0]; // color out of range
    bad.toolProps.ellipse = { stroke: null, fill: null, strokeWidth: 2, opacity: 1 }; // invisible
    bad.toolProps.text.fontSize = 100;
    bad.scale = 99;
    bad.zoomMode = "sideways";
    const p = parsePreferences(JSON.stringify(bad));
    expect(p.toolProps.rect).toEqual(DEFAULT_PROPS.rect);
    expect(p.toolProps.line).toEqual(DEFAULT_PROPS.line);
    expect(p.toolProps.ellipse).toEqual(DEFAULT_PROPS.ellipse);
    expect(p.toolProps.text).toEqual(DEFAULT_PROPS.text);
    expect(p.toolProps.highlight).toEqual(custom.toolProps.highlight);
    expect(p.thumbnailsOpen).toBe(false);
    expect(p.zoomMode).toBe("fitWidth");
    expect(p.scale).toBe(1);
    expect(p.signatureWidths).toEqual(custom.signatureWidths);
  });

  it("keeps only valid signature widths, newest last (D50)", () => {
    expect(signatureWidthsFrom([90])).toEqual({});
    expect(signatureWidthsFrom({ a: 90, b: 2, c: "90", d: 1e9, e: Number.NaN, f: 4 })).toEqual({ a: 90, f: 4 });
    const many = Object.fromEntries(Array.from({ length: MAX_SIGNATURE_WIDTHS + 5 }, (_, i) => [`sg-${i}`, 100 + i]));
    const kept = signatureWidthsFrom(many);
    expect(Object.keys(kept)).toHaveLength(MAX_SIGNATURE_WIDTHS);
    expect(kept["sg-0"]).toBeUndefined();
    expect(kept[`sg-${MAX_SIGNATURE_WIDTHS + 4}`]).toBe(100 + MAX_SIGNATURE_WIDTHS + 4);
  });
});
