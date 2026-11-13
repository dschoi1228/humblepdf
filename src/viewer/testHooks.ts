// Read-only numbers exposed on `window.__viewer` for E2E tests and measurements.
import { useDocumentStore } from "../state/documentStore";
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
};

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
