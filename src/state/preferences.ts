// Recent settings kept between runs (SPEC M7, D38): the properties of each tool, the
// thumbnail panel and the zoom mode. Stored in WebView localStorage like the UI language
// (D27). No document or signature data. Values are checked on read; anything malformed
// falls back to the defaults.
import { DEFAULT_PROPS, OPACITIES, type Rgb, type ToolProps } from "../editor/tools";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../editor/textLayout";
import { MAX_STROKE_WIDTH, MIN_STROKE_WIDTH } from "../shapes/spec";
import type { ZoomMode } from "./viewStore";
import { MAX_SCALE, MIN_SCALE } from "../viewer/layout";

export const PREFERENCES_KEY = "humblepdf.preferences.v1";

export type Preferences = {
  toolProps: ToolProps;
  thumbnailsOpen: boolean;
  zoomMode: ZoomMode;
  /** Scale of the custom zoom mode. */
  scale: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  toolProps: DEFAULT_PROPS,
  thumbnailsOpen: true,
  zoomMode: "fitWidth",
  scale: 1,
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isRgb = (v: unknown): v is Rgb => Array.isArray(v) && v.length === 3 && v.every((c) => inRange(c, 0, 1));
const isRgbOrNull = (v: unknown): v is Rgb | null => v === null || isRgb(v);
const opacity = (v: unknown) => inRange(v, OPACITIES[0], 1);
const width = (v: unknown) => inRange(v, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH);

/** One tool's stored properties, or the default when anything is off. */
function toolPropsFrom<T extends keyof ToolProps>(tool: T, raw: unknown): ToolProps[T] {
  const d = DEFAULT_PROPS[tool];
  if (!isObj(raw)) return d;
  switch (tool) {
    case "highlight":
      return (isRgb(raw.color) && opacity(raw.opacity) ? { color: raw.color, opacity: raw.opacity } : d) as ToolProps[T];
    case "rect":
    case "ellipse": {
      const ok =
        isRgbOrNull(raw.stroke) && isRgbOrNull(raw.fill) && (raw.stroke !== null || raw.fill !== null) && width(raw.strokeWidth) && opacity(raw.opacity);
      return (ok ? { stroke: raw.stroke, fill: raw.fill, strokeWidth: raw.strokeWidth, opacity: raw.opacity } : d) as ToolProps[T];
    }
    case "line":
    case "arrow":
      return (isRgb(raw.stroke) && width(raw.strokeWidth) && opacity(raw.opacity)
        ? { stroke: raw.stroke, strokeWidth: raw.strokeWidth, opacity: raw.opacity }
        : d) as ToolProps[T];
    case "text":
      return (isRgb(raw.color) && inRange(raw.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE)
        ? { color: raw.color, fontSize: raw.fontSize }
        : d) as ToolProps[T];
    default:
      return d;
  }
}

/** Preferences from their stored text; defaults for whatever is missing or invalid. */
export function parsePreferences(text: string | null): Preferences {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (!isObj(raw)) return DEFAULT_PREFERENCES;
  const props = isObj(raw.toolProps) ? raw.toolProps : {};
  const toolProps = Object.fromEntries(
    (Object.keys(DEFAULT_PROPS) as (keyof ToolProps)[]).map((t) => [t, toolPropsFrom(t, props[t])]),
  ) as ToolProps;
  const zoomMode: ZoomMode = raw.zoomMode === "fitPage" || raw.zoomMode === "custom" ? raw.zoomMode : "fitWidth";
  return {
    toolProps,
    thumbnailsOpen: typeof raw.thumbnailsOpen === "boolean" ? raw.thumbnailsOpen : true,
    zoomMode,
    scale: inRange(raw.scale, MIN_SCALE, MAX_SCALE) ? raw.scale : 1,
  };
}

export function serializePreferences(p: Preferences): string {
  return JSON.stringify(p);
}

export function loadPreferences(): Preferences {
  try {
    return parsePreferences(globalThis.localStorage?.getItem(PREFERENCES_KEY) ?? null);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences): void {
  try {
    globalThis.localStorage?.setItem(PREFERENCES_KEY, serializePreferences(p));
  } catch {
    // Settings still apply for this session.
  }
}
