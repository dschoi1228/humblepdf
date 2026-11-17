// Object model functions, the editor store and object commands (SPEC 6.4).
import { beforeEach, describe, expect, it } from "vitest";
import type { Document } from "../bindings/Document";
import type { PageObject } from "../bindings/PageObject";
import { deleteSelectedObject, nudgeSelectedObject, selectedObject, setProps, commitNewObject } from "../app/objectActions";
import { shortcutFor } from "../app/shortcuts";
import { useDocumentStore } from "../state/documentStore";
import { addObject, deleteObject, findObject, updateObject } from "../state/objects";
import { useEditorStore } from "./editorStore";
import { DEFAULT_PROPS, PALETTE, propsOf, toolOf, withProps } from "./tools";

const page = (id: string, userRotation: 0 | 90 | 180 | 270 = 0) => ({
  id,
  sourceId: "s",
  pageIndex: 0,
  imageFit: null,
  box: { x0: 0, y0: 0, x1: 600, y1: 800 },
  baseRotation: 0 as const,
  userRotation,
  objects: [] as PageObject[],
});
const doc = (): Document => ({ schemaVersion: 1, sources: [], pages: [page("p1"), page("p2", 90)] });
const rect = (id: string): PageObject => ({ type: "rect", id, rect: { x0: 100, y0: 100, x1: 200, y1: 200 }, ...DEFAULT_PROPS.rect });

describe("object model functions", () => {
  it("add, update and delete; unchanged input returns the same document", () => {
    const d0 = doc();
    const d1 = addObject(d0, "p1", rect("a"));
    expect(d1.pages[0].objects.map((o) => o.id)).toEqual(["a"]);
    expect(d1.pages[1]).toBe(d0.pages[1]);
    const d2 = updateObject(d1, "p1", { ...rect("a"), opacity: 0.5 } as PageObject);
    expect(findObject(d2, "p1", "a")?.object).toMatchObject({ opacity: 0.5 });
    expect(updateObject(d2, "p1", { ...rect("a"), opacity: 0.5 } as PageObject)).toBe(d2);
    expect(updateObject(d2, "p1", rect("missing"))).toBe(d2);
    expect(addObject(d2, "nope", rect("x"))).toBe(d2);
    expect(deleteObject(d2, "p1", "missing")).toBe(d2);
    expect(deleteObject(d2, "p1", "a").pages[0].objects).toEqual([]);
  });
});

describe("tools", () => {
  it("maps objects to tools and properties", () => {
    expect(toolOf(rect("a"))).toBe("rect");
    expect(toolOf({ type: "line", id: "l", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, arrow: true, ...DEFAULT_PROPS.arrow })).toBe("arrow");
    expect(propsOf(rect("a"))).toEqual(DEFAULT_PROPS.rect);
  });
  it("a shape keeps a stroke or a fill", () => {
    // rect("a") has no fill: removing the stroke would make it invisible.
    const r = rect("a");
    expect(withProps(r, { stroke: null })).toBe(r);
    const filled = withProps(r, { fill: PALETTE.blue });
    expect(withProps(filled, { stroke: null })).toMatchObject({ stroke: null, fill: PALETTE.blue });
  });
});

describe("editor store and object commands", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useDocumentStore.setState({ doc: doc() });
    useEditorStore.setState({ tool: "select", selected: null, props: DEFAULT_PROPS });
  });
  const past = () => useDocumentStore.getState().history.past.length;
  const objects = (i = 0) => useDocumentStore.getState().doc.pages[i].objects;

  it("a new shape is one Undo step, selected, and returns to the selection tool", () => {
    useEditorStore.getState().setTool("rect");
    commitNewObject("p1", rect("a"), "rect");
    expect(past()).toBe(1);
    expect(useEditorStore.getState()).toMatchObject({ tool: "select", selected: { pageId: "p1", objectId: "a" } });
  });

  it("the highlight tool stays active", () => {
    useEditorStore.getState().setTool("highlight");
    const h: PageObject = { type: "highlight", id: "h", quads: [], ...DEFAULT_PROPS.highlight };
    commitNewObject("p1", h, "highlight");
    expect(useEditorStore.getState()).toMatchObject({ tool: "highlight", selected: null });
  });

  it("property changes are one step each and are remembered for the tool", () => {
    commitNewObject("p1", rect("a"), "rect");
    setProps({ strokeWidth: 6 });
    setProps({ strokeWidth: 6 });
    expect(past()).toBe(2);
    expect(objects()[0]).toMatchObject({ strokeWidth: 6 });
    expect(useEditorStore.getState().props.rect.strokeWidth).toBe(6);
    expect(useEditorStore.getState().props.ellipse.strokeWidth).toBe(2);
  });

  it("without a selection, properties go to the current draw tool only", () => {
    useEditorStore.getState().setTool("line");
    setProps({ stroke: PALETTE.blue });
    expect(useEditorStore.getState().props.line.stroke).toEqual(PALETTE.blue);
    expect(past()).toBe(0);
  });

  it("Undo that removes the selected object clears the selection", () => {
    commitNewObject("p1", rect("a"), "rect");
    useDocumentStore.getState().undo();
    expect(useEditorStore.getState().selected).toBeNull();
    expect(selectedObject()).toBeNull();
  });

  it("delete and nudge act on the selected object only", () => {
    expect(deleteSelectedObject()).toBe(false);
    expect(nudgeSelectedObject(1, 0)).toBe(false);
    commitNewObject("p1", rect("a"), "rect");
    expect(nudgeSelectedObject(10, 0)).toBe(true);
    expect(objects()[0]).toMatchObject({ rect: { x0: 110, x1: 210, y0: 100 } });
    // Screen down is user -y on an unrotated page.
    nudgeSelectedObject(0, 1);
    expect(objects()[0]).toMatchObject({ rect: { y0: 99, y1: 199 } });
    expect(deleteSelectedObject()).toBe(true);
    expect(objects()).toEqual([]);
    expect(past()).toBe(4);
  });

  it("nudge follows the screen on a page shown rotated 90 degrees", () => {
    commitNewObject("p2", rect("b"), "rect");
    nudgeSelectedObject(1, 0);
    // Shown rotated 90 degrees clockwise: screen right is user +y.
    expect(objects(1)[0]).toMatchObject({ rect: { x0: 100, y0: 101 } });
  });

  it("picking a draw tool drops the object selection", () => {
    commitNewObject("p1", rect("a"), "rect");
    useEditorStore.getState().setTool("ellipse");
    expect(useEditorStore.getState().selected).toBeNull();
  });
});

describe("editing shortcuts", () => {
  const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    shortcutFor({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it("maps tool keys, Esc and arrows", () => {
    expect(key("KeyV")).toEqual({ kind: "tool", tool: "select" });
    expect(key("KeyH")).toEqual({ kind: "tool", tool: "highlight" });
    expect(key("KeyR")).toEqual({ kind: "tool", tool: "rect" });
    expect(key("KeyO")).toEqual({ kind: "tool", tool: "ellipse" });
    expect(key("KeyL")).toEqual({ kind: "tool", tool: "line" });
    expect(key("KeyA")).toEqual({ kind: "tool", tool: "arrow" });
    expect(key("KeyA", { shiftKey: true })).toBeNull();
    expect(key("KeyA", { ctrlKey: true })).toBe("selectAll");
    expect(key("Escape")).toBe("escape");
    expect(key("ArrowLeft")).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(key("ArrowDown", { shiftKey: true })).toEqual({ kind: "nudge", dx: 0, dy: 10 });
    expect(key("KeyT")).toBeNull();
  });
});
