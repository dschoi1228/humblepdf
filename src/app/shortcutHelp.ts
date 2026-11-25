// The shortcut help table (F1, M7). Every keyboard row carries the key events that trigger
// it, and a unit test checks them against `shortcutFor`, so the help cannot drift from the
// real key map.
import type { Tool } from "../editor/tools";
import type { ShortcutAction } from "./shortcuts";

export type HelpGroup = "file" | "edit" | "pages" | "tools" | "text" | "view";

export type HelpAction =
  | "addFiles"
  | "newDocument"
  | "save"
  | "saveAs"
  | "print"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "duplicate"
  | "deleteObject"
  | "nudge"
  | "nudgeLarge"
  | "escape"
  | "selectAll"
  | "rotate"
  | "deletePages"
  | "tools"
  | "textNewLine"
  | "textCommit"
  | "textCancel"
  | "textEdit"
  | "zoom"
  | "help";

type Probe = { code: string; ctrl?: boolean; shift?: boolean };

export type HelpEntry = {
  group: HelpGroup;
  action: HelpAction;
  /** Key combinations as shown. */
  keys: string[];
  /** Key events and the shortcut each must give (keyboard rows handled by shortcutFor). */
  probes?: [Probe, ShortcutAction][];
};

const tool = (t: Tool): ShortcutAction => ({ kind: "tool", tool: t });

export const HELP: HelpEntry[] = [
  { group: "file", action: "addFiles", keys: ["Ctrl+O"], probes: [[{ code: "KeyO", ctrl: true }, "addFiles"]] },
  { group: "file", action: "newDocument", keys: ["Ctrl+N"], probes: [[{ code: "KeyN", ctrl: true }, "newDocument"]] },
  { group: "file", action: "save", keys: ["Ctrl+S"], probes: [[{ code: "KeyS", ctrl: true }, "save"]] },
  { group: "file", action: "saveAs", keys: ["Ctrl+Shift+S"], probes: [[{ code: "KeyS", ctrl: true, shift: true }, "saveAs"]] },
  { group: "file", action: "print", keys: ["Ctrl+P"], probes: [[{ code: "KeyP", ctrl: true }, "print"]] },
  { group: "edit", action: "undo", keys: ["Ctrl+Z"], probes: [[{ code: "KeyZ", ctrl: true }, "undo"]] },
  {
    group: "edit",
    action: "redo",
    keys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    probes: [
      [{ code: "KeyY", ctrl: true }, "redo"],
      [{ code: "KeyZ", ctrl: true, shift: true }, "redo"],
    ],
  },
  { group: "edit", action: "copy", keys: ["Ctrl+C"], probes: [[{ code: "KeyC", ctrl: true }, "copy"]] },
  { group: "edit", action: "paste", keys: ["Ctrl+V"], probes: [[{ code: "KeyV", ctrl: true }, "paste"]] },
  { group: "edit", action: "duplicate", keys: ["Ctrl+D"], probes: [[{ code: "KeyD", ctrl: true }, "duplicate"]] },
  { group: "edit", action: "deleteObject", keys: ["Delete"], probes: [[{ code: "Delete" }, "delete"]] },
  {
    group: "edit",
    action: "nudge",
    keys: ["← ↑ → ↓"],
    probes: [[{ code: "ArrowRight" }, { kind: "nudge", dx: 1, dy: 0 }]],
  },
  {
    group: "edit",
    action: "nudgeLarge",
    keys: ["Shift+← ↑ → ↓"],
    probes: [[{ code: "ArrowDown", shift: true }, { kind: "nudge", dx: 0, dy: 10 }]],
  },
  { group: "edit", action: "escape", keys: ["Esc"], probes: [[{ code: "Escape" }, "escape"]] },
  { group: "pages", action: "selectAll", keys: ["Ctrl+A"], probes: [[{ code: "KeyA", ctrl: true }, "selectAll"]] },
  {
    group: "pages",
    action: "rotate",
    keys: ["Ctrl+[", "Ctrl+]"],
    probes: [
      [{ code: "BracketLeft", ctrl: true }, "rotateLeft"],
      [{ code: "BracketRight", ctrl: true }, "rotateRight"],
    ],
  },
  { group: "pages", action: "deletePages", keys: ["Delete"], probes: [[{ code: "Delete" }, "delete"]] },
  {
    group: "tools",
    action: "tools",
    keys: ["V", "T", "H", "R", "O", "L", "A", "S"],
    probes: [
      [{ code: "KeyV" }, tool("select")],
      [{ code: "KeyT" }, tool("text")],
      [{ code: "KeyH" }, tool("highlight")],
      [{ code: "KeyR" }, tool("rect")],
      [{ code: "KeyO" }, tool("ellipse")],
      [{ code: "KeyL" }, tool("line")],
      [{ code: "KeyA" }, tool("arrow")],
      [{ code: "KeyS" }, tool("signature")],
    ],
  },
  // Inside the text box: handled by the text editor, not the global key map.
  { group: "text", action: "textNewLine", keys: ["Enter"] },
  { group: "text", action: "textCommit", keys: ["Ctrl+Enter"] },
  { group: "text", action: "textCancel", keys: ["Esc"] },
  { group: "text", action: "textEdit", keys: ["@doubleClick"] },
  { group: "view", action: "zoom", keys: ["@ctrlWheel"] },
  { group: "view", action: "help", keys: ["F1"], probes: [[{ code: "F1" }, "help"]] },
];

export const HELP_GROUPS: HelpGroup[] = ["file", "edit", "pages", "tools", "text", "view"];
