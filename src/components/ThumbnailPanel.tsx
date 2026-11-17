// Left thumbnail panel (SPEC 6.2, 6.3): virtualized list, low-scale renders cached per page
// and look (rotation, fit), rendered after the main view (lower priority).
// Click selects and goes to a page (Ctrl toggles, Shift selects a range); dragging moves the
// selected pages with pointer events (D24); right click opens the page menu.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Page } from "../bindings/Page";
import { movePagesTo } from "../app/pageActions";
import { useDocumentStore } from "../state/documentStore";
import type { SourceMeta } from "../state/model";
import { useViewStore } from "../state/viewStore";
import { useStrings } from "../i18n";
import { computeLayout, pageDisplaySize, visibleRange } from "../viewer/layout";
import { renderLook, renderPageCanvas } from "../viewer/pageRenderer";
import { PRIORITY, scheduler } from "../viewer/renderScheduler";
import { thumbCache } from "../viewer/thumbCache";
import { autoScrollStep, DRAG_THRESHOLD, dropIndex, dropLineY } from "../viewer/thumbDrag";
import { PageContextMenu } from "./PageContextMenu";
import { ObjectsView } from "./ObjectLayer";
import { displayRotation, viewportTransform } from "../coords";

const THUMB_WIDTH = 120;
const LABEL_SPACE = 28;
const PADDING = 12;


type PressHandler = (e: ReactPointerEvent, page: Page, index: number) => void;
type ClickHandler = (e: React.MouseEvent, page: Page, index: number) => void;

