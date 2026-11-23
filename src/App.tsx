// App shell: toolbar, thumbnail panel, page view, password dialog and error toasts.
import { useEffect, useRef } from "react";
import { addFiles, pickAndAddFiles } from "./app/actions";
import { deleteTargets, rotateTargets } from "./app/pageActions";
import { deleteSelectedObject, nudgeSelectedObject } from "./app/objectActions";
import { useEditorStore } from "./editor/editorStore";
import { EditBar } from "./components/EditBar";
import { SignatureDialog } from "./components/SignatureDialog";
import { chooseTool } from "./app/toolActions";
import { useSignatureStore } from "./signatures/signatureStore";
import { loadTextFonts, TEXT_FONT_FAMILY } from "./editor/fonts";
import { canvasMeasure, setTextMeasure } from "./editor/textLayout";
import { confirmDiscard, newDocument, save, saveAs } from "./app/save";
import { shortcutFor, shortcutsBlocked, type ShortcutAction } from "./app/shortcuts";
import { SavingDialog, UnsavedDialog } from "./components/SaveDialogs";
import { backend, isBackendError } from "./backend";
import { EmptyState } from "./components/EmptyState";
import { PageView } from "./components/PageView";
import { PasswordDialog } from "./components/PasswordDialog";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { Toolbar } from "./components/Toolbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isDirty, useDocumentStore } from "./state/documentStore";
import { baseName } from "./state/model";
import { useViewStore } from "./state/viewStore";
import { dictionary, errorMessage, strings, useLocaleStore } from "./i18n";
import { toast } from "sonner";
import "./viewer/testHooks";

/** Resolves when the first page of the document has been drawn. */
function waitForFirstRender(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      if (window.__viewer?.firstRenderAt() != null) resolve();
      else if (performance.now() - t0 > timeoutMs) reject(new Error("timeout"));
      else requestAnimationFrame(check);
    };
    check();
  });
}

/** Runs a shortcut; false when it does nothing here, so the key keeps its default. */
function runShortcut(action: ShortcutAction): boolean {
  const doc = useDocumentStore.getState();
  const editor = useEditorStore.getState();
  if (typeof action === "object") {
    if (action.kind === "tool") {
      if (!doc.doc.pages.length) return false;
      chooseTool(action.tool);
      return true;
    }
    return nudgeSelectedObject(action.dx, action.dy);
  }
  switch (action) {
    case "delete":
      // The selected object goes first; otherwise the selected pages (SPEC 6.4).
      if (!deleteSelectedObject()) deleteTargets();
      return true;
    case "escape":
      if (editor.tool !== "select") editor.setTool("select");
      else if (editor.selected) editor.select(null);
      else return false;
      return true;
    case "undo":
      doc.undo();
      return true;
    case "redo":
      doc.redo();
      return true;
    case "selectAll":
      doc.selectAll();
      return true;
    case "save":
      void save();
      return true;
    case "saveAs":
      void saveAs();
      return true;
    case "newDocument":
      void newDocument();
      return true;
    case "addFiles":
      void pickAndAddFiles();
      return true;
    case "rotateLeft":
      rotateTargets(-90);
      return true;
    case "rotateRight":
      rotateTargets(90);
      return true;
  }
}

export default function App() {
  const hasPages = useDocumentStore((s) => s.doc.pages.length > 0);
  const thumbnailsOpen = useViewStore((s) => s.thumbnailsOpen);
  const started = useRef(false);
  const locale = useLocaleStore((s) => s.locale);

  // The window title and the document language follow the UI language (D27).
  useEffect(() => {
    document.documentElement.lang = locale;
    void backend.setTitle(dictionary(locale).appTitle).catch(() => {});
  }, [locale]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void backend
      .onFileDrop((files) => void addFiles(files))
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

    // Unsaved changes are confirmed before the window closes (SPEC 6.1).
    let unguard: (() => void) | undefined;
    void backend
      .onCloseRequested({ isDirty: () => isDirty(useDocumentStore.getState()), confirm: () => confirmDiscard("close") })
      .then((u) => {
        if (cancelled) u();
        else unguard = u;
      });

    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action || shortcutsBlocked(e.target)) return;
      if (runShortcut(action)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);

    // StrictMode runs effects twice; the startup hooks must run once.
    if (!started.current) {
      started.current = true;
      // Text objects are measured with the bundled fonts once they are loaded (D32).
      void loadTextFonts().then(() => setTextMeasure(canvasMeasure(TEXT_FONT_FAMILY)));
      void useSignatureStore
        .getState()
        .load()
        .catch((e) => toast.error(strings().signatures.failed, { description: errorMessage(isBackendError(e) ? e.code : "generic") }));
      void (async () => {
        // Measurement hook (PDF_EDITOR_BENCH / ?bench=): time to the first drawn page.
        const bench = await backend.benchConfig();
        if (bench) {
          const t0 = performance.now();
          try {
            const n = await addFiles([{ path: bench, name: baseName(bench) }]);
            if (!n) throw new Error("not opened");
            await waitForFirstRender(60_000);
            const totalMs = (window.__viewer?.firstRenderAt() ?? performance.now()) - t0;
            await backend.benchReport(JSON.stringify({ ok: true, totalMs, pages: useDocumentStore.getState().doc.pages.length }));
          } catch (e) {
            await backend.benchReport(JSON.stringify({ ok: false, error: String(isBackendError(e) ? e.code : e) }));
          }
          return;
        }
        // Browser-mode convenience: ?open=/__fixtures/a.pdf,/__fixtures/b.pdf
        const open = new URLSearchParams(window.location.search).get("open");
        if (open) await addFiles(open.split(",").map((path) => ({ path, name: baseName(path) })));
      })();
    }

    return () => {
      cancelled = true;
      unlisten?.();
      unguard?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen flex-col overflow-hidden">
        <Toolbar />
        <EditBar />
        <main className="flex min-h-0 flex-1">
          {hasPages && thumbnailsOpen && <ThumbnailPanel />}
          <div className="min-w-0 flex-1">{hasPages ? <PageView /> : <EmptyState />}</div>
        </main>
      </div>
      <PasswordDialog />
      <SavingDialog />
      <UnsavedDialog />
      <SignatureDialog />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
