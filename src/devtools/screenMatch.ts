// M0-5 measurement, run in the browser by the E2E test (never imported by the app).
// For one page it renders (a) the source page, (b) the source page + SVG overlay of the
// model objects, (c) the exported page, and returns the bounding boxes of what (b) and (c)
// add on top of (a).
import { TEXT_FONT_URLS } from "../editor/fonts";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { viewportTransform } from "../coords";
import { overlaySvg } from "../overlay/svg";
import { openPdf, renderPage } from "../viewer/pdfjs";

export type PixelBox = { x0: number; y0: number; x1: number; y1: number };
export type MatchResult = {
  overlay: PixelBox | null;
  exported: PixelBox | null;
  width: number;
  height: number;
  images: { overlay: string; exported: string };
};

// Same fallback order as the app (D32).
const FONT_FAMILY = "HumblePDFBundled, HumblePDFBundledJP";
let fontDataUrls: Promise<[string, string]> | null = null;

async function toDataUrl(url: string, mime: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function renderToCanvas(url: string, pageNumber: number): Promise<HTMLCanvasElement> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const doc = await openPdf(bytes);
  const canvas = document.createElement("canvas");
  await renderPage(doc, pageNumber, canvas, 1);
  await doc.loadingTask.destroy();
  return canvas;
}

export function diffBox(a: HTMLCanvasElement, b: HTMLCanvasElement, threshold = 48): PixelBox | null {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const da = a.getContext("2d")!.getImageData(0, 0, w, h).data;
  const db = b.getContext("2d")!.getImageData(0, 0, w, h).data;
  let box: PixelBox | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > threshold) {
        if (!box) box = { x0: x, y0: y, x1: x, y1: y };
        else {
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x);
          box.y1 = Math.max(box.y1, y);
        }
      }
    }
  }
  return box;
}

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  return img;
}

export async function measurePage(args: {
  sourceUrl: string;
  sourcePage: number;
  exportedUrl: string;
  exportedPage: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  rotation: Rotation;
  objects: PageObject[];
  signatureUrls: Record<string, string>;
}): Promise<MatchResult> {
  fontDataUrls ??= Promise.all([toDataUrl(TEXT_FONT_URLS.main, "font/ttf"), toDataUrl(TEXT_FONT_URLS.jp, "font/ttf")]);
  const [font, fontJp] = await fontDataUrls;
  const sigs: Record<string, string> = {};
  for (const [id, url] of Object.entries(args.signatureUrls)) sigs[id] = await toDataUrl(url, "image/png");

  const base = await renderToCanvas(args.sourceUrl, args.sourcePage);
  const exported = await renderToCanvas(args.exportedUrl, args.exportedPage);

  const t = viewportTransform(args.box, args.rotation, 1);
  const svg = overlaySvg(args.objects, t, {
    fontFamily: FONT_FAMILY,
    signatureUrl: (id) => sigs[id],
    fontFaceCss:
      `@font-face{font-family:HumblePDFBundled;src:url(${font}) format("truetype");}` +
      `@font-face{font-family:HumblePDFBundledJP;src:url(${fontJp}) format("truetype");}`,
  });
  const composite = document.createElement("canvas");
  composite.width = base.width;
  composite.height = base.height;
  const ctx = composite.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  // Highlights multiply with the page (SPEC 6.5); other objects are opaque enough that
  // the blend mode does not change their bounding box.
  const hasHighlight = args.objects.some((o) => o.type === "highlight");
  if (hasHighlight) ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(await loadSvgImage(svg), 0, 0);
  ctx.globalCompositeOperation = "source-over";

  return {
    overlay: diffBox(base, composite),
    exported: diffBox(base, exported),
    width: base.width,
    height: base.height,
    images: { overlay: composite.toDataURL("image/png"), exported: exported.toDataURL("image/png") },
  };
}
