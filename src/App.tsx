// App shell: toolbar, thumbnail panel, page view, password dialog and error toasts.
import { useEffect, useRef } from "react";
import { addFiles, pickAndAddFiles } from "./app/actions";
import { deleteTargets, rotateTargets } from "./app/pageActions";
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
import { dictionary, useLocaleStore } from "./i18n";
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

function runShortcut(action: ShortcutAction): void {
  const doc = useDocumentStore.getState();
  switch (action) {
    case "delete":
      return deleteTargets();
    case "undo":
      return doc.undo();
    case "redo":
      return doc.redo();
    case "selectAll":
      return doc.selectAll();
    case "save":
      return void save();
    case "saveAs":
      return void saveAs();
    case "newDocument":
      return void newDocument();
    case "addFiles":
      return void pickAndAddFiles();
    case "rotateLeft":
      return rotateTargets(-90);
    case "rotateRight":
      return rotateTargets(90);
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
      e.preventDefault();
      runShortcut(action);
    };
    window.addEventListener("keydown", onKeyDown);

    // StrictMode runs effects twice; the startup hooks must run once.
    if (!started.current) {
      started.current = true;
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
        <main className="flex min-h-0 flex-1">
          {hasPages && thumbnailsOpen && <ThumbnailPanel />}
          <div className="min-w-0 flex-1">{hasPages ? <PageView /> : <EmptyState />}</div>
        </main>
      </div>
      <PasswordDialog />
      <SavingDialog />
      <UnsavedDialog />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
