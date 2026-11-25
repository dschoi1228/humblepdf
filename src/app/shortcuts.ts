// Keyboard shortcuts (SPEC 6.3, 6.4, 6.9), in one place. Keys are matched by `code` so they
// work with the Korean IME on.
import { TOOL_KEYS, TOOLS, type Tool } from "../editor/tools";

export type ShortcutAction =
  | "delete"
  | "undo"
  | "redo"
  | "selectAll"
  | "save"
  | "saveAs"
  | "print"
  | "newDocument"
  | "addFiles"
  | "rotateLeft"
  | "rotateRight"
  | "escape"
  | "help"
  | "copy"
  | "paste"
  | "duplicate"
  | "find"
  | "findNext"
  | "findPrevious"
  | { kind: "tool"; tool: Tool }
  /** Arrow keys: move the selected object by (dx, dy) pt in screen directions. */
  | { kind: "nudge"; dx: number; dy: number };

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** Shift+arrow step (pt); a plain arrow moves 1pt (SPEC 6.4). */
export const NUDGE_LARGE = 10;

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) {
    if (e.code === "Delete" && !e.shiftKey) return "delete";
    if (e.code === "Escape") return "escape";
    if (e.code === "F1" && !e.shiftKey) return "help";
    if (e.code === "F3") return e.shiftKey ? "findPrevious" : "findNext";
    const arrow = ARROWS[e.code];
    if (arrow) {
      const step = e.shiftKey ? NUDGE_LARGE : 1;
      return { kind: "nudge", dx: arrow[0] * step, dy: arrow[1] * step };
    }
    const tool = e.shiftKey ? undefined : TOOLS.find((t) => TOOL_KEYS[t] === e.code);
    return tool ? { kind: "tool", tool } : null;
  }
  switch (e.code) {
    case "KeyZ":
      return e.shiftKey ? "redo" : "undo";
    case "KeyY":
      return e.shiftKey ? null : "redo";
    case "KeyA":
      return e.shiftKey ? null : "selectAll";
    case "KeyC":
      return e.shiftKey ? null : "copy";
    case "KeyV":
      return e.shiftKey ? null : "paste";
    case "KeyD":
      return e.shiftKey ? null : "duplicate";
    case "KeyS":
      return e.shiftKey ? "saveAs" : "save";
    case "KeyP":
      return e.shiftKey ? null : "print";
    case "KeyF":
      return e.shiftKey ? null : "find";
    case "KeyN":
      return e.shiftKey ? null : "newDocument";
    case "KeyO":
      return e.shiftKey ? null : "addFiles";
    case "BracketLeft":
      return e.shiftKey ? null : "rotateLeft";
    case "BracketRight":
      return e.shiftKey ? null : "rotateRight";
    default:
      return null;
  }
}

/** Typing in a field or working in a dialog keeps the browser's own key handling. */
export function shortcutsBlocked(target: EventTarget | null): boolean {
  if (document.querySelector("[role=dialog], [role=alertdialog]")) return true;
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]");
}
