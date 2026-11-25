// Selectable text over a rendered PDF page (M12, D47). The pdf.js TextLayer draws transparent
// spans at the glyph positions. Read only: nothing here changes the document.
//
// A press-and-drag is handled here rather than by the browser: with absolutely positioned
// spans, Chromium places a selection end that lies between spans (past the end of a line,
// between lines, in the margin) at an unrelated place, and a drag that starts there selects
// nothing. Here such a point snaps to the line it is on, or to the start of the next line.
// Double-click (word) and triple-click (line) stay with the browser.
import { TextLayer, normalizeUnicode } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";

/** Class of every text layer div; selection checks look for it. */
export const TEXT_LAYER_CLASS = "textLayer";

/** Sets the CSS scale (CSS px per pt) the text layer sizes itself with. */
export function setTextLayerScale(div: HTMLElement, scale: number): void {
  div.style.setProperty("--total-scale-factor", String(scale));
}

/**
 * Fills `div` with the text of `pdfPage` at `rotation` (absolute, as the canvas).
 * Resolves when done; rejects when `signal` fires (the text stream is cancelled).
 */
export async function renderTextLayer(
  div: HTMLElement,
  pdfPage: PDFPageProxy,
  scale: number,
  rotation: number,
  signal: AbortSignal,
): Promise<void> {
  div.replaceChildren();
  setTextLayerScale(div, scale);
  const layer = new TextLayer({
    textContentSource: pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: div,
    viewport: pdfPage.getViewport({ scale, rotation }),
  });
  const onAbort = () => layer.cancel();
  signal.addEventListener("abort", onAbort);
  try {
    await layer.render();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  // A selection that runs into the next page starts it on a new line.
  div.append(document.createElement("br"));
}

/** True when the document selection is a non-empty range inside a page's text. */
export function hasTextSelection(): boolean {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest(`.${TEXT_LAYER_CLASS}`) && sel.toString().length > 0;
}

export function clearTextSelection(): boolean {
  if (!hasTextSelection()) return false;
  document.getSelection()?.removeAllRanges();
  return true;
}

/** The selected text as it goes to the clipboard: Unicode normalized, no NUL characters. */
export function selectedText(): string {
  return normalizeUnicode(document.getSelection()?.toString() ?? "").replaceAll("\0", "");
}

// ---- Caret placement ----

type Caret = { node: Node; offset: number };
/** A box in the layer's reading frame: x grows along the line, y down the page. */
type Box = { x0: number; y0: number; x1: number; y1: number };

/** Client point -> reading frame of a layer turned by `rotation` (multiple of 90). */
export function toReading(rotation: number, x: number, y: number): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [y, -x];
    case 180:
      return [-x, -y];
    case 270:
      return [-y, x];
    default:
      return [x, y];
  }
}

