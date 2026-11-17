// M3 measurement, run in the browser by the E2E test (never imported by the app). Compares
// the live editor's object overlay with the saved PDF rendered by pdf.js (SPEC 9):
// - `overlayShot`: the page element with its canvas hidden, so only the overlay is drawn on
//   white. Diffed against white. (The page canvas itself is resampled by a fraction of a
//   pixel when the page size is not a whole number of pixels, which would mark every edge.)
// - the saved page is diffed against the bare source page.
// The boxes of what each adds must match. `pageShot` (canvas visible) is used to check that
// text under a highlight stays dark.
import { diffBox, renderToCanvas, type PixelBox } from "./screenMatch";

async function imageCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

/** Edge pixels of the overlay screenshot that are ignored. */
const EDGE_PX = 2;

const luminance = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

export type EditorMatch = {
  overlay: PixelBox | null;
  exported: PixelBox | null;
  width: number;
  height: number;
  /** Dark (text) pixels of the source page inside `darkRegion`, and how many stay dark. */
  dark?: { count: number; kept: number; keptExported: number };
  images: { exported: string };
};

export async function compareScreenshot(args: {
  sourceUrl: string;
  sourcePage: number;
  exportedUrl: string;
  exportedPage: number;
  /** PNG data URL of the page element at 100% zoom, canvas hidden. */
  overlayShot: string;
  /** PNG data URL of the page element with its canvas, for `darkRegion`. */
  pageShot?: string;
  darkRegion?: PixelBox;
}): Promise<EditorMatch> {
  const base = await renderToCanvas(args.sourceUrl, args.sourcePage);
  const exported = await renderToCanvas(args.exportedUrl, args.exportedPage);
  const overlay = await imageCanvas(args.overlayShot);
  // An element whose size or position is not a whole number of pixels brings the grey view
  // background into its outermost pixels. The tests place no objects there.
  const octx = overlay.getContext("2d")!;
  octx.fillStyle = "#fff";
  const m = EDGE_PX;
  octx.fillRect(0, 0, overlay.width, m);
  octx.fillRect(0, overlay.height - m, overlay.width, m);
  octx.fillRect(0, 0, m, overlay.height);
  octx.fillRect(overlay.width - m, 0, m, overlay.height);
  const white = document.createElement("canvas");
  white.width = overlay.width;
  white.height = overlay.height;
  const wctx = white.getContext("2d")!;
  wctx.fillStyle = "#fff";
  wctx.fillRect(0, 0, white.width, white.height);

  let dark: EditorMatch["dark"];
  if (args.darkRegion && args.pageShot) {
    const shot = await imageCanvas(args.pageShot);
    const r = args.darkRegion;
    const w = Math.min(base.width, shot.width);
    const b = base.getContext("2d")!.getImageData(0, 0, w, base.height).data;
    const s = shot.getContext("2d")!.getImageData(0, 0, w, shot.height).data;
    const e = exported.getContext("2d")!.getImageData(0, 0, w, exported.height).data;
    let count = 0;
    let kept = 0;
    let keptExported = 0;
    for (let y = Math.ceil(r.y0); y <= Math.floor(r.y1); y++) {
      for (let x = Math.ceil(r.x0); x <= Math.floor(r.x1); x++) {
        const i = (y * w + x) * 4;
        if (luminance(b, i) < 100) {
          count++;
          if (luminance(s, i) < 140) kept++;
          if (luminance(e, i) < 140) keptExported++;
        }
      }
    }
    dark = { count, kept, keptExported };
  }

  return {
    overlay: diffBox(white, overlay),
    exported: diffBox(base, exported),
    width: base.width,
    height: base.height,
    dark,
    images: { exported: exported.toDataURL("image/png") },
  };
}
