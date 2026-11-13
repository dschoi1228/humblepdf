// Browser-mode backend (SPEC 3). "Paths" are URLs served by the Vite dev server
// (e.g. /__fixtures/korean_embedded.pdf). Page information comes from pdf.js.
// Only PDF sources are supported here; image layout is computed by the core only.
import type { PageInfo } from "../bindings/PageInfo";
import type { Rotation } from "../bindings/Rotation";
import { openPdf } from "../viewer/pdfjs";
import type { Backend, BackendError, OpenedSource } from "./types";

const sources = new Map<string, string>();
let nextId = 1;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw { code: "io", message: `cannot fetch ${url}: ${res.status}` } satisfies BackendError;
  return new Uint8Array(await res.arrayBuffer());
}

function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export const mockBackend: Backend = {
  kind: "mock",

  async openSource(path) {
    const bytes = await fetchBytes(path);
    if (!isPdf(bytes)) {
      throw { code: "unknown_format", message: "mock backend only opens PDF" } satisfies BackendError;
    }
    const doc = await openPdf(bytes);
    try {
      const pages: PageInfo[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const [x0, y0, x1, y1] = page.view;
        pages.push({
          pageIndex: i - 1,
          box: { x0, y0, x1, y1 },
          baseRotation: page.rotate as Rotation,
        });
      }
      const sourceId = `m${nextId++}`;
      sources.set(sourceId, path);
      const opened: OpenedSource = {
        sourceId,
        path,
        info: { kind: "pdf", pages, encrypted: false, image: null },
      };
      return opened;
    } finally {
      await doc.loadingTask.destroy();
    }
  },

  async sourceBytes(sourceId) {
    const path = sources.get(sourceId);
    if (!path) throw { code: "unknown_source", message: sourceId } satisfies BackendError;
    return fetchBytes(path);
  },

  async onFileDrop() {
    // Browser mode cannot see OS file paths.
    return () => {};
  },

  async pickFiles() {
    return null;
  },

  async benchConfig() {
    return new URLSearchParams(window.location.search).get("bench");
  },

  async benchReport(report) {
    (window as unknown as { __benchReport?: string }).__benchReport = report;
    console.info(report);
  },
};
