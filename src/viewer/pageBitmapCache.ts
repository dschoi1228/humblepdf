// Last rendered bitmap of recently shown pages, at whatever scale it was drawn. A page that
// is mounted again (scrolling back, or after a zoom changes the visible range) shows it
// immediately, stretched by CSS, until the render at the current scale is ready.

const CAPACITY = 24;

type Entry = { canvas: HTMLCanvasElement; look: string };
const cache = new Map<string, Entry>();

/** `look` is `renderLook(page)`: a bitmap drawn with another rotation or fit is not reused. */
export function getPageBitmap(pageId: string, look: string): HTMLCanvasElement | null {
  const e = cache.get(pageId);
  if (!e || e.look !== look) return null;
  // Refresh LRU position.
  cache.delete(pageId);
  cache.set(pageId, e);
  return e.canvas;
}

export function putPageBitmap(pageId: string, look: string, canvas: HTMLCanvasElement): void {
  cache.delete(pageId);
  cache.set(pageId, { canvas, look });
  while (cache.size > CAPACITY) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

export function clearPageBitmaps(): void {
  cache.clear();
}