function readingBox(rotation: number, r: DOMRect): Box {
  const [ax, ay] = toReading(rotation, r.left, r.top);
  const [bx, by] = toReading(rotation, r.right, r.bottom);
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

function textNodeOf(span: Element): Text | null {
  for (const n of span.childNodes) if (n.nodeType === Node.TEXT_NODE) return n as Text;
  return null;
}

/** Text spans of a layer in content order, with their boxes in the reading frame. */
function spansOf(layer: HTMLElement, rotation: number) {
  const out: { text: Text; box: Box }[] = [];
  for (const span of layer.querySelectorAll("span:not(.markedContent)")) {
    const text = textNodeOf(span);
    if (!text || !text.data.length) continue;
    const r = span.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({ text, box: readingBox(rotation, r) });
  }
  return out;
}

/** Where a selection end at client (x, y) goes in `layer`; null when it has no text. */
export function caretAt(layer: HTMLElement, x: number, y: number): Caret | null {
  const rotation = Number(layer.getAttribute("data-main-rotation") ?? 0);
  const spans = spansOf(layer, rotation);
  if (!spans.length) return null;
  const [px, py] = toReading(rotation, x, y);
  const onLine = spans.filter(({ box }) => py >= box.y0 && py <= box.y1);
  if (onLine.length) {
    const inside = onLine.find(({ box }) => px >= box.x0 && px <= box.x1);
    if (inside) {
      // The browser knows the glyph edges; use it when it agrees on the span.
      const pos = document.caretPositionFromPoint?.(x, y);
      if (pos && pos.offsetNode === inside.text) return { node: inside.text, offset: pos.offset };
      const t = (px - inside.box.x0) / (inside.box.x1 - inside.box.x0 || 1);
      return { node: inside.text, offset: Math.round(t * inside.text.data.length) };
    }
    // Right of text on the line: the end of the last span before the point. Left of the
    // line: its start.
    const before = onLine.filter(({ box }) => box.x1 <= px).sort((a, b) => a.box.x1 - b.box.x1);
    if (before.length) {
      const s = before[before.length - 1];
      return { node: s.text, offset: s.text.data.length };
    }
    const first = [...onLine].sort((a, b) => a.box.x0 - b.box.x0)[0];
    return { node: first.text, offset: 0 };
  }
  // Between lines or outside the text: the start of the next line down, or the very end.
  const next = spans.find(({ box }) => box.y0 > py);
  if (next) return { node: next.text, offset: 0 };
  const last = spans[spans.length - 1];
  return { node: last.text, offset: last.text.data.length };
}

// ---- Dragging ----

/** Distance from the scroll view's edge (px) where a drag scrolls it, and the most per frame. */
const AUTOSCROLL_EDGE = 24;
const AUTOSCROLL_MAX = 24;

/** The text layer of the page under a client point; `fallback` outside every page. */
function layerAt(x: number, y: number, fallback: HTMLElement): HTMLElement {
  for (const el of document.elementsFromPoint(x, y)) {
    const layer = el.closest("[data-testid=page]")?.querySelector<HTMLElement>(`.${TEXT_LAYER_CLASS}`);
    if (layer) return layer;
  }
  return fallback;
}

function startDrag(e: MouseEvent, layer: HTMLElement) {
  const sel = document.getSelection();
  if (!sel) return;
  const scroller = layer.closest<HTMLElement>("[data-testid=page-view]");
  const extend = e.shiftKey && hasTextSelection() && !!sel.anchorNode;
  const anchor: Caret | null = extend
    ? { node: sel.anchorNode!, offset: sel.anchorOffset }
    : caretAt(layer, e.clientX, e.clientY);
  if (!anchor) return;
  e.preventDefault();
  let point = { x: e.clientX, y: e.clientY };
  let current = layer;
  const update = () => {
    current = layerAt(point.x, point.y, current);
    const focus = caretAt(current, point.x, point.y);
    if (focus) sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  };
  if (extend) update();
  else sel.collapse(anchor.node, anchor.offset);

  let frame = 0;
  const autoscroll = () => {
    frame = 0;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    let dy = 0;
    if (point.y < r.top + AUTOSCROLL_EDGE) dy = -Math.min(AUTOSCROLL_MAX, r.top + AUTOSCROLL_EDGE - point.y);
    else if (point.y > r.bottom - AUTOSCROLL_EDGE) dy = Math.min(AUTOSCROLL_MAX, point.y - (r.bottom - AUTOSCROLL_EDGE));
    if (!dy) return;
    scroller.scrollTop += dy;
    // Pages mount as they scroll in; place the end on the next frame.
    frame = requestAnimationFrame(() => {
      update();
      autoscroll();
    });
  };
  const move = (m: MouseEvent) => {
    point = { x: m.clientX, y: m.clientY };
    update();
    if (!frame) autoscroll();
  };
  const up = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
    window.removeEventListener("blur", up);
  };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("mouseup", up, true);
  window.addEventListener("blur", up);
}

// One document-level handler for copying out of any text layer and for drag selection.
let installed = false;
export function installTextSelection(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("copy", (e) => {
    if (!hasTextSelection() || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", selectedText());
    e.preventDefault();
  });
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.detail > 1 || e.ctrlKey || e.altKey || e.metaKey) return;
    const layer = (e.target as Element | null)?.closest?.<HTMLElement>(`.${TEXT_LAYER_CLASS}`);
    if (layer) startDrag(e, layer);
  });
}
