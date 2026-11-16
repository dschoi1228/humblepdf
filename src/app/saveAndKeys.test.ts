import { describe, expect, it } from "vitest";
import type { Document } from "../bindings/Document";
import type { SourceMeta } from "../state/model";
import { defaultSavePath, formatBytes, withPdfExtension } from "./savePath";
import { shortcutFor } from "./shortcuts";

const page = (sourceId: string) => ({
  id: sourceId,
  sourceId,
  pageIndex: 0,
  imageFit: null,
  box: { x0: 0, y0: 0, x1: 1, y1: 1 },
  baseRotation: 0 as const,
  userRotation: 0 as const,
  objects: [],
});
const meta = (id: string, path: string, name: string) =>
  ({ id, path, name, info: { kind: "pdf", pages: [], encrypted: false, image: null } }) as SourceMeta;

describe("defaultSavePath", () => {
  it("uses the source of the first page, in its folder", () => {
    const doc: Document = { schemaVersion: 1, sources: [], pages: [page("b"), page("a")] };
    const sources = {
      a: meta("a", "C:\\docs\\a.pdf", "a.pdf"),
      b: meta("b", "D:\\사진 폴더\\계약서 스캔.JPG", "계약서 스캔.JPG"),
    };
    expect(defaultSavePath(doc, sources)).toBe("D:\\사진 폴더\\계약서 스캔_편집.pdf");
    expect(defaultSavePath({ ...doc, pages: [page("a")] }, sources)).toBe("C:\\docs\\a_편집.pdf");
  });
  it("adds the .pdf extension only when missing", () => {
    expect(withPdfExtension("C:\\x\\out")).toBe("C:\\x\\out.pdf");
    expect(withPdfExtension("C:\\x\\out.PDF")).toBe("C:\\x\\out.PDF");
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2.0KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0MB");
  });
});

describe("shortcutFor", () => {
  const key = (code: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) =>
    shortcutFor({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  it("maps the documented keys", () => {
    expect(key("Delete")).toBe("delete");
    expect(key("KeyZ", { ctrlKey: true })).toBe("undo");
    expect(key("KeyY", { ctrlKey: true })).toBe("redo");
    expect(key("KeyZ", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(key("KeyA", { ctrlKey: true })).toBe("selectAll");
    expect(key("KeyS", { ctrlKey: true })).toBe("save");
    expect(key("KeyS", { ctrlKey: true, shiftKey: true })).toBe("saveAs");
    expect(key("KeyN", { ctrlKey: true })).toBe("newDocument");
    expect(key("KeyO", { ctrlKey: true })).toBe("addFiles");
    expect(key("BracketLeft", { ctrlKey: true })).toBe("rotateLeft");
    expect(key("BracketRight", { ctrlKey: true })).toBe("rotateRight");
  });
  it("ignores other combinations", () => {
    expect(key("KeyZ")).toBeNull();
    expect(key("Delete", { shiftKey: true })).toBeNull();
    expect(key("KeyS", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("KeyQ", { ctrlKey: true })).toBeNull();
  });
});
