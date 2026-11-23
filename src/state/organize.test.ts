import { beforeEach, describe, expect, it } from "vitest";
import type { Document } from "../bindings/Document";
import type { SourceInfo } from "../bindings/SourceInfo";
import { useDocumentStore, isDirty } from "./documentStore";
import { HISTORY_LIMIT, initHistory, record, redo, undo } from "./history";
import {
  appendSources,
  deletePages,
  emptyDocument,
  exportModel,
  insertIndexAfterSelection,
  movePages,
  rotatePages,
  setImageFit,
  type SourceMeta,
} from "./model";
import { clickSelect, emptySelection, pruneSelection } from "./selection";

const pdfInfo = (n: number): SourceInfo => ({
  kind: "pdf",
  encrypted: false,
  image: null,
  pages: Array.from({ length: n }, (_, i) => ({ pageIndex: i, box: { x0: 0, y0: 0, x1: 100, y1: 200 }, baseRotation: 0, objects: [] })),
});
const imageInfo: SourceInfo = {
  kind: "image",
  encrypted: false,
  pages: [{ pageIndex: 0, box: { x0: 0, y0: 0, x1: 595.276, y1: 841.89 }, baseRotation: 0, objects: [] }],
  image: {
    pixelWidth: 10,
    pixelHeight: 20,
    exifOrientation: 1,
    a4: { box: { x0: 0, y0: 0, x1: 595.276, y1: 841.89 }, imageRect: { x0: 0, y0: 0, x1: 1, y1: 1 } },
    image: { box: { x0: 0, y0: 0, x1: 420.945, y1: 841.89 }, imageRect: { x0: 0, y0: 0, x1: 420.945, y1: 841.89 } },
  },
};

/** Document with pages p1..p5 from source "a" and p6 from image "img". */
function sample(): { doc: Document; metas: Record<string, SourceMeta> } {
  let n = 0;
  const r = appendSources(
    emptyDocument(),
    [
      { sourceId: "a", path: "a.pdf", name: "a.pdf", info: pdfInfo(5) },
      { sourceId: "img", path: "i.png", name: "i.png", info: imageInfo },
    ],
    () => `p${++n}`,
  );
  return { doc: r.doc, metas: Object.fromEntries(r.metas.map((m) => [m.id, m])) };
}
const ids = (d: Document) => d.pages.map((p) => p.id);

describe("movePages", () => {
  const { doc } = sample();
  it("moves one page forward and backward", () => {
    expect(ids(movePages(doc, new Set(["p1"]), 3))).toEqual(["p2", "p3", "p1", "p4", "p5", "p6"]);
    expect(ids(movePages(doc, new Set(["p5"]), 0))).toEqual(["p5", "p1", "p2", "p3", "p4", "p6"]);
    expect(ids(movePages(doc, new Set(["p2"]), 6))).toEqual(["p1", "p3", "p4", "p5", "p6", "p2"]);
  });
  it("keeps document order of several pages", () => {
    // Selection order does not matter; pages stay in document order.
    expect(ids(movePages(doc, new Set(["p5", "p2"]), 1))).toEqual(["p1", "p2", "p5", "p3", "p4", "p6"]);
    expect(ids(movePages(doc, new Set(["p1", "p3"]), 5))).toEqual(["p2", "p4", "p5", "p1", "p3", "p6"]);
  });
  it("returns the same document when nothing moves", () => {
    expect(movePages(doc, new Set(["p2"]), 1)).toBe(doc);
    expect(movePages(doc, new Set(["p2"]), 2)).toBe(doc);
    expect(movePages(doc, new Set(["p2", "p3"]), 3)).toBe(doc);
    expect(movePages(doc, new Set(["zz"]), 0)).toBe(doc);
  });
});

describe("page changes", () => {
  const { doc, metas } = sample();
  it("deletes pages", () => {
    expect(ids(deletePages(doc, new Set(["p1", "p6"])))).toEqual(["p2", "p3", "p4", "p5"]);
    expect(deletePages(doc, new Set(["zz"]))).toBe(doc);
  });
  it("rotates and wraps around", () => {
    let d = rotatePages(doc, new Set(["p1"]), -90);
    expect(d.pages[0].userRotation).toBe(270);
    d = rotatePages(d, new Set(["p1", "p2"]), 90);
    expect(d.pages.slice(0, 3).map((p) => p.userRotation)).toEqual([0, 90, 0]);
    expect(d.pages[2]).toBe(doc.pages[2]);
  });
  it("sets the image fit and its box, ignoring PDF pages", () => {
    const d = setImageFit(doc, new Set(["p1", "p6"]), "image", metas);
    expect(d.pages[5].imageFit).toBe("image");
    expect(d.pages[5].box).toEqual(imageInfo.image!.image.box);
    expect(d.pages[0]).toBe(doc.pages[0]);
    expect(setImageFit(d, new Set(["p6"]), "image", metas)).toBe(d);
    expect(setImageFit(d, new Set(["p6"]), "a4", metas).pages[5].box).toEqual(imageInfo.image!.a4.box);
  });
  it("leaves unused sources out of the export model", () => {
    const d = deletePages(doc, new Set(["p6"]));
    expect(exportModel(d).sources.map((s) => s.id)).toEqual(["a"]);
    expect(exportModel(doc).sources.map((s) => s.id)).toEqual(["a", "img"]);
  });
  it("inserts added files after the last selected page", () => {
    expect(insertIndexAfterSelection(doc, new Set())).toBeNull();
    expect(insertIndexAfterSelection(doc, new Set(["p4", "p2"]))).toBe(4);
  });
});

