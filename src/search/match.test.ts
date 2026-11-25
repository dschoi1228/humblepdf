import { describe, expect, it } from "vitest";
import { buildPageText, findInPage, normalizeQuery, type TextItem } from "./match";

const page = (items: TextItem[]) => buildPageText(items);
/** The source text a match covers. */
const covered = (items: TextItem[], m: ReturnType<typeof findInPage>[number]) => {
  if (m.start.item === m.end.item) return items[m.start.item].str.slice(m.start.offset, m.end.offset);
  let s = items[m.start.item].str.slice(m.start.offset);
  for (let i = m.start.item + 1; i < m.end.item; i++) s += "|" + items[i].str;
  return s + "|" + items[m.end.item].str.slice(0, m.end.offset);
};

describe("page search", () => {
  it("ignores case and finds every match in order", () => {
    const items = [{ str: "Select me: HumblePDF 0.3" }, { str: "select ALL" }];
    const found = findInPage(page(items), "SELECT");
    expect(found.map((m) => covered(items, m))).toEqual(["Select", "select"]);
    expect(found[1].start).toEqual({ item: 1, offset: 0 });
  });

  it("finds Korean and Japanese", () => {
    const items = [{ str: "한글 본문을 복사합니다", hasEOL: true }, { str: "日本語のテキストです" }];
    expect(findInPage(page(items), "본문을").map((m) => covered(items, m))).toEqual(["본문을"]);
    expect(findInPage(page(items), "テキスト")[0]).toEqual({ start: { item: 1, offset: 4 }, end: { item: 1, offset: 8 } });
  });

  it("matches across items and line ends; query spaces match any white space run", () => {
    const items = [{ str: "Humble" }, { str: "PDF  is", hasEOL: true }, { str: "small" }];
    expect(findInPage(page(items), "humblepdf").map((m) => covered(items, m))).toEqual(["Humble|PDF"]);
    expect(findInPage(page(items), "is small").map((m) => covered(items, m))).toEqual(["is|small"]);
    expect(findInPage(page(items), "PDF is").map((m) => covered(items, m))).toEqual(["PDF  is"]);
    expect(findInPage(page(items), "  pdf   is  ")).toHaveLength(1);
  });

  it("compares compatibility forms: full width and ligatures", () => {
    const items = [{ str: "ＡＢＣ ｶﾀｶﾅ ﬁle" }];
    expect(findInPage(page(items), "abc").map((m) => covered(items, m))).toEqual(["ＡＢＣ"]);
    expect(findInPage(page(items), "カタカナ").map((m) => covered(items, m))).toEqual(["ｶﾀｶﾅ"]);
    // One ligature glyph in the source covers "fi" in the query.
    expect(findInPage(page(items), "file").map((m) => covered(items, m))).toEqual(["ﬁle"]);
    expect(findInPage(page(items), "ile").map((m) => covered(items, m))).toEqual(["ﬁle"]);
  });

  it("keeps surrogate pairs whole", () => {
    const items = [{ str: "a𠀋b" }];
    expect(findInPage(page(items), "𠀋b")[0]).toEqual({ start: { item: 0, offset: 1 }, end: { item: 0, offset: 4 } });
  });

  it("finds nothing for an empty query or a missing word", () => {
    const items = [{ str: "text" }];
    expect(findInPage(page(items), "   ")).toEqual([]);
    expect(findInPage(page(items), "other")).toEqual([]);
    expect(normalizeQuery("  Ａ  b ")).toBe("a b");
  });

  it("does not overlap matches", () => {
    expect(findInPage(page([{ str: "aaaa" }]), "aa")).toHaveLength(2);
  });
});
