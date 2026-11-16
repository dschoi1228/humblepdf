// Continuous vertical page view (SPEC 6.2). Only pages in or near the viewport are mounted
// and rendered; renders for pages that leave are cancelled.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../bindings/Page";
import { displayRotation } from "../coords";
import { useDocumentStore } from "../state/documentStore";
import type { SourceMeta } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { ko } from "../strings/ko";
import {
  computeLayout,
  currentPageAt,
  fitPageScale,
  fitWidthScale,
  pageAtY,
  pageDisplaySize,
  VIEW_PADDING,
  visibleRange,
  type Layout,
} from "../viewer/layout";
import { renderPageCanvas } from "../viewer/pageRenderer";
import { PRIORITY, scheduler } from "../viewer/renderScheduler";
import { markMainRendered } from "../viewer/testHooks";
import { getPageBitmap, putPageBitmap } from "../viewer/pageBitmapCache";

/** Pages mounted above and below the visible range. */
const OVERSCAN = 2;
/** Delay before re-rendering a page that already shows a (stretched) bitmap. */
const RERENDER_DELAY_MS = 150;

type Viewport = { top: number; left: number; width: number; height: number };

const PageSlot = memo(function PageSlot(props: {
  page: Page;
  meta: SourceMeta;
  index: number;
  scale: number;
  priority: number;
  top: number;
  left: number;
  width: number;
  height: number;
}) {
  const { page, meta, scale, priority } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const key = `main:${page.id}`;
  const rotation = displayRotation(page.baseRotation, page.userRotation);

  /** Whether the canvas shows a bitmap (at any scale); also exposed for tests. */
  const hasPixels = useRef(false);
  const show = useCallback((c: HTMLCanvasElement) => {
    const target = canvasRef.current;
    if (!target) return;
    target.width = c.width;
    target.height = c.height;
    target.getContext("2d")!.drawImage(c, 0, 0);
    hasPixels.current = true;
    target.dataset.hasPixels = "1";
  }, []);

  // A remounted page shows its last bitmap before the first paint (no blank flash).
  useLayoutEffect(() => {
    if (hasPixels.current) return;
    const cached = getPageBitmap(page.id, rotation);
    if (cached) show(cached);
  }, [page.id, rotation, show]);

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const run = () =>
      scheduler.schedule(key, priority, async (signal) => {
        let c: HTMLCanvasElement;
        try {
          c = await renderPageCanvas(page, meta, scale, dpr, signal);
        } catch (e) {
          if (!signal.aborted && (e as Error)?.name !== "RenderAborted") setFailed(true);
          throw e;
        }
        if (signal.aborted || !canvasRef.current) return;
        show(c);
        putPageBitmap(page.id, rotation, c);
        setFailed(false);
        markMainRendered(page.id, true);
      });
    // A page that already shows a bitmap keeps it (stretched by CSS) while the zoom is
    // still changing, and re-renders once the scale has settled.
    if (hasPixels.current) {
      const t = setTimeout(run, RERENDER_DELAY_MS);
      return () => {
        clearTimeout(t);
        scheduler.cancel(key);
      };
    }
    run();
    return () => scheduler.cancel(key);
    // `priority` changes are handled below without re-rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, meta, scale, rotation, show]);

  useEffect(() => scheduler.reprioritize(key, priority), [key, priority]);
  useEffect(() => () => markMainRendered(page.id, false), [page.id]);


  return (
    <div
      className="absolute bg-white shadow-[0_1px_4px_rgb(0_0_0/0.25)]"
      style={{ top: props.top, left: props.left, width: props.width, height: props.height }}
      data-page-index={props.index}
      data-testid="page"
    >
      <canvas ref={canvasRef} className="block size-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center text-sm text-destructive">{ko.pageFailed}</div>
      )}
    </div>
  );
});

