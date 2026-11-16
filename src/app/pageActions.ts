// Page organization commands (SPEC 6.3) shared by the toolbar, the thumbnail context menu
// and keyboard shortcuts. Each is one Undo step.
import type { ImageFit } from "../bindings/ImageFit";
import { useDocumentStore } from "../state/documentStore";
import { deletePages, movePages, rotatePages, setImageFit } from "../state/model";
import { useViewStore } from "../state/viewStore";

/** Selected pages, or the current page when nothing is selected. */
export function targetPageIds(): Set<string> {
  const { doc, selection } = useDocumentStore.getState();
  if (selection.ids.size) return new Set(selection.ids);
  const page = doc.pages[useViewStore.getState().currentPage];
  return new Set(page ? [page.id] : []);
}

export function rotateTargets(delta: 90 | -90): void {
  const ids = targetPageIds();
  useDocumentStore.getState().apply((d) => rotatePages(d, ids, delta));
}

export function deleteTargets(): void {
  const ids = targetPageIds();
  const st = useDocumentStore.getState();
  const first = st.doc.pages.findIndex((p) => ids.has(p.id));
  if (first < 0) return;
  st.apply((d) => deletePages(d, ids));
  // Show the page that took the place of the first deleted one.
  const n = useDocumentStore.getState().doc.pages.length;
  if (n) useViewStore.getState().goToPage(Math.min(first, n - 1));
}

export function setFitOfTargets(fit: ImageFit): void {
  const ids = targetPageIds();
  const st = useDocumentStore.getState();
  st.apply((d) => setImageFit(d, ids, fit, st.sources));
}

/** Moves pages so they start at `toIndex` of the current list (thumbnail drop). */
export function movePagesTo(ids: ReadonlySet<string>, toIndex: number): void {
  useDocumentStore.getState().apply((d) => movePages(d, ids, toIndex));
}

/** Image pages among the targets, with their current fit (for menus). */
export function imageTargets(): { count: number; fit: ImageFit | null } {
  const ids = targetPageIds();
  const pages = useDocumentStore.getState().doc.pages.filter((p) => ids.has(p.id) && p.imageFit !== null);
  if (!pages.length) return { count: 0, fit: null };
  const fit = pages.every((p) => p.imageFit === pages[0].imageFit) ? pages[0].imageFit : null;
  return { count: pages.length, fit };
}
