// Opened sources for rendering: each PDF is opened once with pdf.js, each image is decoded
// once into an ImageBitmap (EXIF orientation applied by the browser).
import type { PDFDocumentProxy } from "pdfjs-dist";
import { backend } from "../backend";
import type { SourceMeta } from "../state/model";
import { openPdf } from "./pdfjs";

export type LoadedSource = { kind: "pdf"; doc: PDFDocumentProxy } | { kind: "image"; bitmap: ImageBitmap };

const cache = new Map<string, Promise<LoadedSource>>();

export function loadSource(meta: SourceMeta): Promise<LoadedSource> {
  let p = cache.get(meta.id);
  if (!p) {
    p = (async (): Promise<LoadedSource> => {
      // Fresh bytes: pdf.js takes ownership of the buffer (SPEC 3).
      const bytes = await backend.sourceBytes(meta.id);
      if (meta.info.kind === "pdf") {
        return { kind: "pdf", doc: await openPdf(bytes, meta.password) };
      }
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: "from-image" });
      return { kind: "image", bitmap };
    })();
    // A failed load may be retried later.
    p.catch(() => cache.delete(meta.id));
    cache.set(meta.id, p);
  }
  return p;
}

export async function clearSources(): Promise<void> {
  const all = [...cache.values()];
  cache.clear();
  for (const p of all) {
    try {
      const s = await p;
      if (s.kind === "pdf") await s.doc.loadingTask.destroy();
      else s.bitmap.close();
    } catch {
      // already failed
    }
  }
}
