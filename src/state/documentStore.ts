import { create } from "zustand";
import type { Document } from "../bindings/Document";
import { initHistory, record, redo, undo, type History } from "./history";
import {
  appendSources,
  emptyDocument,
  insertIndexAfterSelection,
  type OpenedEntry,
  type SourceMeta,
} from "./model";
import { clickSelect, emptySelection, pruneSelection, selectAll, type Selection } from "./selection";

type DocumentState = {
  /** Current model (the present of the history). */
  doc: Document;
  history: History<Document>;
  sources: Record<string, SourceMeta>;
  selection: Selection;
  /** Model as last saved; the document is dirty when `doc` differs from it. */
  savedDoc: Document;
  /** Path of the last save; Ctrl+S writes there again. */
  savePath: string | null;

  /** Adds the pages of opened sources after the selection (end when nothing is selected). */
  addOpened: (entries: OpenedEntry[]) => void;
  /** Applies a pure model change as one Undo step. No step when nothing changes. */
  apply: (change: (doc: Document) => Document) => void;
  undo: () => void;
  redo: () => void;
  click: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  selectAll: () => void;
  setSelection: (ids: Iterable<string>) => void;
  markSaved: (doc: Document, path: string) => void;
  /** New empty document (Ctrl+N). */
  reset: () => void;
};

const newId = () => crypto.randomUUID();

/**
 * True when closing would lose work (SPEC 6.1). A document without pages has nothing to
 * save, so it is never dirty.
 */
export function isDirty(s: Pick<DocumentState, "doc" | "savedDoc">): boolean {
  return s.doc !== s.savedDoc && s.doc.pages.length > 0;
}

function withHistory(s: DocumentState, history: History<Document>): Partial<DocumentState> {
  if (history === s.history) return {};
  const doc = history.present;
  return { history, doc, selection: pruneSelection(s.selection, doc.pages.map((p) => p.id)) };
}

const initial = () => {
  const doc = emptyDocument();
  return {
    doc,
    history: initHistory(doc),
    sources: {},
    selection: emptySelection,
    savedDoc: doc,
    savePath: null,
  };
};

export const useDocumentStore = create<DocumentState>((set) => ({
  ...initial(),
  addOpened: (entries) =>
    set((s) => {
      const at = insertIndexAfterSelection(s.doc, s.selection.ids);
      const { doc, metas } = appendSources(s.doc, entries, newId, at);
      const sources = { ...s.sources };
      for (const m of metas) sources[m.id] = m;
      // Files opened into an empty, never-saved document are not a change: opening them again
      // gives the same document (double-click on a PDF, then close). Adding to pages is.
      const opening = s.doc.pages.length === 0 && s.savePath === null;
      return { ...withHistory(s, record(s.history, doc)), sources, ...(opening ? { savedDoc: doc } : {}) };
    }),
  apply: (change) => set((s) => withHistory(s, record(s.history, change(s.doc)))),
  undo: () => set((s) => withHistory(s, undo(s.history))),
  redo: () => set((s) => withHistory(s, redo(s.history))),
  click: (id, mods) =>
    set((s) => ({ selection: clickSelect(s.selection, s.doc.pages.map((p) => p.id), id, mods) })),
  selectAll: () => set((s) => ({ selection: selectAll(s.doc.pages.map((p) => p.id)) })),
  setSelection: (ids) => {
    const set_ = new Set(ids);
    set({ selection: { ids: set_, anchor: set_.values().next().value ?? null } });
  },
  markSaved: (doc, path) => set({ savedDoc: doc, savePath: path }),
  reset: () => set(initial()),
}));
