// M0 overlay renderer: draws page objects as SVG in page user space, wrapped in one group
// whose transform is the page transform from the coords module. Geometry follows the same
// SPEC numbers as the core (src/shapes). This is the verification renderer for M0-5, not
// the interactive editor overlay of M3.
import type { PageObject } from "../bindings/PageObject";
import type { Rgb } from "./types";
import { cssMatrix, type PageTransform } from "../coords";
import { ccw, lineGeometry, rotatedImageMatrix } from "../shapes/geometry";
import { ELLIPSE_KAPPA, LINE_HEIGHT } from "../shapes/spec";

export type OverlayAssets = {
  /** CSS font-family that is loaded from the bundled font file. */
  fontFamily: string;
  /** signatureId -> image URL (data: URL when rasterizing the SVG as an image). */
  signatureUrl: (signatureId: string) => string;
  /** Optional @font-face rule to embed (needed when the SVG is drawn as an image). */
  fontFaceCss?: string;
};

const color = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
const num = (v: number) => String(Math.round(v * 10000) / 10000);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function objectSvg(o: PageObject, assets: OverlayAssets): string {
  switch (o.type) {
    case "highlight": {
      const polys = o.quads
        .map((q) => [q[0], q[1], q[3], q[2]].map((p) => `${num(p.x)},${num(p.y)}`).join(" "))
        .map((pts) => `<polygon points="${pts}"/>`)
        .join("");
      return `<g fill="${color(o.color)}" fill-opacity="${o.opacity}" style="mix-blend-mode:multiply">${polys}</g>`;
    }
    case "rect":
    case "ellipse": {
      const r = o.rect;
      const stroke = o.stroke ? `stroke="${color(o.stroke)}" stroke-width="${o.strokeWidth}"` : `stroke="none"`;
      const fill = o.fill ? `fill="${color(o.fill)}"` : `fill="none"`;
      const attrs = `${stroke} ${fill} stroke-linecap="butt" stroke-linejoin="miter"`;
      if (o.type === "rect") {
        return `<g opacity="${o.opacity}"><rect x="${num(r.x0)}" y="${num(r.y0)}" width="${num(r.x1 - r.x0)}" height="${num(r.y1 - r.y0)}" ${attrs}/></g>`;
      }
      // Same four Bezier curves as the core (not an SVG <ellipse>).
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      const rx = (r.x1 - r.x0) / 2;
      const ry = (r.y1 - r.y0) / 2;
      const kx = rx * ELLIPSE_KAPPA;
      const ky = ry * ELLIPSE_KAPPA;
      const d =
        `M${num(cx + rx)} ${num(cy)}` +
        `C${num(cx + rx)} ${num(cy + ky)} ${num(cx + kx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)}` +
        `C${num(cx - kx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ky)} ${num(cx - rx)} ${num(cy)}` +
        `C${num(cx - rx)} ${num(cy - ky)} ${num(cx - kx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)}` +
        `C${num(cx + kx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ky)} ${num(cx + rx)} ${num(cy)}Z`;
      return `<g opacity="${o.opacity}"><path d="${d}" ${attrs}/></g>`;
    }
    case "line": {
      const g = lineGeometry(o);
      const c = color(o.stroke);
      let s = `<line x1="${num(o.from.x)}" y1="${num(o.from.y)}" x2="${num(g.lineEnd.x)}" y2="${num(g.lineEnd.y)}" stroke="${c}" stroke-width="${o.strokeWidth}" stroke-linecap="butt"/>`;
      if (g.head) {
        s += `<polygon points="${g.head.map((p) => `${num(p.x)},${num(p.y)}`).join(" ")}" fill="${c}"/>`;
      }
      return `<g opacity="${o.opacity}">${s}</g>`;
    }
    case "text": {
      const [cos, sin] = ccw(o.rotation);
      const lh = LINE_HEIGHT * o.fontSize;
      // Glyph space is y-down in SVG; map it to user space (y-up), rotated CCW.
      const lines = o.lines
        .map((line, i) => {
          const ly = -i * lh;
          const x = o.origin.x - sin * ly;
          const y = o.origin.y + cos * ly;
          return `<text transform="matrix(${num(cos)} ${num(sin)} ${num(sin)} ${num(-cos)} ${num(x)} ${num(y)})">${esc(line)}</text>`;
        })
        .join("");
      return `<g fill="${color(o.color)}" font-family="${assets.fontFamily}" font-size="${o.fontSize}" style="font-kerning:none;font-variant-ligatures:none;white-space:pre">${lines}</g>`;
    }
    case "signature": {
      const m = rotatedImageMatrix(o.rect, o.rotation);
      // Image space is y-down: flip the unit square before applying the PDF matrix.
      const t = [m[0], m[1], -m[2], -m[3], m[2] + m[4], m[3] + m[5]].map(num).join(" ");
      return `<image href="${assets.signatureUrl(o.signatureId)}" width="1" height="1" preserveAspectRatio="none" transform="matrix(${t})"/>`;
    }
  }
}

/** A complete SVG document of the page size with every object drawn on top of nothing. */
export function overlaySvg(objects: PageObject[], t: PageTransform, assets: OverlayAssets): string {
  const style = assets.fontFaceCss ? `<style>${assets.fontFaceCss}</style>` : "";
  const body = objects.map((o) => objectSvg(o, assets)).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}" viewBox="0 0 ${t.width} ${t.height}">` +
    `${style}<g transform="${cssMatrix(t.matrix)}">${body}</g></svg>`
  );
}
