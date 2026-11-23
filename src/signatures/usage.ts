// Where a library signature is placed in a document (D31). Pure, for unit tests.
import type { Document } from "../bindings/Document";

/** 1-based page numbers that place signature `signatureId`. */
export function signaturePages(doc: Document, signatureId: string): number[] {
  return doc.pages.flatMap((p, i) =>
    p.objects.some((o) => o.type === "signature" && o.signatureId === signatureId) ? [i + 1] : [],
  );
}
