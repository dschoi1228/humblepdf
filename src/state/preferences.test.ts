import { describe, expect, it } from "vitest";
import { DEFAULT_PROPS, PALETTE } from "../editor/tools";
import { DEFAULT_PREFERENCES, parsePreferences, serializePreferences, type Preferences } from "./preferences";

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
  });
});
