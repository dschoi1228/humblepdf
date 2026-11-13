// Types of the test hooks the app exposes on `window` (see src/viewer/testHooks.ts).
export {};

declare global {
  interface Window {
    __viewer?: {
      stats: { started: number; completed: number; cancelled: number; failed: number; running: number; maxRunning: number };
      renderedMain: () => number;
      maxRenderedMain: () => number;
      resetMax: () => void;
      firstRenderAt: () => number | null;
      pageSources: () => string[];
      view: () => { scale: number; currentPage: number; zoomMode: string };
    };
  }
}
