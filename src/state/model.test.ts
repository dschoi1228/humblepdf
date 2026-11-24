import { describe, expect, it } from "vitest";
import type { SourceInfo } from "../bindings/SourceInfo";
import { openFiles } from "../files/addFiles";
import { defaultSavePath } from "../app/savePath";
import { appendSources, baseName, compareFileNames, emptyDocument, exportModel, pagesDocument, rotatePages } from "./model";

const pdfInfo = (n: number): SourceInfo => ({
  kind: "pdf",
  encrypted: false,
  image: null,
  pages: Array.from({ length: n }, (_, i) => ({
    pageIndex: i,
    box: { x0: 0, y0: 0, x1: 100, y1: 200 },
    baseRotation: i === 1 ? 90 : 0,
    objects: [],
  })),
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
    image: { box: { x0: 0, y0: 0, x1: 1, y1: 2 }, imageRect: { x0: 0, y0: 0, x1: 1, y1: 2 } },
  },
};

describe("appendSources", () => {
  it("adds all pages in order with values from open_source", () => {
    let n = 0;
    const id = () => `p${++n}`;
    const r1 = appendSources(emptyDocument(), [{ sourceId: "a", path: "a.pdf", name: "a.pdf", info: pdfInfo(2) }], id);
    const r2 = appendSources(r1.doc, [{ sourceId: "b", path: "b.png", name: "b.png", info: imageInfo }], id);
    const d = r2.doc;
    expect(d.sources.map((s) => [s.id, s.kind])).toEqual([
      ["a", "pdf"],
      ["b", "image"],
    ]);
    expect(d.pages.map((p) => [p.id, p.sourceId, p.pageIndex, p.imageFit, p.baseRotation])).toEqual([
      ["p1", "a", 0, null, 0],
      ["p2", "a", 1, null, 90],
      ["p3", "b", 0, "a4", 0],
    ]);
    expect(d.pages[2].box).toEqual(imageInfo.pages[0].box);
  });

  it("inserts at a position", () => {
    let n = 0;
    const id = () => `p${++n}`;
    const base = appendSources(emptyDocument(), [{ sourceId: "a", path: "a", name: "a", info: pdfInfo(2) }], id).doc;
    const r = appendSources(base, [{ sourceId: "b", path: "b", name: "b", info: pdfInfo(1) }], id, 1);
    expect(r.doc.pages.map((p) => p.sourceId)).toEqual(["a", "b", "a"]);
  });
});

describe("file names", () => {
  it("sorts by name with numbers compared as numbers", () => {
    const names = ["문서10.pdf", "문서2.pdf", "b.png", "A.jpg", "문서1.pdf"];
    expect([...names].sort(compareFileNames)).toEqual(["A.jpg", "b.png", "문서1.pdf", "문서2.pdf", "문서10.pdf"]);
  });
  it("takes the last path segment", () => {
    expect(baseName("C:\\폴더 이름\\계약서.pdf")).toBe("계약서.pdf");
    expect(baseName("/__fixtures/a%20b.pdf")).toBe("a b.pdf");
  });
});

describe("openFiles", () => {
  it("sorts, retries passwords, skips cancelled and failed files", async () => {
    const calls: string[] = [];
    const backend = {
      async openSource(path: string, password?: string) {
        calls.push(`${path}:${password ?? ""}`);
        if (path === "broken.pdf") throw { code: "unreadable_pdf", message: "x" };
        if (path.startsWith("locked")) {
          if (password === undefined) throw { code: "password_required", message: "x" };
          if (password !== "right") throw { code: "wrong_password", message: "x" };
        }
        return { sourceId: path, path, name: path, info: pdfInfo(1) };
      },
    };
    const prompts: [string, boolean][] = [];
    const answers: Record<string, (string | null)[]> = { "locked1.pdf": ["wrong", "right"], "locked2.pdf": [null] };
    const errors: [string, string][] = [];
    const opened = await openFiles(
      [
        { path: "locked2.pdf", name: "locked2.pdf" },
        { path: "c.pdf", name: "c.pdf" },
        { path: "broken.pdf", name: "broken.pdf" },
        { path: "locked1.pdf", name: "locked1.pdf" },
      ],
      {
        backend,
        promptPassword: async (name, wrong) => {
          prompts.push([name, wrong]);
          return answers[name].shift()!;
        },
        notifyError: (name, code) => errors.push([name, code]),
      },
    );
    expect(opened.map((o) => [o.name, o.password])).toEqual([
      ["c.pdf", undefined],
      ["locked1.pdf", "right"],
    ]);
    expect(prompts).toEqual([
      ["locked1.pdf", false],
      ["locked1.pdf", true],
      ["locked2.pdf", false],
    ]);
    expect(errors).toEqual([["broken.pdf", "unreadable_pdf"]]);
    expect(calls[0]).toBe("broken.pdf:");
  });
});

