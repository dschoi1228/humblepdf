// Left thumbnail panel (SPEC 6.2): virtualized list, low-scale renders cached per page and
// rotation, rendered after the main view (lower priority). Click to go to a page.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../bindings/Page";
import { displayRotation } from "../coords";
import { useDocumentStore } from "../state/documentStore";
import type { SourceMeta } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { ko } from "../strings/ko";
import { computeLayout, pageDisplaySize, visibleRange } from "../viewer/layout";
import { renderPageCanvas } from "../viewer/pageRenderer";
import { PRIORITY, scheduler } from "../viewer/renderScheduler";

const THUMB_WIDTH = 120;
const LABEL_SPACE = 28;
const PADDING = 12;

/** Rendered thumbnails, by page id and rotation. */
const thumbCache = new Map<string, HTMLCanvasElement>();
export function clearThumbnails() {
  thumbCache.clear();
}

const Thumb = memo(function Thumb(props: {
  page: Page;
  meta: SourceMeta;
  index: number;
  top: number;
  width: number;
  height: number;
  current: boolean;
}) {
  const { page, meta } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheKey = `${page.id}:${displayRotation(page.baseRotation, page.userRotation)}`;
  const jobKey = `thumb:${cacheKey}`;

  useEffect(() => {
    const draw = (c: HTMLCanvasElement) => {
      const t = canvasRef.current;
      if (!t) return;
      t.width = c.width;
      t.height = c.height;
      t.getContext("2d")!.drawImage(c, 0, 0);
    };
    const cached = thumbCache.get(cacheKey);
    if (cached) {
      draw(cached);
      return;
    }
    const scale = THUMB_WIDTH / pageDisplaySize(page).w;
    scheduler.schedule(jobKey, PRIORITY.thumbnail, async (signal) => {
      const c = await renderPageCanvas(page, meta, scale, window.devicePixelRatio || 1, signal);
      if (signal.aborted) return;
      thumbCache.set(cacheKey, c);
      draw(c);
    });
    return () => scheduler.cancel(jobKey);
  }, [cacheKey, jobKey, page, meta]);

  return (
    <button
      type="button"
      className="absolute left-1/2 -translate-x-1/2 cursor-pointer text-center outline-none"
      style={{ top: props.top, width: props.width }}
      onClick={() => useViewStore.getState().goToPage(props.index)}
      aria-current={props.current ? "page" : undefined}
      data-testid="thumbnail"
    >
      <span
        className={
          "block bg-white shadow-sm ring-offset-2 ring-offset-neutral-100 " +
          (props.current ? "ring-2 ring-blue-600" : "ring-1 ring-neutral-300 hover:ring-neutral-500")
        }
        style={{ width: props.width, height: props.height }}
      >
        <canvas ref={canvasRef} className="block size-full" />
      </span>
      <span className="mt-1 block text-xs text-neutral-600">{ko.thumbnails.page(props.index + 1)}</span>
    </button>
  );
});

export function ThumbnailPanel() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const sources = useDocumentStore((s) => s.sources);
  const currentPage = useViewStore((s) => s.currentPage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 0 });

  const layout = useMemo(() => {
    const sizes = pages.map(pageDisplaySize);
    return computeLayout(sizes, (i) => THUMB_WIDTH / sizes[i].w, LABEL_SPACE, PADDING);
  }, [pages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => setVp({ top: el.scrollTop, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener("scroll", read, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", read);
    };
  }, []);

  // Keep the current page's thumbnail in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || currentPage >= layout.tops.length) return;
    const top = layout.tops[currentPage];
    const bottom = top + layout.heights[currentPage] + LABEL_SPACE;
    if (top < el.scrollTop) el.scrollTop = top - PADDING;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + PADDING;
  }, [currentPage, layout]);

  const [first, last] = visibleRange(layout, vp.top, vp.height || 1);
  const items = [];
  for (let i = Math.max(0, first - 2); i <= Math.min(pages.length - 1, last + 2); i++) {
    const page = pages[i];
    const meta = sources[page.sourceId];
    if (!meta) continue;
    items.push(
      <Thumb
        key={page.id}
        page={page}
        meta={meta}
        index={i}
        top={layout.tops[i]}
        width={layout.widths[i]}
        height={layout.heights[i]}
        current={i === currentPage}
      />,
    );
  }

  return (
    <nav
      ref={scrollRef}
      aria-label={ko.thumbnails.label}
      className="relative h-full w-[180px] shrink-0 overflow-y-auto border-r border-neutral-300 bg-neutral-100"
      data-testid="thumbnail-panel"
    >
      <div className="relative" style={{ height: layout.totalHeight + LABEL_SPACE }}>
        {items}
      </div>
    </nav>
  );
}