describe("history", () => {
  it("undoes, redoes and clears redo on a new change", () => {
    let h = initHistory("a");
    h = record(h, "b");
    h = record(h, "c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = redo(h);
    expect(h.present).toBe("c");
    h = undo(undo(h));
    expect(h.present).toBe("a");
    expect(undo(h)).toBe(h);
    h = record(h, "d");
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });
  it("does not record unchanged values", () => {
    const h = initHistory("a");
    expect(record(h, "a")).toBe(h);
  });
  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = undo(h);
    expect(h.present).toBe(20);
  });
});

describe("selection", () => {
  const order = ["p1", "p2", "p3", "p4", "p5"];
  it("plain click, Ctrl toggle, Shift range", () => {
    let s = clickSelect(emptySelection, order, "p2", { ctrl: false, shift: false });
    expect([...s.ids]).toEqual(["p2"]);
    s = clickSelect(s, order, "p4", { ctrl: false, shift: true });
    expect([...s.ids].sort()).toEqual(["p2", "p3", "p4"]);
    // Shift again from the same anchor replaces the range.
    s = clickSelect(s, order, "p1", { ctrl: false, shift: true });
    expect([...s.ids].sort()).toEqual(["p1", "p2"]);
    s = clickSelect(s, order, "p5", { ctrl: true, shift: false });
    expect([...s.ids].sort()).toEqual(["p1", "p2", "p5"]);
    s = clickSelect(s, order, "p1", { ctrl: true, shift: false });
    expect([...s.ids].sort()).toEqual(["p2", "p5"]);
    // Ctrl+Shift adds a range from the new anchor (p1).
    s = clickSelect(s, order, "p3", { ctrl: true, shift: true });
    expect([...s.ids].sort()).toEqual(["p1", "p2", "p3", "p5"]);
  });
  it("drops pages that no longer exist", () => {
    const s = { ids: new Set(["p1", "p9"]), anchor: "p9" };
    const p = pruneSelection(s, order);
    expect([...p.ids]).toEqual(["p1"]);
    expect(p.anchor).toBeNull();
    expect(pruneSelection(p, order)).toBe(p);
  });
});

describe("document store", () => {
  beforeEach(() => useDocumentStore.getState().reset());
  const entries = [{ sourceId: "a", path: "a.pdf", name: "a.pdf", info: pdfInfo(3) }];

  it("undo restores pages and prunes the selection; dirty follows the saved model", () => {
    const st = useDocumentStore.getState;
    st().addOpened(entries);
    const added = st().doc;
    expect(isDirty(st())).toBe(true);
    st().markSaved(added, "out.pdf");
    expect(isDirty(st())).toBe(false);

    const last = added.pages[2].id;
    st().setSelection([last]);
    st().apply((d) => deletePages(d, st().selection.ids));
    expect(st().doc.pages.length).toBe(2);
    expect(st().selection.ids.size).toBe(0);
    expect(isDirty(st())).toBe(true);

    st().undo();
    expect(st().doc).toBe(added);
    expect(isDirty(st())).toBe(false);
    st().redo();
    expect(st().doc.pages.length).toBe(2);
  });

  it("adds files after the selection, as one undo step", () => {
    const st = useDocumentStore.getState;
    st().addOpened(entries);
    st().setSelection([st().doc.pages[0].id]);
    st().addOpened([{ sourceId: "b", path: "b.pdf", name: "b.pdf", info: pdfInfo(1) }]);
    expect(st().doc.pages.map((p) => p.sourceId)).toEqual(["a", "b", "a", "a"]);
    st().undo();
    expect(st().doc.pages.map((p) => p.sourceId)).toEqual(["a", "a", "a"]);
  });

  it("does not record a change that changes nothing", () => {
    const st = useDocumentStore.getState;
    st().addOpened(entries);
    const h = st().history;
    st().apply((d) => movePages(d, new Set([d.pages[0].id]), 0));
    expect(st().history).toBe(h);
  });
});
