// Finding a query in the text of one page (M14, D49). Pure functions: the page text is the
// list of pdf.js text items (one span each in the text layer), and a match points back into
// those items so it can be drawn over the glyphs.
//
// Matching ignores case and compares Unicode compatibility forms (NFKC: full-width and
// half-width forms, ligatures). A run of white space in the query matches a run of white
// space or a line end in the text.

/** A pdf.js text item: its string and whether a line ends after it. */
export type TextItem = { str: string; hasEOL?: boolean };

/** A place in the page text: text item index and UTF-16 offset in that item's string. */
export type TextPos = { item: number; offset: number };
export type Match = { start: TextPos; end: TextPos };

/** Searchable form of a page: normalized characters, each mapped to its source range. */
export type PageText = {
  text: string;
  /** For each UTF-16 unit of `text`: the item and the source range [start, end) it came from. */
  map: { item: number; start: number; end: number }[];
};

const SPACE = /\s/u;

/** Normalized form of one source character (may be empty or several characters). */
function fold(ch: string): string {
  return ch.normalize("NFKC").toLowerCase();
}

/** Builds the searchable text of a page; white space runs and line ends become one space. */
export function buildPageText(items: readonly TextItem[]): PageText {
  let text = "";
  const map: PageText["map"] = [];
  const push = (s: string, item: number, start: number, end: number) => {
    for (const unit of s) {
      const space = SPACE.test(unit);
      if (space && (text === "" || text.endsWith(" "))) continue;
      const out = space ? " " : unit;
      for (let k = 0; k < out.length; k++) map.push({ item, start, end });
      text += out;
    }
  };
  items.forEach((it, i) => {
    let offset = 0;
    for (const ch of it.str) {
      push(fold(ch), i, offset, offset + ch.length);
      offset += ch.length;
    }
    if (it.hasEOL) push(" ", i, it.str.length, it.str.length);
  });
  return { text, map };
}

/** The query in searchable form: normalized, white space runs collapsed, trimmed. */
export function normalizeQuery(query: string): string {
  let out = "";
  for (const ch of query) out += fold(ch);
  return out.replace(/\s+/gu, " ").trim();
}

/** Every match of `query` in the page, in text order, not overlapping. */
export function findInPage(page: PageText, query: string): Match[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const out: Match[] = [];
  let from = 0;
  for (;;) {
    const at = page.text.indexOf(q, from);
    if (at < 0) break;
    const first = page.map[at];
    const last = page.map[at + q.length - 1];
    out.push({ start: { item: first.item, offset: first.start }, end: { item: last.item, offset: last.end } });
    from = at + q.length;
  }
  return out;
}
