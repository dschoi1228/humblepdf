// Editing state that is not part of the document or its Undo history (D28): the current
// tool, the selected object and the remembered properties of each tool (session only, D29).
import { create } from "zustand";
import { findObject } from "../state/objects";
import { useDocumentStore } from "../state/documentStore";
import { DEFAULT_PROPS, type DrawTool, type Tool, type ToolProps } from "./tools";

export type SelectedObject = { pageId: string; objectId: string };

type EditorState = {
  tool: Tool;
  selected: SelectedObject | null;
  props: ToolProps;
  /** True while a pointer drag on an object layer is in progress. */
  dragging: boolean;

  setTool: (tool: Tool) => void;
  select: (sel: SelectedObject | null) => void;
  setToolProps: <T extends DrawTool>(tool: T, patch: Partial<ToolProps[T]>) => void;
  setDragging: (dragging: boolean) => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  tool: "select",
  selected: null,
  props: DEFAULT_PROPS,
  dragging: false,
  // Picking a draw tool drops the object selection; the selection tool keeps it.
  setTool: (tool) => set((s) => ({ tool, selected: tool === "select" ? s.selected : null })),
  select: (selected) => set({ selected }),
  setToolProps: (tool, patch) => set((s) => ({ props: { ...s.props, [tool]: { ...s.props[tool], ...patch } } })),
  setDragging: (dragging) => set({ dragging }),
}));

// The selection follows the document: an object removed by Undo, a page deletion or a new
// document is no longer selected.
useDocumentStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  const sel = useEditorStore.getState().selected;
  if (sel && !findObject(s.doc, sel.pageId, sel.objectId)) useEditorStore.setState({ selected: null });
});
