// Search matches on one page (M14, D49): boxes over the glyphs of each match, the current one
// in a stronger colour. Screen only: nothing here is saved, printed or drawn in thumbnails,
// and the layer never takes the pointer.
import { useEffect, useRef, type RefObject } from "react";
import { useSearchStore } from "../search/searchStore";
import { itemRangeQuads } from "../viewer/textLayer";

/** Margin (px) the current match keeps from the edges of the view when it is revealed. */
const REVEAL_MARGIN = 48;
/** Last `reveal` request that has scrolled its match into view. */
let revealed = 0;

export function SearchLayer(props: { pageId: string; textRef: RefObject<HTMLDivElement | null>; textVersion: number; scale: number }) {
  const { pageId, textRef, textVersion, scale } = props;
  const ref = useRef<HTMLDivElement>(null);
  const hits = useSearchStore((s) => s.hits);
  const current = useSearchStore((s) => s.current);
  const reveal = useSearchStore((s) => s.reveal);

  // After the page's layout effects: the text layer has its new scale by then.
  useEffect(() => {
    const el = ref.current;
    const text = textRef.current;
    if (!el) return;
    el.replaceChildren();
    if (!text || !textVersion) return;
    const base = el.getBoundingClientRect();
    let currentBox: DOMRect | null = null;
    hits.forEach((hit, i) => {
      if (hit.pageId !== pageId) return;
      for (const q of itemRangeQuads(text, hit.match)) {
        const xs = q.map((p) => p.x);
        const ys = q.map((p) => p.y);
        const box = new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const d = document.createElement("div");
        d.className = i === current ? "search-hit search-hit-current" : "search-hit";
        d.dataset.testid = i === current ? "search-hit-current" : "search-hit";
        Object.assign(d.style, {
          left: `${box.left - base.left}px`,
          top: `${box.top - base.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        el.append(d);
        if (i === current && !currentBox) currentBox = box;
      }
    });
    if (currentBox && reveal !== revealed) {
      revealed = reveal;
      scrollIntoView(el, currentBox);
    }
  }, [hits, current, reveal, pageId, textRef, textVersion, scale]);

  return <div ref={ref} className="pointer-events-none absolute inset-0" style={{ mixBlendMode: "multiply" }} data-testid="search-layer" />;
}

/** Scrolls the page view so `box` (client px) is inside it, centred when it was outside. */
function scrollIntoView(from: HTMLElement, box: DOMRect) {
  const view = from.closest<HTMLElement>("[data-testid=page-view]");
  if (!view) return;
  const v = view.getBoundingClientRect();
  const m = Math.min(REVEAL_MARGIN, v.height / 4, v.width / 4);
  if (box.top < v.top + m || box.bottom > v.bottom - m) view.scrollTop += box.top + box.height / 2 - (v.top + v.height / 2);
  if (box.left < v.left + m || box.right > v.right - m) view.scrollLeft += box.left + box.width / 2 - (v.left + v.width / 2);
}
