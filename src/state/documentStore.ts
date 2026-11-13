import { create } from "zustand";
import type { Document } from "../bindings/Document";
import { appendSources, emptyDocument, type OpenedEntry, type SourceMeta } from "./model";

type DocumentState = {
  doc: Document;
  sources: Record<string, SourceMeta>;
  /** Adds the pages of opened sources at the end of the document (M1; M2 adds selection). */
  addOpened: (entries: OpenedEntry[]) => void;
  reset: () => void;
};

const newId = () => crypto.randomUUID();

export const useDocumentStore = create<DocumentState>((set) => ({
  doc: emptyDocument(),
  sources: {},
  addOpened: (entries) =>
    set((s) => {
      const { doc, metas } = appendSources(s.doc, entries, newId);
      const sources = { ...s.sources };
      for (const m of metas) sources[m.id] = m;
      return { doc, sources };
    }),
  reset: () => set({ doc: emptyDocument(), sources: {} }),
}));
