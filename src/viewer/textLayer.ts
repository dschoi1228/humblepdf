// Selectable text over a rendered PDF page (M12, D47). The pdf.js TextLayer draws transparent
// spans at the glyph positions. Read only: nothing here changes the document.
//
// A press-and-drag is handled here rather than by the browser: with absolutely positioned
// spans, Chromium places a selection end that lies between spans (past the end of a line,
// between lines, in the margin) at an unrelated place, and a drag that starts there selects
// nothing. Here such a point snaps to the line it is on, or to the start of the next line.
// Double-click (word) and triple-click (line) stay with the browser.
//
// The highlight tool (M13, D48) drags the same selection and turns it into one quad per
// line (`selectionQuads`).
import { OPS, TextLayer, normalizeUnicode } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import { itemFractions, paintedChars, type FontInfo, type TextOps } from "./glyphLayout";
import { mergeLines, readingBox, readingQuad, toReading, type Box, type ClientQuad } from "./readingFrame";

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
  itemSpans.delete(div);
  charFractions.delete(div);
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
  // One span per text item with a string, in the order of `getTextContent` (search, M14).
  const spans = layer.textDivs;
  itemSpans.set(div, spans);
  spans.forEach((span, i) => spanItem.set(span, i));
  // Where the characters really are inside each span (D49); without it the browser's layout.
  try {
    const ops = await pdfPage.getOperatorList();
    if (signal.aborted) return;
    const fontOf = (name: string): FontInfo =>
      pdfPage.commonObjs.has(name) ? (pdfPage.commonObjs.get(name) as FontInfo) : null;
    const layouts = itemFractions(layer.textContentItemsStr, paintedChars(ops, OPS as unknown as TextOps, fontOf));
    charFractions.set(
      div,
      layouts.map((l) => l?.fractions ?? null),
    );
    // The zoom may have changed while the operator list was read.
    fitSpanWidths(spans, layouts, Number(div.style.getPropertyValue("--total-scale-factor")) || scale);
  } catch {
    // Glyph positions unavailable: boxes follow the browser's layout of the span.
  }
  // A selection that runs into the next page starts it on a new line.
  div.append(document.createElement("br"));
}

/**
 * Stretches each span to its painted length. pdf.js sets `--scale-x` from a canvas
 * measurement, but Chromium may pick another fallback font for the span than for that
 * canvas (seen with Hangul: 10% wider), so the span would run past its glyphs. The layout
 * width read here is the span's own, so the ratio holds at every zoom.
 */
function fitSpanWidths(spans: readonly HTMLElement[], layouts: readonly ({ length: number } | null)[], scale: number) {
  const widths = spans.map((s, i) => (layouts[i] && !s.style.getPropertyValue("--rotate") ? s.offsetWidth : 0));
  spans.forEach((s, i) => {
    const l = layouts[i];
    if (!l || !widths[i]) return;
    s.style.setProperty("--scale-x", String((l.length * scale) / widths[i]));
  });
}

/** Text item index of each span. */
const spanItem = new WeakMap<Element, number>();
/** Per layer and text item: character boundaries as fractions of the item's length (D49). */
const charFractions = new WeakMap<HTMLElement, (Float64Array | null)[]>();

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

/** Pointer slack (px) around the glyph boxes for `textAt`. */
export const TEXT_HIT_SLOP_PX = 4;