const Thumb = memo(function Thumb(props: {
  page: Page;
  meta: SourceMeta;
  index: number;
  top: number;
  width: number;
  height: number;
  current: boolean;
  selected: boolean;
  dimmed: boolean;
  onPress: PressHandler;
  onClick: ClickHandler;
}) {
  const t = useStrings();
  const { page, meta, index, onPress, onClick } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheKey = `${page.id}:${renderLook(page)}`;
  const jobKey = `thumb:${cacheKey}`;
  const transform = useMemo(
    () =>
      viewportTransform(
        page.box,
        displayRotation(page.baseRotation, page.userRotation),
        props.width / pageDisplaySize(page).w,
      ),
    [page, props.width],
  );

  useEffect(() => {
    const draw = (c: HTMLCanvasElement) => {
      const target = canvasRef.current;
      if (!target) return;
      target.width = c.width;
      target.height = c.height;
      target.getContext("2d")!.drawImage(c, 0, 0);
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

  const ring = props.selected
    ? "ring-3 ring-blue-500"
    : props.current
      ? "ring-2 ring-blue-300"
      : "ring-1 ring-neutral-300 hover:ring-neutral-500";
  return (
    <button
      type="button"
      className={
        "absolute left-1/2 -translate-x-1/2 cursor-pointer text-center outline-none transition-opacity " +
        (props.dimmed ? "opacity-35" : "")
      }
      style={{ top: props.top, width: props.width }}
      onPointerDown={(e) => onPress(e, page, index)}
      onClick={(e) => onClick(e, page, index)}
      aria-current={props.current ? "page" : undefined}
      aria-selected={props.selected}
      data-page-id={page.id}
      data-testid="thumbnail"
    >
      <span
        className={"relative block bg-white shadow-sm ring-offset-2 ring-offset-neutral-100 " + ring}
        style={{ width: props.width, height: props.height }}
      >
        <canvas ref={canvasRef} className="block size-full" />
        <ObjectsView objects={page.objects} transform={transform} />
      </span>
      <span className={"mt-1 block text-xs " + (props.selected ? "font-semibold text-blue-700" : "text-neutral-600")}>
        {t.thumbnails.page(index + 1)}
      </span>
    </button>
  );
});

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  ids: Set<string>;
  active: boolean;
};

export function ThumbnailPanel() {
  const t = useStrings();
  const pages = useDocumentStore((s) => s.doc.pages);
  const sources = useDocumentStore((s) => s.sources);
  const selected = useDocumentStore((s) => s.selection.ids);
  const currentPage = useViewStore((s) => s.currentPage);
  const scrollRef = useRef<HTMLElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 0 });

  const layout = useMemo(() => {
    const sizes = pages.map(pageDisplaySize);
    return computeLayout(sizes, (i) => THUMB_WIDTH / sizes[i].w, LABEL_SPACE, PADDING);
  }, [pages]);
  // Read by pointer handlers registered once.
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

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

  // ---- Drag to reorder (D24) ----
  const drag = useRef<Drag | null>(null);
  /** A drag just ended on a thumbnail: ignore the click that follows. */
  const suppressClick = useRef(false);
  const [dragView, setDragView] = useState<{ ids: Set<string>; index: number; x: number; y: number } | null>(null);

  const indexAt = useCallback((clientY: number) => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    return dropIndex(layoutRef.current, y);
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragView(null);
  }, []);

  useEffect(() => {
    if (!dragView) return;
    // Auto-scroll near the panel edges while dragging.
    let raf = 0;
    const tick = () => {
      const d = drag.current;
      const el = scrollRef.current;
      if (!d?.active || !el) return;
      const r = el.getBoundingClientRect();
      const step = autoScrollStep(d.clientY, r.top, r.bottom);
      if (step) {
        el.scrollTop += step;
        const index = indexAt(d.clientY);
        setDragView((v) => (v && v.index !== index ? { ...v, index } : v));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart only when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragView !== null, indexAt]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.clientX = e.clientX;
      d.clientY = e.clientY;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
        d.active = true;
        window.getSelection()?.removeAllRanges();
      }
      setDragView({ ids: d.ids, index: indexAt(e.clientY), x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.active) {
        suppressClick.current = true;
        // A click event (if any) is dispatched right after pointerup.
        setTimeout(() => (suppressClick.current = false), 0);
        movePagesTo(d.ids, indexAt(e.clientY));
      }
      endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current?.active) {
        e.preventDefault();
        endDrag();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [endDrag, indexAt]);

  const onPress = useCallback<PressHandler>((e, page) => {
    if (e.button !== 0) return;
    const sel = useDocumentStore.getState().selection.ids;
    // Dragging a selected page moves the whole selection; otherwise just that page.
    const ids = sel.has(page.id) ? new Set(sel) : new Set([page.id]);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      ids,
      active: false,
    };
  }, []);

  const onClick = useCallback<ClickHandler>((e, page, index) => {
    if (suppressClick.current) return;
    useDocumentStore.getState().click(page.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    if (!e.ctrlKey && !e.shiftKey) useViewStore.getState().goToPage(index);
  }, []);

  // Right click on a page that is not selected selects only that page first.
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-page-id]")?.dataset.pageId;
    const st = useDocumentStore.getState();
    if (id && !st.selection.ids.has(id)) st.click(id, { ctrl: false, shift: false });
  }, []);

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
        selected={selected.has(page.id)}
        dimmed={!!dragView?.ids.has(page.id)}
        onPress={onPress}
        onClick={onClick}
      />,
    );
  }

  return (
    <PageContextMenu>
      <nav
        ref={scrollRef}
        aria-label={t.thumbnails.label}
        className={
          "relative h-full w-[180px] shrink-0 overflow-y-auto border-r border-neutral-300 bg-neutral-100 select-none " +
          (dragView ? "cursor-grabbing" : "")
        }
        onContextMenu={onContextMenu}
        data-testid="thumbnail-panel"
        data-dragging={dragView ? "1" : undefined}
      >
        <div className="relative" style={{ height: layout.totalHeight + LABEL_SPACE }}>
          {items}
          {dragView && (
            <div
              className="pointer-events-none absolute right-2 left-2 h-[3px] rounded-full bg-blue-600"
              style={{ top: dropLineY(layout, dragView.index, LABEL_SPACE) - 1 }}
              data-testid="drop-line"
              data-index={dragView.index}
            />
          )}
        </div>
        {dragView && (
          <div
            className="pointer-events-none fixed z-50 rounded bg-blue-600 px-2 py-0.5 text-xs text-white shadow"
            style={{ left: dragView.x + 14, top: dragView.y + 10 }}
          >
            {t.thumbnails.dragging(dragView.ids.size)}
          </div>
        )}
      </nav>
    </PageContextMenu>
  );
}
