import { create } from "zustand";
import { clampScale, stepZoom } from "../viewer/layout";

export type ZoomMode = "custom" | "fitWidth" | "fitPage";

type ViewState = {
  /** Effective scale (1 = 100%, 1pt = 1 CSS px). In fit modes the page view keeps it updated. */
  scale: number;
  zoomMode: ZoomMode;
  /** 0-based index of the current page. */
  currentPage: number;
  thumbnailsOpen: boolean;
  /** Navigation request: the page view scrolls to `page` when `nonce` changes. */
  goTo: { page: number; nonce: number } | null;
  /** Point to keep in place on the next zoom (client coordinates), e.g. under the cursor. */
  zoomAnchor: { clientX: number; clientY: number } | null;

  setScale: (scale: number, anchor?: { clientX: number; clientY: number }) => void;
  zoomStep: (dir: 1 | -1, anchor?: { clientX: number; clientY: number }) => void;
  setZoomMode: (mode: ZoomMode) => void;
  /** Used by the page view to publish the computed fit scale. */
  setFitScale: (scale: number) => void;
  setCurrentPage: (page: number) => void;
  goToPage: (page: number) => void;
  toggleThumbnails: () => void;
  consumeAnchor: () => void;
};

export const useViewStore = create<ViewState>((set, get) => ({
  scale: 1,
  zoomMode: "fitWidth",
  currentPage: 0,
  thumbnailsOpen: true,
  goTo: null,
  zoomAnchor: null,

  setScale: (scale, anchor) => set({ scale: clampScale(scale), zoomMode: "custom", zoomAnchor: anchor ?? null }),
  zoomStep: (dir, anchor) => get().setScale(stepZoom(get().scale, dir), anchor),
  setZoomMode: (zoomMode) => set({ zoomMode, zoomAnchor: null }),
  setFitScale: (scale) => set({ scale: clampScale(scale) }),
  setCurrentPage: (currentPage) => {
    if (get().currentPage !== currentPage) set({ currentPage });
  },
  goToPage: (page) => set({ goTo: { page, nonce: (get().goTo?.nonce ?? 0) + 1 } }),
  toggleThumbnails: () => set({ thumbnailsOpen: !get().thumbnailsOpen }),
  consumeAnchor: () => set({ zoomAnchor: null }),
}));
