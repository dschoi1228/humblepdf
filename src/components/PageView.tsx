// Continuous vertical page view (SPEC 6.2). Only pages in or near the viewport are mounted
// and rendered; renders for pages that leave are cancelled.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../bindings/Page";
import { useDocumentStore } from "../state/documentStore";
import type { SourceMeta } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { useStrings } from "../i18n";
import { displayRotation, viewportTransform } from "../coords";
import { ObjectLayer } from "./ObjectLayer";
import { SearchLayer } from "./SearchLayer";
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
import { renderLook, renderPageCanvas } from "../viewer/pageRenderer";
import { PRIORITY, scheduler } from "../viewer/renderScheduler";
import { markMainRendered } from "../viewer/testHooks";
import { getPageBitmap, putPageBitmap } from "../viewer/pageBitmapCache";
import { installTextSelection, renderTextLayer, setTextLayerScale, TEXT_LAYER_CLASS } from "../viewer/textLayer";
import { loadSource } from "../viewer/sourceCache";

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
  const t = useStrings();
  const { page, meta, scale, priority } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  /** The canvas has shown a bitmap once: the text layer waits for it (first paint first). */
  const [painted, setPainted] = useState(false);
  /** Bumped each time the text layer is laid out anew (search boxes follow it). */
  const [textVersion, setTextVersion] = useState(0);
  const key = `main:${page.id}`;
  const look = renderLook(page);
  // Object edits change `page` but not its pixels: the render effect reads the latest page
  // from a ref and runs only when the source page, its look or the scale changes.
  const pageRef = useRef(page);
  useLayoutEffect(() => {
    pageRef.current = page;
  });
  const sourcePage = `${page.sourceId}#${page.pageIndex}`;
  const transform = useMemo(
    () => viewportTransform(page.box, displayRotation(page.baseRotation, page.userRotation), scale),
    [page.box, page.baseRotation, page.userRotation, scale],
  );

  /** Look of the bitmap on the canvas (at any scale), or null when blank. */
  const shown = useRef<string | null>(null);
  const show = useCallback((c: HTMLCanvasElement, l: string) => {
    const target = canvasRef.current;
    if (!target) return;
    target.width = c.width;
    target.height = c.height;
    target.getContext("2d")!.drawImage(c, 0, 0);
    shown.current = l;
    target.dataset.hasPixels = "1";
    setPainted(true);
  }, []);

  // Before the first paint: a remounted page shows its last bitmap (no blank flash), and a
  // rotated page or one with another fit drops its old picture instead of stretching it.
  useLayoutEffect(() => {
    if (shown.current === look) return;
    const cached = getPageBitmap(page.id, look);
    if (cached) show(cached, look);
    else if (shown.current !== null && canvasRef.current) {
      canvasRef.current.width = 0;
      shown.current = null;
      delete canvasRef.current.dataset.hasPixels;
    }
  }, [page.id, look, show]);

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const run = () =>
      scheduler.schedule(key, priority, async (signal) => {
        let c: HTMLCanvasElement;
        try {
          c = await renderPageCanvas(pageRef.current, meta, scale, dpr, signal);
        } catch (e) {
          if (!signal.aborted && (e as Error)?.name !== "RenderAborted") setFailed(true);
          throw e;
        }
        if (signal.aborted || !canvasRef.current) return;
        show(c, look);
        putPageBitmap(page.id, look, c);
        setFailed(false);
        markMainRendered(page.id, true);
      });
    // A page that already shows a bitmap keeps it (stretched by CSS) while the zoom is
    // still changing, and re-renders once the scale has settled.
    if (shown.current === look) {
      const timer = setTimeout(run, RERENDER_DELAY_MS);
      return () => {
        clearTimeout(timer);
        scheduler.cancel(key);
      };
    }
    run();
    return () => scheduler.cancel(key);
    // `priority` changes are handled below without re-rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sourcePage, meta, scale, look, show]);

  useEffect(() => scheduler.reprioritize(key, priority), [key, priority]);

  // Selectable text (M12, D47): PDF pages only, built once per source page and rotation;
  // a zoom only changes the CSS scale it is laid out with.
  const rotation = displayRotation(page.baseRotation, page.userRotation);
  const scaleRef = useRef(scale);
  useLayoutEffect(() => {
    scaleRef.current = scale;
    if (textRef.current) setTextLayerScale(textRef.current, scale);
  }, [scale]);
  useEffect(() => {
    const div = textRef.current;
    if (!div || !painted || meta.info.kind !== "pdf") return;
    const ac = new AbortController();
    void (async () => {
      const src = await loadSource(meta);
      if (ac.signal.aborted || src.kind !== "pdf") return;
      const pdfPage = await src.doc.getPage(pageRef.current.pageIndex + 1);
      if (ac.signal.aborted) return;
      await renderTextLayer(div, pdfPage, scaleRef.current, rotation, ac.signal);
      if (ac.signal.aborted) return;
      div.dataset.ready = "1";
      setTextVersion((v) => v + 1);
    })().catch(() => {
      // No text layer: the page still shows; only selection is unavailable.
    });
    return () => {
      ac.abort();
      delete div.dataset.ready;
    };
  }, [sourcePage, meta, rotation, painted]);
  useEffect(() => () => markMainRendered(page.id, false), [page.id]);


  return (
    <div
      className="absolute bg-white shadow-[0_1px_4px_rgb(0_0_0/0.25)]"
      style={{ top: props.top, left: props.left, width: props.width, height: props.height }}
      data-page-index={props.index}
      data-testid="page"
    >
      <canvas ref={canvasRef} className="block size-full" />
      {meta.info.kind === "pdf" && <SearchLayer pageId={page.id} textRef={textRef} textVersion={textVersion} scale={scale} />}
      {meta.info.kind === "pdf" && <div ref={textRef} className={TEXT_LAYER_CLASS} data-testid="text-layer" />}
      <ObjectLayer page={page} transform={transform} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center text-sm text-destructive">{t.pageFailed}</div>
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
  useEffect(installTextSelection, []);

  const sizes = useMemo(() => doc.pages.map(pageDisplaySize), [doc.pages]);
  const layout = useMemo(() => computeLayout(sizes, () => scale), [sizes, scale]);
  const contentWidth = Math.max(layout.maxWidth + 2 * VIEW_PADDING, vp.width);

  // Track scroll position and size.
  const syncViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = { top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight };
    setVp((v) =>
      v.top === next.top && v.left === next.left && v.width === next.width && v.height === next.height ? v : next,
    );
  }, []);
  // User scrolling: at most one update per frame.
  const frame = useRef(0);
  const readViewport = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(syncViewport);
  }, [syncViewport]);
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
        : // Every page fits whole, like fit-width takes the widest page: in a document with
          // upright and sideways pages none is cut off, and scrolling does not change the zoom.
          Math.min(...sizes.map((z) => fitPageScale(z, vp.width, vp.height)));
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
    // Update the visible range before the browser paints. Waiting for the next frame
    // painted one frame with the old scroll position: pages missing, grey background
    // flashing (M1 human check).
    syncViewport();
  }, [layout, contentWidth, syncViewport]);

  // Navigation requests (page input, thumbnails); applied before paint like zoom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!goTo || !el || !layout.tops.length) return;
    const i = Math.min(Math.max(goTo.page, 0), layout.tops.length - 1);
    el.scrollTop = layout.tops[i] - VIEW_PADDING / 2;
    syncViewport();
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
      className="relative h-full overflow-auto bg-neutral-200 select-none"
      data-testid="page-view"
      data-scale={scale}
    >
      <div className="relative" style={{ height: layout.totalHeight, width: contentWidth }}>
        {slots}
      </div>
    </div>
  );
}
