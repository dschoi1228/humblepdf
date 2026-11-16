// Keyboard shortcuts (SPEC 6.3, 6.4, 6.9), in one place. Keys are matched by `code` so they
// work with the Korean IME on.

export type ShortcutAction =
  | "delete"
  | "undo"
  | "redo"
  | "selectAll"
  | "save"
  | "saveAs"
  | "newDocument"
  | "addFiles"
  | "rotateLeft"
  | "rotateRight";

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return e.code === "Delete" && !e.shiftKey ? "delete" : null;
  switch (e.code) {
    case "KeyZ":
      return e.shiftKey ? "redo" : "undo";
    case "KeyY":
      return e.shiftKey ? null : "redo";
    case "KeyA":
      return e.shiftKey ? null : "selectAll";
    case "KeyS":
      return e.shiftKey ? "saveAs" : "save";
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
