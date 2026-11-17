// Object commands used by the edit bar, the object layer and keyboard shortcuts (SPEC 6.4).
import type { PageObject } from "../bindings/PageObject";
import type { Rect } from "../bindings/Rect";
import { displayRotation, deltaToUser, viewportTransform } from "../coords";
import { useEditorStore } from "../editor/editorStore";
import { moveObject } from "../editor/geometry";
import { STICKY_TOOLS, toolOf, withProps, type DrawTool, type PropsPatch, type ToolProps } from "../editor/tools";
import { useDocumentStore } from "../state/documentStore";
import { addObject, deleteObject, findObject, updateObject } from "../state/objects";

export function selectedObject(): { pageId: string; object: PageObject; box: Rect } | null {
  const sel = useEditorStore.getState().selected;
  if (!sel) return null;
  const found = findObject(useDocumentStore.getState().doc, sel.pageId, sel.objectId);
  return found ? { pageId: sel.pageId, object: found.object, box: found.page.box } : null;
}

/** Adds an object made by a draw tool as one Undo step and selects it. */
export function commitNewObject(pageId: string, object: PageObject, tool: DrawTool): void {
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
    const next = withProps(sel.object, patch);
    if (next === sel.object) return;
    commitObject(sel.pageId, next);
    if (tool) editor.setToolProps(tool, patch as Partial<ToolProps[typeof tool]>);
    return;
  }
  if (editor.tool !== "select") editor.setToolProps(editor.tool, patch as Partial<ToolProps[DrawTool]>);
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
