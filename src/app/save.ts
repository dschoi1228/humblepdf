// Saving (SPEC 6.9) and the unsaved-changes guard (SPEC 6.1). Core builds the PDF; this
// module picks the path, shows progress and reports the result.
import { toast } from "sonner";
import { create } from "zustand";
import { backend, isBackendError } from "../backend";
import { isDirty, useDocumentStore } from "../state/documentStore";
import { exportModel, pagesDocument } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { errorMessage, strings } from "../i18n";
import { clearThumbnails } from "../viewer/thumbCache";
import { clearPageBitmaps } from "../viewer/pageBitmapCache";
import { clearSources } from "../viewer/sourceCache";
import { defaultSavePath, formatBytes, withPdfExtension } from "./savePath";
import { targetPageIds } from "./pageActions";
import type { Document } from "../bindings/Document";

/** Progress indicator state (the saving dialog reads it). */
export const useSaveStatus = create<{ saving: boolean }>(() => ({ saving: false }));

type ExportResult = "ok" | "is_source" | "failed";

/**
 * How a write counts: "save" sets the Ctrl+S target and clears "unsaved changes". A
 * flattened export (D37) and an export of selected pages (D43) leave both as they are.
 */
type ExportKind = "save" | "flatten" | "pages";

/** Writes the document, or `part` of it for "pages", to `path`. */
async function exportTo(path: string, kind: ExportKind = "save", part?: Document): Promise<ExportResult> {
  const st = useDocumentStore.getState();
  const doc = st.doc;
  const flatten = kind === "flatten";
  const model = exportModel(part ?? doc);
  const passwords: Record<string, string> = {};
  let encrypted = false;
  for (const s of model.sources) {
    const meta = st.sources[s.id];
    if (meta?.password !== undefined) passwords[s.id] = meta.password;
    if (meta?.info.encrypted) encrypted = true;
  }
  useSaveStatus.setState({ saving: true });
  try {
    const summary = await backend.exportDocument(model, path, passwords, flatten);
    if (kind === "save") useDocumentStore.getState().markSaved(doc, path);
    const name = path.split(/[\\/]/).pop() ?? path;
    const detail = strings().save.savedDetail(summary.pageCount, formatBytes(summary.bytes));
    const title =
      kind === "flatten" ? strings().save.flattened(name) : kind === "pages" ? strings().save.pagesExported(name) : strings().save.saved(name);
    toast.success(title, {
      description: flatten ? `${detail} · ${strings().save.flattenedNote}` : detail,
    });
    if (encrypted) toast.info(strings().save.notEncrypted);
    for (const w of summary.warnings) {
      if (w.code === "missing_glyphs") toast.warning(strings().save.missingGlyphs(w.chars.join(" ")));
    }
    return "ok";
  } catch (e) {
    const code = isBackendError(e) ? e.code : "generic";
    if (code === "output_is_source") {
      toast.error(strings().save.outputIsSource);
      return "is_source";
    }
    console.error("save failed", e);
    toast.error(strings().save.failed, { description: errorMessage(code) });
    return "failed";
  } finally {
    useSaveStatus.setState({ saving: false });
  }
}

/** "Save as": asks for a path until it is not a source file. Resolves true when saved. */
export async function saveAs(): Promise<boolean> {
  const st = useDocumentStore.getState();
  if (!st.doc.pages.length || useSaveStatus.getState().saving) return false;
  let suggestion = st.savePath ?? defaultSavePath(st.doc, st.sources);
  for (;;) {
    const picked = await backend.pickSavePath(suggestion);
    if (!picked) return false;
    const path = withPdfExtension(picked);
    const r = await exportTo(path);
    if (r !== "is_source") return r === "ok";
    suggestion = defaultSavePath(st.doc, st.sources);
  }
}

/** "Export flattened" (D37): asks for a path (until it is not a source) and bakes everything. */
export async function exportFlattened(): Promise<boolean> {
  const st = useDocumentStore.getState();
  if (!st.doc.pages.length || useSaveStatus.getState().saving) return false;
  const suggestion = defaultSavePath(st.doc, st.sources, strings().save.flattenSuffix);
  for (;;) {
    const picked = await backend.pickSavePath(suggestion);
    if (!picked) return false;
    const r = await exportTo(withPdfExtension(picked), "flatten");
    if (r !== "is_source") return r === "ok";
  }
}

/**
 * "Export pages" (SPEC 6.3, D43): the selected pages, or the current page, in document order,
 * written like a save but not counted as one.
 */
export async function exportPages(): Promise<boolean> {
  const st = useDocumentStore.getState();
  if (useSaveStatus.getState().saving) return false;
  const part = pagesDocument(st.doc, targetPageIds());
  if (!part.pages.length) return false;
  const suggestion = defaultSavePath(part, st.sources, strings().save.pagesSuffix);
  for (;;) {
    const picked = await backend.pickSavePath(suggestion);
    if (!picked) return false;
    const r = await exportTo(withPdfExtension(picked), "pages", part);
    if (r !== "is_source") return r === "ok";
  }
}

/** Ctrl+S: overwrite the last saved file, or "save as" the first time. */
export async function save(): Promise<boolean> {
  const st = useDocumentStore.getState();
  if (!st.doc.pages.length || useSaveStatus.getState().saving) return false;
  if (!st.savePath) return saveAs();
  const r = await exportTo(st.savePath);
  return r === "is_source" ? saveAs() : r === "ok";
}

// ---- Unsaved changes (Ctrl+N, closing the window) ----

export type UnsavedChoice = "save" | "discard" | "cancel";
type UnsavedPrompt = { kind: "newDocument" | "close"; resolve: (c: UnsavedChoice) => void };

export const useUnsavedPrompt = create<{ pending: UnsavedPrompt | null }>(() => ({ pending: null }));

function askUnsaved(kind: UnsavedPrompt["kind"]): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    useUnsavedPrompt.getState().pending?.resolve("cancel");
    useUnsavedPrompt.setState({
      pending: {
        kind,
        resolve: (c) => {
          useUnsavedPrompt.setState({ pending: null });
          resolve(c);
        },
      },
    });
  });
}

/** True when the current document may be dropped (saved, discarded or unchanged). */
export async function confirmDiscard(kind: UnsavedPrompt["kind"]): Promise<boolean> {
  if (!isDirty(useDocumentStore.getState())) return true;
  const choice = await askUnsaved(kind);
  if (choice === "save") return save();
  return choice === "discard";
}

/** Ctrl+N: empty document after the unsaved-changes check. */
export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard("newDocument"))) return;
  useDocumentStore.getState().reset();
  useViewStore.getState().setCurrentPage(0);
  clearThumbnails();
  clearPageBitmaps();
  await clearSources();
}
