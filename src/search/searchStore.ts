// Search in the document (M14, D49): the find bar's query, the matches over every PDF page in
// document order and the current one. Searching only reads: the document and its Undo
// history are untouched.
import { create } from "zustand";
import { useDocumentStore } from "../state/documentStore";
import { useViewStore } from "../state/viewStore";
import { loadPageText } from "../viewer/sourceCache";
import { buildPageText, findInPage, normalizeQuery, type Match, type PageText } from "./match";

export type Hit = { pageId: string; match: Match };

type SearchState = {
  open: boolean;
  query: string;
  hits: Hit[];
  /** Index into `hits`; -1 when there is none. */
  current: number;
  /** True while pages are still being searched. */
  searching: boolean;
  /** Bumped to scroll the current match into view. */
  reveal: number;
  /** Bumped to focus (and select) the query field. */
  focus: number;

  /** Opens the bar (Ctrl+F); `prefill` replaces the query. */
  openBar: (prefill?: string) => void;
  setQuery: (query: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
};

/** Pages searched between two updates of the results. */
const PAGES_PER_UPDATE = 20;

let run = 0;
const pageTexts = new Map<string, PageText>();

/** Searchable text of a document page (cached by source page). */
async function textOf(sourceId: string, pageIndex: number): Promise<PageText | null> {
  const key = `${sourceId}#${pageIndex}`;
  const cached = pageTexts.get(key);
  if (cached) return cached;
  const meta = useDocumentStore.getState().sources[sourceId];
  if (!meta || meta.info.kind !== "pdf") return null;
  try {
    const t = buildPageText(await loadPageText(meta, pageIndex));
    pageTexts.set(key, t);
    return t;
  } catch {
    // An unreadable page has no text to search.
    return null;
  }
}

const sameMatch = (a: Hit, b: Hit) =>
  a.pageId === b.pageId &&
  a.match.start.item === b.match.start.item &&
  a.match.start.offset === b.match.start.offset;

/**
 * Searches every page for the current query. `keep` is the hit to stay on (the document
 * changed); otherwise the first hit at or after the page in view becomes current.
 */
async function search(keep: Hit | null) {
  const id = ++run;
  const { query } = useSearchStore.getState();
  if (!normalizeQuery(query)) {
    useSearchStore.setState({ hits: [], current: -1, searching: false });
    return;
  }
  const pages = useDocumentStore.getState().doc.pages;
  const startPage = useViewStore.getState().currentPage;
  useSearchStore.setState({ searching: true });
  const hits: Hit[] = [];
  let current = -1;
  const publish = (done: boolean) => {
    let found = false;
    if (current < 0 && (done || hits.length)) {
      const k = keep ? hits.findIndex((h) => sameMatch(h, keep)) : -1;
      if (k >= 0) current = k;
      else if (!keep) {
        const index = new Map(pages.map((p, i) => [p.id, i]));
        const after = hits.findIndex((h) => index.get(h.pageId)! >= startPage);
        if (after >= 0) current = after;
      }
      if (current < 0 && done && hits.length) current = 0;
      found = current >= 0 && !keep;
    }
    useSearchStore.setState({ hits: [...hits], current, searching: !done });
    // The first current match of a new query is brought into view (after it is in the state).
    if (found) useSearchStore.setState({ reveal: useSearchStore.getState().reveal + 1 });
  };
  for (const [i, page] of pages.entries()) {
    const text = await textOf(page.sourceId, page.pageIndex);
    if (id !== run) return;
    if (text) for (const match of findInPage(text, query)) hits.push({ pageId: page.id, match });
    if ((i + 1) % PAGES_PER_UPDATE === 0) publish(false);
  }
  publish(true);
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: "",
  hits: [],
  current: -1,
  searching: false,
  reveal: 0,
  focus: 0,

  openBar: (prefill) => {
    const changed = prefill !== undefined && prefill !== get().query;
    set({ open: true, focus: get().focus + 1, ...(changed ? { query: prefill } : {}) });
    if (changed || !get().hits.length) void search(null);
  },
  setQuery: (query) => {
    if (query === get().query) return;
    set({ query });
    void search(null);
  },
  next: () => step(1),
  prev: () => step(-1),
  close: () => {
    run++;
    set({ open: false, hits: [], current: -1, searching: false });
  },
}));

function step(dir: 1 | -1) {
  const { hits, current, reveal } = useSearchStore.getState();
  if (!hits.length) return;
  const next = current < 0 ? (dir === 1 ? 0 : hits.length - 1) : (current + dir + hits.length) % hits.length;
  useSearchStore.setState({ current: next, reveal: reveal + 1 });
}

/** Index of the current hit's page in the document, or -1. */
export function currentHitPage(): number {
  const { hits, current } = useSearchStore.getState();
  const hit = hits[current];
  if (!hit) return -1;
  return useDocumentStore.getState().doc.pages.findIndex((p) => p.id === hit.pageId);
}

// A current match on a page that is not mounted: go there first; the page's search layer
// scrolls the match itself into view once its text is laid out.
let lastReveal = 0;
useSearchStore.subscribe((s) => {
  if (s.reveal === lastReveal) return;
  lastReveal = s.reveal;
  const i = currentHitPage();
  if (i >= 0 && !document.querySelector(`[data-testid=page][data-page-index="${i}"]`)) useViewStore.getState().goToPage(i);
});

// Pages added, removed or reordered: search again, staying on the same match when it is left.
let pageKey = "";
useDocumentStore.subscribe((s) => {
  const key = s.doc.pages.map((p) => `${p.id}:${p.sourceId}:${p.pageIndex}`).join(",");
  if (key === pageKey) return;
  pageKey = key;
  if (s.doc.pages.length === 0) pageTexts.clear();
  const { open, hits, current } = useSearchStore.getState();
  if (open) void search(hits[current] ?? null);
});
