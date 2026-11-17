// Editing tools, palettes and default properties (SPEC 6.4-6.6, D29).
import type { PageObject } from "../bindings/PageObject";

export type Rgb = [number, number, number];

export type DrawTool = "highlight" | "rect" | "ellipse" | "line" | "arrow";
export type Tool = "select" | DrawTool;

export const TOOLS: readonly Tool[] = ["select", "highlight", "rect", "ellipse", "line", "arrow"];
export const DRAW_TOOLS: readonly DrawTool[] = ["highlight", "rect", "ellipse", "line", "arrow"];

/** Single-key shortcut of each tool, matched by `KeyboardEvent.code`. */
export const TOOL_KEYS: Record<Tool, string> = {
  select: "KeyV",
  highlight: "KeyH",
  rect: "KeyR",
  ellipse: "KeyO",
  line: "KeyL",
  arrow: "KeyA",
};

/** Tools that stay active after an object is made (user decision, D29). */
export const STICKY_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["highlight"]);

export type HighlightColor = "yellow" | "green" | "pink" | "sky";
export const HIGHLIGHT_COLORS: Record<HighlightColor, Rgb> = {
  yellow: [1, 0.92, 0.23],
  green: [0.56, 0.93, 0.56],
  pink: [1, 0.6, 0.8],
  sky: [0.53, 0.81, 0.98],
};

export type PaletteColor = "black" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "white";
export const PALETTE: Record<PaletteColor, Rgb> = {
  black: [0, 0, 0],
  red: [0.898, 0.224, 0.208],
  orange: [0.984, 0.549, 0],
  yellow: [0.992, 0.847, 0.208],
  green: [0.263, 0.627, 0.278],
  blue: [0.118, 0.533, 0.898],
  purple: [0.557, 0.141, 0.667],
  white: [1, 1, 1],
};

export const STROKE_WIDTHS: readonly number[] = [0.5, 1, 2, 3, 4, 6, 8, 12];
export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 12;
/** 10% .. 100% in 10% steps. */
export const OPACITIES: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export type HighlightProps = { color: Rgb; opacity: number };
export type ShapeProps = { stroke: Rgb | null; strokeWidth: number; fill: Rgb | null; opacity: number };
export type LineProps = { stroke: Rgb; strokeWidth: number; opacity: number };

/** Any property change; each object kind takes the fields it has. */
export type PropsPatch = { color?: Rgb; stroke?: Rgb | null; strokeWidth?: number; fill?: Rgb | null; opacity?: number };

export type ToolProps = {
  highlight: HighlightProps;
  rect: ShapeProps;
  ellipse: ShapeProps;
  line: LineProps;
  arrow: LineProps;
};

export const DEFAULT_PROPS: ToolProps = {
  highlight: { color: HIGHLIGHT_COLORS.yellow, opacity: 0.4 },
  rect: { stroke: PALETTE.red, strokeWidth: 2, fill: null, opacity: 1 },
  ellipse: { stroke: PALETTE.red, strokeWidth: 2, fill: null, opacity: 1 },
  line: { stroke: PALETTE.red, strokeWidth: 2, opacity: 1 },
  arrow: { stroke: PALETTE.red, strokeWidth: 2, opacity: 1 },
};

/** The tool that makes objects like `o`, or null for objects M3 does not edit. */
export function toolOf(o: PageObject): DrawTool | null {
  switch (o.type) {
    case "highlight":
    case "rect":
    case "ellipse":
      return o.type;
    case "line":
      return o.arrow ? "arrow" : "line";
    default:
      return null;
  }
}

/** The properties of `o` in the shape its tool uses. */
export function propsOf(o: PageObject): PropsPatch {
  switch (o.type) {
    case "highlight":
      return { color: o.color, opacity: o.opacity };
    case "rect":
    case "ellipse":
      return { stroke: o.stroke, strokeWidth: o.strokeWidth, fill: o.fill, opacity: o.opacity };
    case "line":
      return { stroke: o.stroke, strokeWidth: o.strokeWidth, opacity: o.opacity };
    default:
      return {};
  }
}

/**
 * Applies a property patch to an object of the matching kind. A shape keeps at least a
 * stroke or a fill (an object with neither would be invisible).
 */
export function withProps(o: PageObject, patch: PropsPatch): PageObject {
  switch (o.type) {
    case "highlight":
      return { ...o, color: patch.color ?? o.color, opacity: patch.opacity ?? o.opacity };
    case "rect":
    case "ellipse": {
      const stroke = patch.stroke !== undefined ? patch.stroke : o.stroke;
      const fill = patch.fill !== undefined ? patch.fill : o.fill;
      if (!stroke && !fill) return o;
      return { ...o, stroke, fill, strokeWidth: patch.strokeWidth ?? o.strokeWidth, opacity: patch.opacity ?? o.opacity };
    }
    case "line":
      return {
        ...o,
        stroke: patch.stroke ?? o.stroke,
        strokeWidth: patch.strokeWidth ?? o.strokeWidth,
        opacity: patch.opacity ?? o.opacity,
      };
    default:
      return o;
  }
}

export function sameColor(a: Rgb | null | undefined, b: Rgb | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
}
