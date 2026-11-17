// Read-only numbers exposed on `window.__viewer` for E2E tests and measurements.
import type { Document } from "../bindings/Document";
import type { Point } from "../bindings/Point";
import { displayRotation, toScreen, toUser, viewportTransform, type PageTransform } from "../coords";
import { useEditorStore } from "../editor/editorStore";
import { isDirty, useDocumentStore } from "../state/documentStore";
import { useViewStore } from "../state/viewStore";
import { scheduler, type RenderStats } from "./renderScheduler";

const renderedMain = new Set<string>();
let maxRenderedMain = 0;
let firstRenderAt: number | null = null;

export function markMainRendered(pageId: string, rendered: boolean): void {
  if (rendered) {
    renderedMain.add(pageId);
    maxRenderedMain = Math.max(maxRenderedMain, renderedMain.size);
    firstRenderAt ??= performance.now();
  } else {
    renderedMain.delete(pageId);
  }
}

export type ViewerHooks = {
  stats: RenderStats;
  /** Page views currently holding rendered pixels. */
  renderedMain: () => number;
  maxRenderedMain: () => number;
  resetMax: () => void;
  firstRenderAt: () => number | null;
  /** Source file name of each page, in document order. */
  pageSources: () => string[];
  view: () => { scale: number; currentPage: number; zoomMode: string };
  /** Pages as `<source name>#<page index + 1>` with rotation and fit, in document order. */
  pageLabels: () => string[];
  model: () => Document;
  selected: () => string[];
  dirty: () => boolean;
  savePath: () => string | null;
  /** Current tool and selected object. */
  editor: () => { tool: string; selected: { pageId: string; objectId: string } | null };
  /** Number of Undo steps available. */
  undoDepth: () => number;
  /** Client (viewport) coordinates of a user-space point on a mounted page. */
  clientPoint: (pageIndex: number, x: number, y: number) => Point;
  /** User-space point under client coordinates on a mounted page. */
  userPoint: (pageIndex: number, clientX: number, clientY: number) => Point;
};

/** Page element rectangle and page transform at the current zoom. */
function mountedPage(pageIndex: number): { left: number; top: number; t: PageTransform } {
  const el = document.querySelector(`[data-testid=page][data-page-index="${pageIndex}"]`);
  if (!el) throw new Error(`page ${pageIndex} is not mounted`);
  const r = el.getBoundingClientRect();
  const p = useDocumentStore.getState().doc.pages[pageIndex];
  const t = viewportTransform(p.box, displayRotation(p.baseRotation, p.userRotation), useViewStore.getState().scale);
  return { left: r.left, top: r.top, t };
}

const hooks: ViewerHooks = {
  stats: scheduler.stats,
  renderedMain: () => renderedMain.size,
  maxRenderedMain: () => maxRenderedMain,
  resetMax: () => {
    maxRenderedMain = renderedMain.size;
  },
  firstRenderAt: () => firstRenderAt,
  pageSources: () => {
    const { doc, sources } = useDocumentStore.getState();
    return doc.pages.map((p) => sources[p.sourceId]?.name ?? "?");
  },
  pageLabels: () => {
    const { doc, sources } = useDocumentStore.getState();
    return doc.pages.map((p) => {
      const name = sources[p.sourceId]?.name ?? "?";
      const rot = p.userRotation ? ` r${p.userRotation}` : "";
      const fit = p.imageFit && p.imageFit !== "a4" ? ` ${p.imageFit}` : "";
      return `${name}#${p.pageIndex + 1}${rot}${fit}`;
    });
  },
  model: () => useDocumentStore.getState().doc,
  selected: () => {
    const { doc, selection } = useDocumentStore.getState();
    return doc.pages.flatMap((p, i) => (selection.ids.has(p.id) ? [String(i + 1)] : []));
  },
  dirty: () => isDirty(useDocumentStore.getState()),
  savePath: () => useDocumentStore.getState().savePath,
  editor: () => {
    const { tool, selected } = useEditorStore.getState();
    return { tool, selected };
  },
  undoDepth: () => useDocumentStore.getState().history.past.length,
  clientPoint: (pageIndex, x, y) => {
    const { left, top, t } = mountedPage(pageIndex);
    const s = toScreen(t, { x, y });
    return { x: left + s.x, y: top + s.y };
  },
  userPoint: (pageIndex, clientX, clientY) => {
    const { left, top, t } = mountedPage(pageIndex);
    return toUser(t, { x: clientX - left, y: clientY - top });
  },
  view: () => {
    const v = useViewStore.getState();
    return { scale: v.scale, currentPage: v.currentPage, zoomMode: v.zoomMode };
  },
};

declare global {
  interface Window {
    __viewer?: ViewerHooks;
  }
}

if (typeof window !== "undefined") window.__viewer = hooks;
