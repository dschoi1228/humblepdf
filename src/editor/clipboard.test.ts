// In-app copy and paste (SPEC 6.4, D35).
import { beforeEach, describe, expect, it } from "vitest";
import type { Document } from "../bindings/Document";
import type { Page } from "../bindings/Page";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { copySelectedObject, duplicateSelectedObject, pasteObject } from "../app/objectActions";
import { shortcutFor } from "../app/shortcuts";
import { useDocumentStore } from "../state/documentStore";
import { useViewStore } from "../state/viewStore";
import { copyOf, PASTE_OFFSET, pasted } from "./clipboard";
import { useEditorStore } from "./editorStore";
import { DEFAULT_PROPS } from "./tools";

const page = (id: string, userRotation: Rotation = 0, box = { x0: 0, y0: 0, x1: 600, y1: 800 }): Page => ({
  id,
  sourceId: "s",
  pageIndex: 0,
  imageFit: null,
  box,
  baseRotation: 0,
  userRotation,
  objects: [],
});
const rect: PageObject = { type: "rect", id: "r", rect: { x0: 100, y0: 100, x1: 200, y1: 150 }, ...DEFAULT_PROPS.rect };
const text: PageObject = { type: "text", id: "t", origin: { x: 100, y: 500 }, rotation: 0, fontSize: 12, color: [0, 0, 0], lines: ["가"] };
const sig: PageObject = { type: "signature", id: "s", signatureId: "sg-1", rect: { x0: 100, y0: 100, x1: 250, y1: 150 }, rotation: 0 };

describe("pasted", () => {
  it("on the same page each paste moves 10pt right and down on screen", () => {
    const p = page("a");
    const c = copyOf(p, rect);
    expect(pasted(c, p, 1, "n")).toMatchObject({ id: "n", rect: { x0: 110, y0: 90, x1: 210, y1: 140 } });
    expect(pasted(c, p, 3, "n")).toMatchObject({ rect: { x0: 100 + 3 * PASTE_OFFSET, y0: 100 - 3 * PASTE_OFFSET } });
    // Shown rotated 90 degrees: screen right is user +y, screen down is user +x.
    const p90 = page("b", 90);
    expect(pasted(copyOf(p90, rect), p90, 1, "n")).toMatchObject({ rect: { x0: 110, y0: 110 } });
  });
  it("stays on the page near an edge", () => {
    const p = page("a");
    const edge: PageObject = { ...rect, rect: { x0: 500, y0: 0, x1: 600, y1: 50 } } as PageObject;
    expect(pasted(copyOf(p, edge), p, 1, "n")).toMatchObject({ rect: { x0: 500, y0: 0, x1: 600, y1: 50 } });
  });
  it("on another page keeps its place relative to the page box", () => {
    const from = page("a");
    const to = page("b", 0, { x0: -50, y0: 20, x1: 550, y1: 820 });
    expect(pasted(copyOf(from, rect), to, 1, "n")).toMatchObject({ rect: { x0: 50, y0: 120, x1: 150, y1: 170 } });
  });
  it("text and signatures turn with the target page so they stay upright", () => {
    const from = page("a");
    const to = page("b", 90);
    expect(pasted(copyOf(from, text), to, 1, "n")).toMatchObject({ rotation: 90, origin: { x: 100, y: 500 } });
    const s = pasted(copyOf(from, sig), to, 1, "n") as Extract<PageObject, { type: "signature" }>;
    expect(s.rotation).toBe(90);
    // 150 x 50 becomes 50 x 150 around the same center (175, 125).
    expect(s.rect).toEqual({ x0: 150, y0: 50, x1: 200, y1: 200 });
    // Back to an unrotated page: upright again.
    const back = pasted(copyOf(to, s), page("c"), 1, "m");
    expect(back).toMatchObject({ rotation: 0, rect: { x0: 100, y0: 100, x1: 250, y1: 150 } });
  });
  it("does not share data with the copied object", () => {
    const p = page("a");
    const c = copyOf(p, text);
    const a = pasted(c, p, 1, "x") as Extract<PageObject, { type: "text" }>;
    a.lines.push("changed");
    expect((c.object as typeof a).lines).toEqual(["가"]);
  });
});

describe("copy, paste and duplicate commands", () => {
  const doc = (): Document => ({ schemaVersion: 1, sources: [], pages: [{ ...page("p1"), objects: [rect] }, page("p2", 90)] });
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useDocumentStore.setState({ doc: doc() });
    useEditorStore.setState({ tool: "select", selected: null, clipboard: null });
    useViewStore.setState({ currentPage: 0 });
  });
  const objects = (i: number) => useDocumentStore.getState().doc.pages[i].objects;
  const past = () => useDocumentStore.getState().history.past.length;

  it("nothing selected or copied: the keys do nothing", () => {
    expect(copySelectedObject()).toBe(false);
    expect(pasteObject()).toBe(false);
    expect(duplicateSelectedObject()).toBe(false);
    expect(past()).toBe(0);
  });
  it("copy then paste twice: two copies, one Undo step each, the newest selected", () => {
    useEditorStore.getState().select({ pageId: "p1", objectId: "r" });
    expect(copySelectedObject()).toBe(true);
    expect(pasteObject()).toBe(true);
    expect(pasteObject()).toBe(true);
    const ids = objects(0).map((o) => o.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(objects(0)[2]).toMatchObject({ rect: { x0: 120, y0: 80 } });
    expect(useEditorStore.getState().selected).toEqual({ pageId: "p1", objectId: ids[2] });
    expect(past()).toBe(2);
  });
  it("paste goes to the current page when nothing is selected", () => {
    useEditorStore.getState().select({ pageId: "p1", objectId: "r" });
    copySelectedObject();
    useEditorStore.getState().select(null);
    useViewStore.setState({ currentPage: 1 });
    pasteObject();
    expect(objects(1)).toHaveLength(1);
    expect(objects(1)[0]).toMatchObject({ rect: { x0: 100, y0: 100 } });
  });
  it("duplicate copies and pastes at once", () => {
    useEditorStore.getState().select({ pageId: "p1", objectId: "r" });
    expect(duplicateSelectedObject()).toBe(true);
    expect(objects(0)).toHaveLength(2);
    expect(past()).toBe(1);
  });
  it("Ctrl+C, Ctrl+V and Ctrl+D", () => {
    const key = (code: string) => shortcutFor({ code, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(key("KeyC")).toBe("copy");
    expect(key("KeyV")).toBe("paste");
    expect(key("KeyD")).toBe("duplicate");
  });
});
