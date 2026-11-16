import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_NAMES, detectLocale, dictionary, errorMessage, useLocaleStore } from ".";

type Node = { [key: string]: unknown };

/** "a.b.c: kind" for every leaf, so dictionaries can be compared shape by shape. */
function shape(node: Node, prefix = ""): string[] {
  return Object.keys(node)
    .sort()
    .flatMap((k) => {
      const v = node[k];
      const path = prefix + k;
      if (typeof v === "object" && v !== null) return shape(v as Node, `${path}.`);
      return [`${path}: ${typeof v === "function" ? `function/${(v as () => string).length}` : typeof v}`];
    });
}

/** Every leaf value, with functions called with sample arguments. */
function texts(node: Node): string[] {
  return Object.values(node).flatMap((v) => {
    if (typeof v === "object" && v !== null) return texts(v as Node);
    if (typeof v === "function") return [(v as (...a: unknown[]) => string)(...[3, "x.pdf"].slice(0, v.length))];
    return [String(v)];
  });
}

describe("dictionaries", () => {
  const base = shape(dictionary("ko") as unknown as Node);

  it.each(LOCALES)("%s has exactly the keys of ko, with the same arity", (l) => {
    expect(shape(dictionary(l) as unknown as Node)).toEqual(base);
  });

  it.each(LOCALES)("%s has no empty text", (l) => {
    for (const s of texts(dictionary(l) as unknown as Node)) expect(s.trim()).not.toBe("");
  });

  it("names every language", () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...LOCALES].sort());
  });

  it("uses plural forms in English", () => {
    const en = dictionary("en");
    expect(en.thumbnails.dragging(1)).toBe("Moving 1 page");
    expect(en.thumbnails.dragging(3)).toBe("Moving 3 pages");
    expect(en.save.savedDetail(1, "2KB")).toBe("1 page, 2KB");
  });
});

describe("detectLocale", () => {
  it("takes the first supported language", () => {
    expect(detectLocale(["ko-KR", "en-US"])).toBe("ko");
    expect(detectLocale(["ja"])).toBe("ja");
    expect(detectLocale(["fr-FR", "ja-JP", "en"])).toBe("ja");
    expect(detectLocale(["EN-gb"])).toBe("en");
  });
  it("falls back to English", () => {
    expect(detectLocale(["fr-FR", "zh-CN"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("errorMessage", () => {
  it("follows the current language and falls back to the generic text", () => {
    useLocaleStore.setState({ locale: "en" });
    expect(errorMessage("output_is_source")).toBe(dictionary("en").errors.output_is_source);
    expect(errorMessage("no_such_code")).toBe(dictionary("en").errors.generic);
    useLocaleStore.setState({ locale: "ja" });
    expect(errorMessage("io")).toBe(dictionary("ja").errors.io);
  });
});
