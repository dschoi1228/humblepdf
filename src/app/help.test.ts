// The F1 help must match the real key map (M7).
import { describe, expect, it } from "vitest";
import { HELP } from "./shortcutHelp";
import { shortcutFor, type ShortcutAction } from "./shortcuts";

describe("shortcut help", () => {
  it("every keyboard row gives the shortcut it describes", () => {
    for (const row of HELP) {
      for (const [p, expected] of row.probes ?? []) {
        const got = shortcutFor({ code: p.code, ctrlKey: !!p.ctrl, shiftKey: !!p.shift, metaKey: false, altKey: false });
        expect(got, `${row.action}: ${p.code}`).toEqual(expected);
      }
    }
  });

  it("every global shortcut appears in the help", () => {
    const shown = new Set(HELP.flatMap((r) => (r.probes ?? []).map(([, a]) => (typeof a === "string" ? a : a.kind))));
    const all: (ShortcutAction extends infer A ? (A extends string ? A : A extends { kind: infer K } ? K : never) : never)[] = [
      "delete", "undo", "redo", "selectAll", "save", "saveAs", "newDocument", "addFiles", "rotateLeft", "rotateRight",
      "escape", "help", "copy", "paste", "duplicate", "tool", "nudge",
    ];
    for (const a of all) expect(shown.has(a), a).toBe(true);
  });
});
