// Object commands used by the edit bar, the object layer and keyboard shortcuts (SPEC 6.4).
import type { PageObject } from "../bindings/PageObject";
import type { Point } from "../bindings/Point";
import type { Rect } from "../bindings/Rect";
import { displayRotation, deltaToUser, toUser, viewportTransform } from "../coords";
import { useEditorStore } from "../editor/editorStore";
import { highlightFromQuads, keepInside, moveObject } from "../editor/geometry";
import { clearTextSelection, selectionQuads } from "../viewer/textLayer";
import { STICKY_TOOLS, toolOf, withProps, type DrawTool, type PropsPatch, type ToolProps } from "../editor/tools";
import { useDocumentStore } from "../state/documentStore";
import { addObject, deleteObject, findObject, updateObject } from "../state/objects";
import { useViewStore } from "../state/viewStore";
import { copyOf, pasted } from "../editor/clipboard";

export function selectedObject(): { pageId: string; object: PageObject; box: Rect } | null {
  const sel = useEditorStore.getState().selected;
  if (!sel) return null;
  const found = findObject(useDocumentStore.getState().doc, sel.pageId, sel.objectId);
  return found ? { pageId: sel.pageId, object: found.object, box: found.page.box } : null;
}

/** Adds an object made by a draw tool as one Undo step and selects it. */
export function commitNewObject(pageId: string, object: PageObject, tool: DrawTool | "signature"): void {
  useDocumentStore.getState().apply((d) => addObject(d, pageId, object));
  const editor = useEditorStore.getState();
  if (STICKY_TOOLS.has(tool)) return;
  editor.setTool("select");
  editor.select({ pageId, objectId: object.id });
}

/** Replaces an object (end of a move or resize drag) as one Undo step. */
export function commitObject(pageId: string, object: PageObject): void {
  useDocumentStore.getState().apply((d) => updateObject(d, pageId, object));
}

/**
 * Edit bar change: updates the selected object (one Undo step) and remembers the value for
 * that object's tool; with no selection it sets the current draw tool's properties.
 */
export function setProps(patch: PropsPatch): void {
  const editor = useEditorStore.getState();
  const sel = selectedObject();
  if (sel) {
    const tool = toolOf(sel.object);
    const next = keepInside(withProps(sel.object, patch), sel.box);
    if (next === sel.object) return;
    commitObject(sel.pageId, next);
    if (tool) editor.setToolProps(tool, patch as Partial<ToolProps[typeof tool]>);
    return;
  }
  if (editor.tool !== "select" && editor.tool !== "signature") {
    editor.setToolProps(editor.tool, patch as Partial<ToolProps[DrawTool]>);
  }
}

/** Deletes the selected object. Returns false when no object is selected. */
export function deleteSelectedObject(): boolean {
  const sel = selectedObject();
  if (!sel) return false;
  useDocumentStore.getState().apply((d) => deleteObject(d, sel.pageId, sel.object.id));
  useEditorStore.getState().select(null);
  return true;
}

/**
 * Moves the selected object by (dx, dy) pt in screen directions (arrow keys follow the
 * screen on rotated pages). Returns false when no object is selected.
 */
export function nudgeSelectedObject(dx: number, dy: number): boolean {
  const sel = selectedObject();
  if (!sel) return false;
  const page = useDocumentStore.getState().doc.pages.find((p) => p.id === sel.pageId)!;
  // Scale 1: one screen pixel is one point.
  const t = viewportTransform(page.box, displayRotation(page.baseRotation, page.userRotation), 1);
  const d = deltaToUser(t, dx, dy);
  commitObject(sel.pageId, moveObject(sel.object, d.x, d.y, sel.box));
  return true;
}


/** Copies the selected object (in-app clipboard, D35). False when nothing is selected. */
export function copySelectedObject(): boolean {
  const sel = selectedObject();
  if (!sel) return false;
  const page = useDocumentStore.getState().doc.pages.find((p) => p.id === sel.pageId)!;
  useEditorStore.getState().setClipboard({ copied: copyOf(page, sel.object), pastes: 0 });
  return true;
}

/**
 * Pastes the copied object onto the current page (or the page of the selected object) as
 * one Undo step and selects it. False when the clipboard is empty.
 */
export function pasteObject(): boolean {
  const editor = useEditorStore.getState();
  const clip = editor.clipboard;
  if (!clip) return false;
  const { doc } = useDocumentStore.getState();
  const selPage = editor.selected?.pageId;
  const target = (selPage && doc.pages.find((p) => p.id === selPage)) || doc.pages[useViewStore.getState().currentPage];
  if (!target) return false;
  const pastes = target.id === clip.copied.pageId ? clip.pastes + 1 : 1;
  const object = pasted(clip.copied, target, pastes, crypto.randomUUID());
  useDocumentStore.getState().apply((d) => addObject(d, target.id, object));
  editor.setClipboard({ ...clip, pastes: target.id === clip.copied.pageId ? pastes : clip.pastes });
  if (editor.tool !== "select") editor.setTool("select");
  editor.select({ pageId: target.id, objectId: object.id });
  return true;
}

/**
 * Highlights the selected page text (M13, D48): one highlight per page with one quad per
 * line, all in one Undo step, in the current highlight colour and opacity. The text
 * selection is cleared. With `selectResult` the first new highlight is selected. False
 * when no page text is selected.
 */
export function highlightTextSelection(selectResult: boolean): boolean {
  const groups = selectionQuads();
  clearTextSelection();
  const { doc } = useDocumentStore.getState();
  const scale = useViewStore.getState().scale;
  const props = useEditorStore.getState().props.highlight;
  const made: { pageId: string; object: PageObject }[] = [];
  for (const g of groups) {
    const page = doc.pages[g.pageIndex];
    const el = document.querySelector(`[data-testid=page][data-page-index="${g.pageIndex}"]`);
    if (!page || !el) continue;
    const r = el.getBoundingClientRect();
    const t = viewportTransform(page.box, displayRotation(page.baseRotation, page.userRotation), scale);
    const quads = g.quads.map((q) => q.map((p) => toUser(t, { x: p.x - r.left, y: p.y - r.top })) as [Point, Point, Point, Point]);
    const object = highlightFromQuads(crypto.randomUUID(), quads, props, page.box);
    if (object) made.push({ pageId: page.id, object });
  }
  if (!made.length) return false;
  useDocumentStore.getState().apply((d) => made.reduce((acc, m) => addObject(acc, m.pageId, m.object), d));
  if (selectResult) useEditorStore.getState().select({ pageId: made[0].pageId, objectId: made[0].object.id });
  return true;
}

/** Ctrl+D: a copy of the selected object next to it. False when nothing is selected. */
export function duplicateSelectedObject(): boolean {
  return copySelectedObject() && pasteObject();
}
