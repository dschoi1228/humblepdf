// Pure document-model changes. The store calls these; M2 will put Undo on top of them.
// Model types come from the Rust structs (src/bindings), never defined by hand (rule 3).
import type { Document } from "../bindings/Document";
import type { Page } from "../bindings/Page";
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
