// Pure model changes for page objects (SPEC 6.4). Like the page changes in model.ts, each
// returns the same document object when nothing changes, so no Undo step is recorded.
import type { Document } from "../bindings/Document";
import type { Page } from "../bindings/Page";
import type { PageObject } from "../bindings/PageObject";

function withObjects(doc: Document, pageId: string, change: (objects: PageObject[]) => PageObject[]): Document {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return doc;
  const page = doc.pages[i];
  const objects = change(page.objects);
  if (objects === page.objects) return doc;
  const pages = doc.pages.slice();
  pages[i] = { ...page, objects };
  return { ...doc, pages };
}

/** Objects are small plain values; JSON equality is exact for them. */
const same = (a: PageObject, b: PageObject) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Adds `object` on top of the page's objects. */
export function addObject(doc: Document, pageId: string, object: PageObject): Document {
  return withObjects(doc, pageId, (objects) => [...objects, object]);
}

/** Replaces the object with `next.id`. */
export function updateObject(doc: Document, pageId: string, next: PageObject): Document {
  return withObjects(doc, pageId, (objects) => {
    const i = objects.findIndex((o) => o.id === next.id);
    if (i < 0 || same(objects[i], next)) return objects;
    const out = objects.slice();
    out[i] = next;
    return out;
  });
}

export function deleteObject(doc: Document, pageId: string, objectId: string): Document {
  return withObjects(doc, pageId, (objects) =>
    objects.some((o) => o.id === objectId) ? objects.filter((o) => o.id !== objectId) : objects,
  );
}

export function findObject(doc: Document, pageId: string, objectId: string): { page: Page; object: PageObject } | null {
  const page = doc.pages.find((p) => p.id === pageId);
  const object = page?.objects.find((o) => o.id === objectId);
  return page && object ? { page, object } : null;
}
