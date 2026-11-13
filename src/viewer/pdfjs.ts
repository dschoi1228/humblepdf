// The only place that configures pdf.js. All assets are served from the app itself
// (public/pdfjs, copied by scripts/copy-pdfjs-assets.mjs); nothing is fetched from a CDN.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

const base = new URL("pdfjs/", new URL(import.meta.env.BASE_URL, window.location.href));

GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", base).href;

/** getDocument options. pdf.js 6 requires every URL to end with "/". */
export const pdfjsAssetOptions = {
  cMapUrl: new URL("cmaps/", base).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("standard_fonts/", base).href,
  wasmUrl: new URL("wasm/", base).href,
  iccUrl: new URL("iccs/", base).href,
  enableXfa: false,
} as const;

/**
 * Opens a PDF from bytes. pdf.js transfers the underlying buffer to its worker,
 * so `data` must not be used afterwards (SPEC 3).
 */
export function openPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  return getDocument({ ...pdfjsAssetOptions, data, password }).promise;
}

const activeRenders = new WeakMap<HTMLCanvasElement, RenderTask>();

/**
 * Renders one page into a canvas at the given CSS scale, honoring devicePixelRatio.
 * A render still running on the same canvas is cancelled first.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation?: number,
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: rotation ?? page.rotate });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const previous = activeRenders.get(canvas);
  if (previous) {
    previous.cancel();
    await previous.promise.catch(() => {});
  }
  const task = page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  activeRenders.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (activeRenders.get(canvas) === task) activeRenders.delete(canvas);
  }
}
