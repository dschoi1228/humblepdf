// Rendered thumbnails, by `${page id}:${renderLook(page)}`. Small (120px wide), kept for
// the whole session; cleared with the document.
export const thumbCache = new Map<string, HTMLCanvasElement>();

export function clearThumbnails(): void {
  thumbCache.clear();
}
