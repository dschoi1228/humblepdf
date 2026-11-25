// Printing (SPEC 6.11, D45). Core builds the same PDF as a flattened export, in memory; the
// WebView's own PDF viewer (Edge's) prints it, so text and shapes reach the printer as
// vectors and the printer, copies, pages and paper are chosen in its print dialog. Where the
// viewer is not available the pages are rendered with pdf.js and printed as images.
import { toast } from "sonner";
import { create } from "zustand";
import { backend, isBackendError } from "../backend";
import { useDocumentStore } from "../state/documentStore";
import { pagesDocument } from "../state/model";
import { errorMessage, strings } from "../i18n";
import { openPdf } from "../viewer/pdfjs";
import { targetPageIds } from "./pageActions";
import { exportInputs, useSaveStatus } from "./save";
import type { Document } from "../bindings/Document";

/** Resolution of the image fallback. */
export const RASTER_DPI = 200;
/** How long the PDF viewer may take to load the document before the image fallback is used. */
const VIEWER_LOAD_MS = 15_000;

export type PrintMode = "pdf" | "image";

/** The last print job, for tests (E2E reads it; nothing else does). */
export type PrintJob = { mode: PrintMode; pages: number; bytes: number };

declare global {
  interface Window {
    __printJobs?: PrintJob[];
    /** E2E: build everything but do not open the print dialog (headless browsers have none). */
    __printDryRun?: boolean;
    /** E2E: force a mode instead of detecting the PDF viewer. */
    __printMode?: PrintMode;
  }
}

export const usePrintStatus = create<{ busy: boolean }>(() => ({ busy: false }));

function viewerAvailable(): boolean {
  return navigator.pdfViewerEnabled === true;
}

let frame: HTMLIFrameElement | null = null;
let frameUrl: string | null = null;

function dropFrame() {
  frame?.remove();
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frame = null;
  frameUrl = null;
}

/**
 * Loads the PDF into an invisible frame and opens the viewer's print dialog. The frame stays
 * until the next print, because the dialog belongs to it.
 */
function printWithViewer(pdf: Uint8Array): Promise<boolean> {
  dropFrame();
  frameUrl = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
  const f = document.createElement("iframe");
  frame = f;
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.dataset.testid = "print-frame";
  // Laid out (the viewer does not load in a display:none frame) but out of sight.
  f.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;visibility:hidden";
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), VIEWER_LOAD_MS);
    f.onload = () => {
      clearTimeout(timer);
      if (window.__printDryRun) return resolve(true);
      // The viewer needs a moment after load before it can print.
      setTimeout(() => {
        try {
          f.contentWindow!.print();
          resolve(true);
        } catch {
          resolve(false);
        }
      }, 300);
    };
    f.src = frameUrl!;
    document.body.appendChild(f);
  });
}

/** The image fallback: every page rendered at RASTER_DPI, one page per sheet of its own size. */
async function printAsImages(pdf: Uint8Array): Promise<number> {
  const doc = await openPdf(pdf.slice());
  const root = document.createElement("div");
  root.id = "print-root";
  root.dataset.testid = "print-root";
  const style = document.createElement("style");
  const sizes = new Map<string, string>();
  const urls: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const pt = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RASTER_DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("page image");
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const w = Math.round(pt.width * 100) / 100;
      const h = Math.round(pt.height * 100) / 100;
      const name = `p${String(w).replace(".", "_")}x${String(h).replace(".", "_")}`;
      sizes.set(name, `@page ${name} { size: ${w}pt ${h}pt; margin: 0; }`);
      const sheet = document.createElement("div");
      sheet.className = "print-sheet";
      sheet.style.cssText = `page:${name};width:${w}pt;height:${h}pt`;
      const img = document.createElement("img");
      img.src = url;
      sheet.appendChild(img);
      root.appendChild(sheet);
    }
  } finally {
    void doc.loadingTask.destroy();
  }
  style.textContent = `
@media screen { #print-root { display: none; } }
@media print {
  body > *:not(#print-root) { display: none !important; }
  #print-root .print-sheet { break-after: page; overflow: hidden; }
  #print-root .print-sheet:last-child { break-after: auto; }
  #print-root img { display: block; width: 100%; height: 100%; }
}
${[...sizes.values()].join("\n")}`;
  root.appendChild(style);
  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  const cleanup = () => {
    root.remove();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  if (window.__printDryRun) {
    // Left in place for the test to inspect until the next print.
    document.getElementById("print-root-done")?.remove();
    root.id = "print-root-done";
    return doc.numPages;
  }
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  return doc.numPages;
}

async function countPages(pdf: Uint8Array): Promise<number> {
  const doc = await openPdf(pdf.slice());
  const n = doc.numPages;
  void doc.loadingTask.destroy();
  return n;
}

/** Prints the document, or `part` of it. Resolves true when the print dialog was opened. */
async function printPart(part: Document): Promise<boolean> {
  if (!part.pages.length || usePrintStatus.getState().busy || useSaveStatus.getState().saving) return false;
  usePrintStatus.setState({ busy: true });
  const t = strings().print;
  const waiting = toast.loading(t.preparing);
  try {
    const { model, passwords } = exportInputs(part);
    const pdf = await backend.printBytes(model, passwords);
    let mode: PrintMode = window.__printMode ?? (viewerAvailable() ? "pdf" : "image");
    let pages = 0;
    if (mode === "pdf") {
      if (await printWithViewer(pdf)) {
        if (window.__printDryRun) pages = await countPages(pdf);
      } else {
        dropFrame();
        mode = "image";
      }
    }
    if (mode === "image") {
      toast.info(t.imageFallback);
      pages = await printAsImages(pdf);
    }
    (window.__printJobs ??= []).push({ mode, pages, bytes: pdf.byteLength });
    return true;
  } catch (e) {
    console.error("print failed", e);
    toast.error(t.failed, { description: errorMessage(isBackendError(e) ? e.code : "generic") });
    return false;
  } finally {
    toast.dismiss(waiting);
    usePrintStatus.setState({ busy: false });
  }
}

/** Ctrl+P: the whole document. */
export function printDocument(): Promise<boolean> {
  return printPart(useDocumentStore.getState().doc);
}

/** "Print N pages" (thumbnail menu): the selected pages, or the current page, in document order. */
export function printPages(): Promise<boolean> {
  const st = useDocumentStore.getState();
  return printPart(pagesDocument(st.doc, targetPageIds()));
}