describe("restored objects (SPEC 7.7)", () => {
  it("are added with new ids, unique even when the file is added twice", async () => {
    const { appendSources, emptyDocument, restoredCount } = await import("./model");
    const rect = { type: "rect" as const, id: "saved-id", rect: { x0: 1, y0: 1, x1: 9, y1: 9 }, stroke: [0, 0, 0] as [number, number, number], strokeWidth: 1, fill: null, opacity: 1 };
    const info: SourceInfo = {
      kind: "pdf",
      encrypted: false,
      image: null,
      pages: [{ pageIndex: 0, box: { x0: 0, y0: 0, x1: 100, y1: 200 }, baseRotation: 0, objects: [rect, { ...rect, id: "other" }] }],
    };
    let n = 0;
    const newId = () => `id${++n}`;
    const entry = (sourceId: string) => ({ sourceId, path: `/x/${sourceId}.pdf`, name: `${sourceId}.pdf`, info });
    const { doc } = appendSources(emptyDocument(), [entry("a"), entry("b")], newId);
    const ids = doc.pages.flatMap((p) => p.objects.map((o) => o.id));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain("saved-id");
    expect(doc.pages[0].objects[0]).toMatchObject({ type: "rect", rect: rect.rect });
    expect(restoredCount([entry("a"), entry("b")])).toBe(4);
  });
});

describe("pagesDocument (export pages, SPEC 6.3)", () => {
  let n = 0;
  const id = () => `p${++n}`;
  const base = () => {
    n = 0;
    const r1 = appendSources(emptyDocument(), [{ sourceId: "a", path: "D:/d/a.pdf", name: "a.pdf", info: pdfInfo(3) }], id);
    return appendSources(r1.doc, [{ sourceId: "b", path: "D:/d/b.png", name: "b.png", info: imageInfo }], id).doc;
  };

  it("keeps the given pages in document order with their rotation and objects", () => {
    const d = rotatePages(base(), new Set(["p3"]), 90);
    const withObject = {
      ...d,
      pages: d.pages.map((p) =>
        p.id === "p1"
          ? { ...p, objects: [{ type: "rect", id: "o1" } as never] }
          : p,
      ),
    };
    // Selection order does not matter: the output follows the document.
    const part = pagesDocument(withObject, new Set(["p3", "p1"]));
    expect(part.pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(part.pages[0].objects).toHaveLength(1);
    expect(part.pages[1].userRotation).toBe(90);
    expect(part.pages[1].baseRotation).toBe(0);
  });

  it("leaves out the sources it does not use", () => {
    const part = pagesDocument(base(), new Set(["p2"]));
    expect(exportModel(part).sources.map((s) => s.id)).toEqual(["a"]);
    expect(exportModel(pagesDocument(base(), new Set(["p4"]))).sources.map((s) => s.id)).toEqual(["b"]);
  });

  it("suggests <first source>_발췌.pdf next to that source", () => {
    const part = pagesDocument(base(), new Set(["p4", "p2"]));
    const sources = {
      a: { id: "a", path: "D:/d/a.pdf", name: "a.pdf" },
      b: { id: "b", path: "D:/d/b.png", name: "b.png" },
    } as never;
    expect(defaultSavePath(part, sources, "_발췌")).toBe("D:/d/a_발췌.pdf");
  });
});
