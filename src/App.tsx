// M0 verification screen: open one file, render its first page, show dropped paths.
// This is not the M1 viewer; it only exists to check the stack (SPEC 10, M0-2).
import { useCallback, useEffect, useRef, useState } from "react";
import { backend, isBackendError, type OpenedSource } from "./backend";
import { ko } from "./strings/ko";
import { openPdf, renderPage } from "./viewer/pdfjs";

type Timing = { openMs: number; bytesMs: number; renderMs: number; totalMs: number; bytes: number };

declare global {
  interface Window {
    /** State exposed for E2E tests. */
    __m0?: { status: "idle" | "loading" | "rendered" | "error"; timing?: Timing; error?: string };
  }
}

function errorText(e: unknown): string {
  if (isBackendError(e)) return ko.errors[e.code] ?? ko.errors.generic;
  return ko.errors.generic;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opened, setOpened] = useState<OpenedSource | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  // The bench/open hook must run once even when StrictMode mounts effects twice.
  const startedRef = useRef(false);

  const openAndRender = useCallback(async (path: string): Promise<Timing> => {
    window.__m0 = { status: "loading" };
    setError(null);
    const t0 = performance.now();
    const src = await backend.openSource(path);
    const t1 = performance.now();
    const bytes = await backend.sourceBytes(src.sourceId);
    const t2 = performance.now();
    const size = bytes.byteLength;
    if (src.info.kind !== "pdf") throw { code: "unknown_format", message: "M0 screen renders PDF only" };
    const doc = await openPdf(bytes);
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("no canvas");
    await renderPage(doc, 1, canvas, 1);
    const t3 = performance.now();
    const tm = { openMs: t1 - t0, bytesMs: t2 - t1, renderMs: t3 - t2, totalMs: t3 - t0, bytes: size };
    setOpened(src);
    setTiming(tm);
    window.__m0 = { status: "rendered", timing: tm };
    return tm;
  }, []);

  const tryOpen = useCallback(
    async (path: string) => {
      try {
        await openAndRender(path);
      } catch (e) {
        console.error(e);
        setError(errorText(e));
        window.__m0 = { status: "error", error: String(isBackendError(e) ? e.code : e) };
      }
    },
    [openAndRender],
  );

  // File drop (Tauri only) and the M0 bench / test hooks.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    backend
      .onFileDrop((paths) => {
        setDropped(paths);
        if (paths[0]) void tryOpen(paths[0]);
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

    void (async () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const bench = await backend.benchConfig();
      if (bench) {
        try {
          const tm = await openAndRender(bench);
          await backend.benchReport(JSON.stringify({ ok: true, ...tm }));
        } catch (e) {
          await backend.benchReport(JSON.stringify({ ok: false, error: String(isBackendError(e) ? e.code : e) }));
        }
        return;
      }
      const open = new URLSearchParams(window.location.search).get("open");
      if (open) await tryOpen(open);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openAndRender, tryOpen]);

  const onPick = async () => {
    const paths = await backend.pickFiles();
    if (paths?.[0]) await tryOpen(paths[0]);
  };

  return (
    <main className="m0">
      <header>
        <h1>{ko.appTitle}</h1>
        <span className="badge">{ko.m0Banner}</span>
        {backend.kind === "tauri" && (
          <button type="button" onClick={onPick}>
            {ko.openFile}
          </button>
        )}
      </header>
      <p className="hint">{ko.dropHint}</p>
      {dropped.length > 0 && (
        <section data-testid="dropped">
          <h2>{ko.droppedPaths}</h2>
          <ul>
            {dropped.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {opened ? (
        <p className="info">
          {opened.path} · {ko.pageOf(1, opened.info.pages.length)}
          {timing && <> · {ko.firstPageTime(timing.totalMs)}</>}
        </p>
      ) : (
        <p className="info">{ko.noFile}</p>
      )}
      <div className="page">
        <canvas ref={canvasRef} data-testid="page-canvas" />
      </div>
    </main>
  );
}
