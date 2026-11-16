// Pure document-model changes. The store calls these and records them for Undo (D25).
// Model types come from the Rust structs (src/bindings), never defined by hand (rule 3).
import type { Document } from "../bindings/Document";
import type { ImageFit } from "../bindings/ImageFit";
import type { Page } from "../bindings/Page";
import type { Rotation } from "../bindings/Rotation";
import type { SourceInfo } from "../bindings/SourceInfo";

export const SCHEMA_VERSION = 1 as const;

export function emptyDocument(): Document {
  return { schemaVersion: SCHEMA_VERSION, sources: [], pages: [] };
}

/** Session data about a source that is not part of the model. */
export type SourceMeta = {
  id: string;
  /** File name for display. */
  name: string;
  path: string;
  info: SourceInfo;
  /** Kept in memory only (SPEC 4). */
  password?: string;
};

/** A source opened by the backend, ready to be added. */
export type OpenedEntry = {
  sourceId: string;
  path: string;
  name: string;
  info: SourceInfo;
  password?: string;
};

/**
 * Appends every page of each opened source after `insertAt` (end of document when null).
 * Box and base rotation come from `open_source` unchanged (SPEC 4); image pages start
 * with the `a4` fit.
 */
export function appendSources(
  doc: Document,
  entries: OpenedEntry[],
  newId: () => string,
  insertAt: number | null = null,
): { doc: Document; metas: SourceMeta[] } {
  const sources = [...doc.sources];
  const added: Page[] = [];
  const metas: SourceMeta[] = [];
  for (const e of entries) {
    sources.push({ id: e.sourceId, kind: e.info.kind, path: e.path });
    metas.push({ id: e.sourceId, name: e.name, path: e.path, info: e.info, password: e.password });
    for (const p of e.info.pages) {
      added.push({
        id: newId(),
        sourceId: e.sourceId,
        pageIndex: p.pageIndex,
        imageFit: e.info.kind === "image" ? "a4" : null,
        box: p.box,
        baseRotation: p.baseRotation,
        userRotation: 0,
        objects: [],
      });
    }
  }
  const at = insertAt === null ? doc.pages.length : Math.max(0, Math.min(insertAt, doc.pages.length));
  const pages = [...doc.pages.slice(0, at), ...added, ...doc.pages.slice(at)];
  return { doc: { ...doc, sources, pages }, metas };
}

/**
 * Insertion index for added files (SPEC 6.1): after the selected page that comes last in
 * the document, or the end of the document when nothing is selected.
 */
export function insertIndexAfterSelection(doc: Document, selected: ReadonlySet<string>): number | null {
  for (let i = doc.pages.length - 1; i >= 0; i--) {
    if (selected.has(doc.pages[i].id)) return i + 1;
  }
  return null;
}

/**
 * Moves the given pages, keeping their document order, so that they end up before the page
 * that is at `toIndex` now (`toIndex` counts positions in the current page list, so
 * `pages.length` means the end). Returns the same document when nothing changes.
 */
export function movePages(doc: Document, ids: ReadonlySet<string>, toIndex: number): Document {
  const at = Math.max(0, Math.min(toIndex, doc.pages.length));
  const moving = doc.pages.filter((p) => ids.has(p.id));
  if (!moving.length) return doc;
  const before = doc.pages.slice(0, at).filter((p) => !ids.has(p.id));
  const after = doc.pages.slice(at).filter((p) => !ids.has(p.id));
  const pages = [...before, ...moving, ...after];
  if (pages.every((p, i) => p === doc.pages[i])) return doc;
  return { ...doc, pages };
}

export function deletePages(doc: Document, ids: ReadonlySet<string>): Document {
  const pages = doc.pages.filter((p) => !ids.has(p.id));
  return pages.length === doc.pages.length ? doc : { ...doc, pages };
}

/** Adds `delta` (clockwise, ±90) to the user rotation of the given pages. */
export function rotatePages(doc: Document, ids: ReadonlySet<string>, delta: 90 | -90): Document {
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (!ids.has(p.id)) return p;
    changed = true;
    return { ...p, userRotation: (((p.userRotation + delta) % 360) + 360) % 360 as Rotation };
  });
  return changed ? { ...doc, pages } : doc;
}

/**
 * Sets the fit of the given image pages. The page box follows the layout core computed
 * for that fit (SPEC 6.1); core checks it again on export.
 */
export function setImageFit(
  doc: Document,
  ids: ReadonlySet<string>,
  fit: ImageFit,
  sources: Record<string, SourceMeta>,
): Document {
  let changed = false;
  const pages = doc.pages.map((p) => {
    const image = sources[p.sourceId]?.info.image;
    if (!ids.has(p.id) || p.imageFit === null || p.imageFit === fit || !image) return p;
    changed = true;
    return { ...p, imageFit: fit, box: image[fit].box };
  });
  return changed ? { ...doc, pages } : doc;
}

/** The model sent to export: sources no page uses are left out. */
export function exportModel(doc: Document): Document {
  const used = new Set(doc.pages.map((p) => p.sourceId));
  return { ...doc, sources: doc.sources.filter((s) => used.has(s.id)) };
}

/**
 * Sort order for files added together (SPEC 6.1): by name, numbers compared as numbers.
 * Latin before Hangul, like Windows Explorer (the "ko" collation puts Hangul first).
 */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** File name of a path or URL (both separators). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return decodeURIComponent(parts[parts.length - 1] || path);
}