/** True when client (x, y) is on the text of `layer` (within TEXT_HIT_SLOP_PX). */
export function textAt(layer: HTMLElement, x: number, y: number): boolean {
  const rotation = Number(layer.getAttribute("data-main-rotation") ?? 0);
  const [px, py] = toReading(rotation, x, y);
  const s = TEXT_HIT_SLOP_PX;
  return spansOf(layer, rotation).some(
    ({ box }) => px >= box.x0 - s && px <= box.x1 + s && py >= box.y0 - s && py <= box.y1 + s,
  );
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

// ---- Selection -> highlight quads ----

/** Thinnest selected glyph run (px) that counts; thinner ones are empty runs. */
const MIN_RUN_PX = 0.5;

/**
 * The text selection as one quad per line, grouped by page (`pageIndex` is the page
 * element's `data-page-index`). Client coordinates; the caller converts them to user space.
 */
export function selectionQuads(): { pageIndex: number; quads: ClientQuad[] }[] {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  const out: { pageIndex: number; quads: ClientQuad[] }[] = [];
  for (const layer of document.querySelectorAll<HTMLElement>(`.${TEXT_LAYER_CLASS}`)) {
    if (!range.intersectsNode(layer)) continue;
    const index = Number(layer.closest("[data-testid=page]")?.getAttribute("data-page-index"));
    if (!Number.isInteger(index)) continue;
    const rotation = Number(layer.getAttribute("data-main-rotation") ?? 0);
    const boxes: Box[] = [];
    // Text node by text node: a range across pages also holds whole elements (canvas, object
    // layer) whose boxes are not text.
    for (const span of layer.querySelectorAll<HTMLElement>("span:not(.markedContent)")) {
      const text = textNodeOf(span);
      if (!text || !text.data.length || !range.intersectsNode(text)) continue;
      const part = document.createRange();
      part.selectNodeContents(text);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      if (part.collapsed) continue;
      boxes.push(...runBoxes(rotation, span, part));
    }
    const quads = mergeLines(boxes).map((b) => readingQuad(rotation, b));
    if (quads.length) out.push({ pageIndex: index, quads });
  }
  return out;
}

/**
 * Reading-frame boxes of the part `part` of the text in `span`. Across the line: the span's
 * box (one font size tall, placed by pdf.js from the font's ascent); the range rectangles
 * are as tall as the browser's fallback font, which for CJK text is much taller than the
 * PDF glyphs. Along the line: the part itself.
 */
function runBoxes(rotation: number, span: HTMLElement, part: Range): Box[] {
  const line = readingBox(rotation, span.getBoundingClientRect());
  // Along the line from the painted glyphs when known (D49); the span then runs from the
  // first glyph's start to the last one's end. Not for text turned inside the page.
  const layer = span.closest<HTMLElement>(`.${TEXT_LAYER_CLASS}`);
  const index = spanItem.get(span);
  const fr = layer && index !== undefined ? charFractions.get(layer)?.[index] : null;
  const text = textNodeOf(span);
  const turned = !!span.style.getPropertyValue("--rotate");
  if (fr && text && !turned && fr.length === text.data.length + 1) {
    const from = part.startContainer === text ? part.startOffset : 0;
    const to = part.endContainer === text ? part.endOffset : text.data.length;
    const w = line.x1 - line.x0;
    const x0 = line.x0 + fr[from] * w;
    const x1 = line.x0 + fr[to] * w;
    return x1 - x0 >= MIN_RUN_PX ? [{ x0, x1, y0: line.y0, y1: line.y1 }] : [];
  }
  const out: Box[] = [];
  for (const r of part.getClientRects()) {
    if (r.width < MIN_RUN_PX || r.height < MIN_RUN_PX) continue;
    const run = readingBox(rotation, r);
    if (run.x1 - run.x0 < MIN_RUN_PX) continue;
    out.push({ x0: run.x0, x1: run.x1, y0: line.y0, y1: line.y1 });
  }
  return out;
}

// ---- Search results (M14, D49) ----

/** Span of each pdf.js text item of a rendered layer, by item index. */
const itemSpans = new WeakMap<HTMLElement, readonly HTMLElement[]>();

/** A text range given by text item indices and offsets (see src/search/match.ts). */
export type ItemRange = { start: { item: number; offset: number }; end: { item: number; offset: number } };

/**
 * Client quads (one per line) over the text items range `m` of a rendered layer. Empty when
 * the layer is not rendered or lacks those items (pdf.js stops adding spans on huge pages).
 */
export function itemRangeQuads(layer: HTMLElement, m: ItemRange): ClientQuad[] {
  const spans = itemSpans.get(layer);
  if (!spans) return [];
  const rotation = Number(layer.getAttribute("data-main-rotation") ?? 0);
  const boxes: Box[] = [];
  for (let i = m.start.item; i <= m.end.item; i++) {
    const span = spans[i];
    const text = span && textNodeOf(span);
    if (!text) continue;
    const from = i === m.start.item ? m.start.offset : 0;
    const to = i === m.end.item ? m.end.offset : text.data.length;
    if (to <= from || to > text.data.length) continue;
    const part = document.createRange();
    part.setStart(text, from);
    part.setEnd(text, to);
    boxes.push(...runBoxes(rotation, span, part));
  }
  return mergeLines(boxes).map((b) => readingQuad(rotation, b));
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

/**
 * Starts a drag selection at the press `e` in `layer`. `onEnd` runs when the button is
 * released (not when Esc cancels the drag). Returns false when there is nothing to select.
 */
export function startTextDrag(e: MouseEvent, layer: HTMLElement, onEnd?: () => void): boolean {
  const sel = document.getSelection();
  if (!sel) return false;
  const scroller = layer.closest<HTMLElement>("[data-testid=page-view]");
  const extend = e.shiftKey && hasTextSelection() && !!sel.anchorNode;
  const anchor: Caret | null = extend
    ? { node: sel.anchorNode!, offset: sel.anchorOffset }
    : caretAt(layer, e.clientX, e.clientY);
  if (!anchor) return false;
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
  // Pointer events: a press that the object layer took (highlight tool) has no mouse events.
  const move = (m: PointerEvent) => {
    point = { x: m.clientX, y: m.clientY };
    update();
    if (!frame) autoscroll();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
  };
  const up = () => {
    stop();
    onEnd?.();
  };
  // A drag that is cut off (or cancelled with Esc) leaves no selection to act on.
  const cancel = () => {
    stop();
    if (onEnd) {
      sel.removeAllRanges();
      onEnd();
    }
  };
  const key = (k: KeyboardEvent) => {
    if (k.key !== "Escape") return;
    k.preventDefault();
    k.stopImmediatePropagation();
    sel.removeAllRanges();
    cancel();
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);
  return true;
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
    if (layer) startTextDrag(e, layer);
  });
}
