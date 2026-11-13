// App shell: toolbar, thumbnail panel, page view, password dialog and error toasts.
import { useEffect, useRef } from "react";
import { addFiles } from "./app/actions";
import { backend, isBackendError } from "./backend";
import { EmptyState } from "./components/EmptyState";
import { PageView } from "./components/PageView";
import { PasswordDialog } from "./components/PasswordDialog";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { Toolbar } from "./components/Toolbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentStore } from "./state/documentStore";
import { baseName } from "./state/model";
import { useViewStore } from "./state/viewStore";
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

export default function App() {
  const hasPages = useDocumentStore((s) => s.doc.pages.length > 0);
  const thumbnailsOpen = useViewStore((s) => s.thumbnailsOpen);
  const started = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void backend
      .onFileDrop((files) => void addFiles(files))
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

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
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
