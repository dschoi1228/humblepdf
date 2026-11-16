// Saving (SPEC 6.9) and the unsaved-changes guard (SPEC 6.1). Core builds the PDF; this
// module picks the path, shows progress and reports the result.
import { toast } from "sonner";
import { create } from "zustand";
import type { Document } from "../bindings/Document";
import { backend, isBackendError } from "../backend";
import { isDirty, useDocumentStore } from "../state/documentStore";
import { exportModel, type SourceMeta } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { errorMessage, ko } from "../strings/ko";
import { clearThumbnails } from "../viewer/thumbCache";
import { clearPageBitmaps } from "../viewer/pageBitmapCache";
import { clearSources } from "../viewer/sourceCache";

/** `<first source name>_편집.pdf` next to the first source of the page list (SPEC 6.9). */
export function defaultSavePath(doc: Document, sources: Record<string, SourceMeta>): string {
  const first = doc.pages[0] ? sources[doc.pages[0].sourceId] : undefined;
  const path = first?.path ?? "";
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
  const name = first?.name ?? "document";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem}${ko.save.defaultSuffix}.pdf`;
}

/** Adds `.pdf` when the chosen name has no PDF extension. */
export function withPdfExtension(path: string): string {
  return /\.pdf$/i.test(path) ? path : `${path}.pdf`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** Progress indicator state (the saving dialog reads it). */
export const useSaveStatus = create<{ saving: boolean }>(() => ({ saving: false }));

type ExportResult = "ok" | "is_source" | "failed";

async function exportTo(path: string): Promise<ExportResult> {
  const st = useDocumentStore.getState();
  const doc = st.doc;
  const model = exportModel(doc);
  const passwords: Record<string, string> = {};
  let encrypted = false;
  for (const s of model.sources) {
    const meta = st.sources[s.id];
    if (meta?.password !== undefined) passwords[s.id] = meta.password;
    if (meta?.info.encrypted) encrypted = true;
  }
  useSaveStatus.setState({ saving: true });
  try {
    const summary = await backend.exportDocument(model, path, passwords);
    useDocumentStore.getState().markSaved(doc, path);
    const name = path.split(/[\\/]/).pop() ?? path;
    toast.success(ko.save.saved(name), {
      description: ko.save.savedDetail(summary.pageCount, formatBytes(summary.bytes)),
    });
    if (encrypted) toast.info(ko.save.notEncrypted);
    for (const w of summary.warnings) {
      if (w.code === "missing_glyphs") toast.warning(ko.save.missingGlyphs(w.chars.join(" ")));
    }
    return "ok";
  } catch (e) {
    const code = isBackendError(e) ? e.code : "generic";
    if (code === "output_is_source") {
      toast.error(ko.save.outputIsSource);
      return "is_source";
    }
    console.error("save failed", e);
    toast.error(ko.save.failed, { description: errorMessage(code) });
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
