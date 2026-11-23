// Pure helpers of the save flow (SPEC 6.9), kept apart from the backend for unit tests.
import type { Document } from "../bindings/Document";
import type { SourceMeta } from "../state/model";
import { strings } from "../i18n";

/** `<first source name><suffix>.pdf` (suffix from the dictionary, e.g. `_edited`) next to the first source of the page list (SPEC 6.9). */
export function defaultSavePath(
  doc: Document,
  sources: Record<string, SourceMeta>,
  suffix: string = strings().save.defaultSuffix,
): string {
  const first = doc.pages[0] ? sources[doc.pages[0].sourceId] : undefined;
  const path = first?.path ?? "";
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
  const name = first?.name ?? "document";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem}${suffix}.pdf`;
}

/** Adds `.pdf` when the chosen name has no PDF extension. */
export function withPdfExtension(path: string): string {
  return /\.pdf$/i.test(path) ? path : `${path}.pdf`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