export function PageView() {
  const doc = useDocumentStore((s) => s.doc);
  const sources = useDocumentStore((s) => s.sources);
  const scale = useViewStore((s) => s.scale);
  const zoomMode = useViewStore((s) => s.zoomMode);
  const goTo = useViewStore((s) => s.goTo);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ top: 0, left: 0, width: 0, height: 0 });

  const sizes = useMemo(() => doc.pages.map(pageDisplaySize), [doc.pages]);
  const layout = useMemo(() => computeLayout(sizes, () => scale), [sizes, scale]);
  const contentWidth = Math.max(layout.maxWidth + 2 * VIEW_PADDING, vp.width);

  // Track scroll position and size (one state update per frame).
  const frame = useRef(0);
  const readViewport = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) setVp({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
    });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(readViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [readViewport]);

  // Fit modes: recompute on mode, container size or document change (not while scrolling).
  useEffect(() => {
    if (zoomMode === "custom" || !sizes.length || !vp.width) return;
    const view = useViewStore.getState();
    const s =
      zoomMode === "fitWidth"
        ? fitWidthScale({ w: Math.max(...sizes.map((z) => z.w)), h: 1 }, vp.width)
        : fitPageScale(sizes[Math.min(view.currentPage, sizes.length - 1)], vp.width, vp.height);
    if (Math.abs(s - view.scale) > 1e-4) view.setFitScale(s);
  }, [zoomMode, sizes, vp.width, vp.height]);

  // Keep the same document point in place when the scale changes (cursor or viewport top).
  const prevLayout = useRef<{ layout: Layout; contentWidth: number } | null>(null);
  useLayoutEffect(() => {
    const prev = prevLayout.current;
    prevLayout.current = { layout, contentWidth };
    const el = scrollRef.current;
    if (!el || !prev || prev.layout === layout || !prev.layout.tops.length || !layout.tops.length) return;
    if (prev.layout.tops.length !== layout.tops.length) return;
    const anchor = useViewStore.getState().zoomAnchor;
    const rect = el.getBoundingClientRect();
    const offY = anchor ? anchor.clientY - rect.top : 0;
    const offX = anchor ? anchor.clientX - rect.left : el.clientWidth / 2;
    const y = el.scrollTop + offY;
    const i = Math.max(0, pageAtY(prev.layout, y));
    const fracY = (y - prev.layout.tops[i]) / prev.layout.heights[i];
    const prevLeft = (prev.contentWidth - prev.layout.widths[i]) / 2;
    const fracX = (el.scrollLeft + offX - prevLeft) / prev.layout.widths[i];
    const newLeft = (contentWidth - layout.widths[i]) / 2;
    el.scrollTop = layout.tops[i] + fracY * layout.heights[i] - offY;
    el.scrollLeft = newLeft + fracX * layout.widths[i] - offX;
    if (anchor) useViewStore.getState().consumeAnchor();
    readViewport();
  }, [layout, contentWidth, readViewport]);

  // Navigation requests (page input, thumbnails).
  useEffect(() => {
    const el = scrollRef.current;
    if (!goTo || !el || !layout.tops.length) return;
    const i = Math.min(Math.max(goTo.page, 0), layout.tops.length - 1);
    el.scrollTop = layout.tops[i] - VIEW_PADDING / 2;
    readViewport();
    // Only on a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo?.nonce]);

  // Ctrl+wheel zoom around the cursor (non-passive listener so the browser zoom is blocked).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last < 60 || e.deltaY === 0) return;
      last = now;
      useViewStore.getState().zoomStep(e.deltaY < 0 ? 1 : -1, { clientX: e.clientX, clientY: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const [first, last] = visibleRange(layout, vp.top, vp.height || 1);
  useEffect(() => {
    if (layout.tops.length) useViewStore.getState().setCurrentPage(currentPageAt(layout, vp.top, vp.height));
  }, [layout, vp.top, vp.height]);

  const from = Math.max(0, first - OVERSCAN);
  const to = Math.min(doc.pages.length - 1, last + OVERSCAN);
  const slots = [];
  for (let i = from; i <= to; i++) {
    const page = doc.pages[i];
    const meta = sources[page.sourceId];
    if (!meta) continue;
    slots.push(
      <PageSlot
        key={page.id}
        page={page}
        meta={meta}
        index={i}
        scale={scale}
        priority={i >= first && i <= last ? PRIORITY.visible : PRIORITY.nearby}
        top={layout.tops[i]}
        left={(contentWidth - layout.widths[i]) / 2}
        width={layout.widths[i]}
        height={layout.heights[i]}
      />,
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={readViewport}
      className="relative h-full overflow-auto bg-neutral-200"
      data-testid="page-view"
      data-scale={scale}
    >
      <div className="relative" style={{ height: layout.totalHeight, width: contentWidth }}>
        {slots}
      </div>
    </div>
  );
}
