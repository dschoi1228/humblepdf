// Opened sources for rendering: each PDF is opened once with pdf.js, each image is decoded
// once into an ImageBitmap (EXIF orientation applied by the browser).
import type { PDFDocumentProxy } from "pdfjs-dist";
import { backend } from "../backend";
import type { TextItem } from "../search/match";
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

/** Text items of PDF pages for search (M14), by source id and page index; cleared with the sources. */
const texts = new Map<string, Promise<TextItem[]>>();

/**
 * The text items of page `pageIndex` (0-based) of a PDF source, in the order the text layer
 * makes its spans (only items with a string; marked content left out). Empty for images.
 */
export function loadPageText(meta: SourceMeta, pageIndex: number): Promise<TextItem[]> {
  const key = `${meta.id}#${pageIndex}`;
  let p = texts.get(key);
  if (!p) {
    p = (async () => {
      const src = await loadSource(meta);
      if (src.kind !== "pdf") return [];
      const page = await src.doc.getPage(pageIndex + 1);
      const content = await page.getTextContent({ disableNormalization: true });
      return content.items.flatMap((it) => ("str" in it ? [{ str: it.str, hasEOL: it.hasEOL }] : []));
    })();
    p.catch(() => texts.delete(key));
    texts.set(key, p);
  }
  return p;
}

export async function clearSources(): Promise<void> {
  const all = [...cache.values()];
  cache.clear();
  texts.clear();
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
