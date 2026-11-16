// Draws one document page (PDF or image) into a new canvas at a given scale.
import { RenderingCancelledException } from "pdfjs-dist";
import type { Page } from "../bindings/Page";
import { displayRotation, viewportTransform } from "../coords";
import type { SourceMeta } from "../state/model";
import { loadSource } from "./sourceCache";

export class RenderAborted extends Error {
  constructor() {
    super("render aborted");
    this.name = "RenderAborted";
  }
}

/**
 * What a rendered bitmap of `page` depends on besides the scale: rotation and image fit.
 * Bitmap caches compare it so a rotated page never shows its old picture.
 */
export function renderLook(page: Page): string {
  return `${displayRotation(page.baseRotation, page.userRotation)}:${page.imageFit ?? "-"}`;
}

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new RenderAborted();
}

/**
 * Renders `page` at `scale` (CSS px per pt) into a new canvas whose pixel size includes
 * `dpr`. Throws `RenderAborted` when `signal` fires; the pdf.js task is cancelled.
 */
export async function renderPageCanvas(
  page: Page,
  meta: SourceMeta,
  scale: number,
  dpr: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement> {
  const src = await loadSource(meta);
  checkAborted(signal);
  const rotation = displayRotation(page.baseRotation, page.userRotation);
  const canvas = document.createElement("canvas");

  if (src.kind === "pdf") {
    const pdfPage = await src.doc.getPage(page.pageIndex + 1);
    checkAborted(signal);
    // Absolute rotation (pdf.js does not add /Rotate to it).
    const viewport = pdfPage.getViewport({ scale, rotation });
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    const task = pdfPage.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } catch (e) {
      if (e instanceof RenderingCancelledException || signal.aborted) throw new RenderAborted();
      throw e;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return canvas;
  }

  // Image page: same transform as the overlay will use (coords module), image drawn into
  // the core's imageRect (SPEC 6.1).
  const layout = meta.info.image?.[page.imageFit === "image" ? "image" : "a4"];
  if (!layout) throw new Error("image source without layout");
  const t = viewportTransform(page.box, rotation, scale);
  canvas.width = Math.max(1, Math.floor(t.width * dpr));
  canvas.height = Math.max(1, Math.floor(t.height * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const m = t.matrix;
  ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
  const r = layout.imageRect;
  // User space is y-up; flip so the bitmap's top row is at y1.
  ctx.translate(r.x0, r.y1);
  ctx.scale(1, -1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.bitmap, 0, 0, r.x1 - r.x0, r.y1 - r.y0);
  return canvas;
}
