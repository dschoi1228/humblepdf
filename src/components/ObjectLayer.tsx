// Editor overlay of one page (D28): draws the page objects with the shared SVG renderer and
// handles the pointer: select, move, resize and draw. Geometry is computed in user space
// (src/editor/geometry.ts); screen <-> user conversions use the coords module only.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Page } from "../bindings/Page";
import type { PageObject } from "../bindings/PageObject";
import type { Point } from "../bindings/Point";
import { commitNewObject, commitObject } from "../app/objectActions";
import { cssMatrix, displayRotation, rectToScreen, screenAxes, toScreen, toUser, type PageTransform } from "../coords";
import { useSignatureStore } from "../signatures/signatureStore";
import { useEditorStore } from "../editor/editorStore";
import {
  clampPoint,
  handleKey,
  handlesOf,
  hitTest,
  moveObject,
  newObject,
  objectBounds,
  parseHandle,
  newSignature,
  resizeObject,
  type Handle,
} from "../editor/geometry";
import type { DrawTool } from "../editor/tools";
import { objectSvg, type OverlayAssets } from "../overlay/svg";
import { TEXT_FONT_FAMILY } from "../editor/fonts";
import { TEXT_ASCENT } from "../editor/textLayout";
import { TextEditor } from "./TextEditor";
import { clearTextSelection } from "../viewer/textLayer";

/** Pointer travel (screen px) below which a press counts as a click. */
export const CLICK_SLOP_PX = 4;
/** Pick tolerance around objects (screen px). */
export const HIT_TOLERANCE_PX = 5;
const HANDLE_PX = 8;

// Text and signatures are drawn by M5 and M4; until then they only need placeholders.
const ASSETS: OverlayAssets = { fontFamily: TEXT_FONT_FAMILY, signatureUrl: () => "" };

/** One object as its own SVG, so a highlight can multiply with the page canvas below it. */
export const ObjectSvg = memo(function ObjectSvg(props: { object: PageObject; transform: PageTransform }) {
  const { object, transform } = props;
  const signatureId = object.type === "signature" ? object.signatureId : null;
  const url = useSignatureStore((s) => (signatureId ? s.urls[signatureId] : undefined));
  const missing = useSignatureStore((s) => (signatureId ? !!s.failed[signatureId] : false));
  useEffect(() => {
    if (signatureId) useSignatureStore.getState().ensureUrl(signatureId);
  }, [signatureId]);
  if (object.type === "signature" && !url) {
    // Loading, or deleted from the library: a dashed placeholder where it sits.
    if (!missing) return null;
    const r = rectToScreen(transform, object.rect);
    return (
      <svg className="pointer-events-none absolute inset-0" width={transform.width} height={transform.height} data-object-id={object.id} data-testid="object">
        <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="none" stroke="#dc2626" strokeDasharray="4 3" />
      </svg>
    );
  }
  const assets: OverlayAssets = url ? { ...ASSETS, signatureUrl: () => url } : ASSETS;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={transform.width}
      height={transform.height}
      style={object.type === "highlight" ? { mixBlendMode: "multiply" } : undefined}
      data-object-id={object.id}
      data-object-type={object.type}
      data-testid="object"
    >
      <g transform={cssMatrix(transform.matrix)} dangerouslySetInnerHTML={{ __html: objectSvg(object, assets) }} />
    </svg>
  );
});

/** Objects without interaction (thumbnails). */
export function ObjectsView(props: { objects: readonly PageObject[]; transform: PageTransform }) {
  return (
    <>
      {props.objects.map((o) => (
        <ObjectSvg key={o.id} object={o} transform={props.transform} />
      ))}
    </>
  );
}

type Drag =
  | { kind: "move"; pointerId: number; start: Point; orig: PageObject }
  | { kind: "resize"; pointerId: number; handle: Handle; orig: PageObject }
  | { kind: "create"; pointerId: number; tool: Exclude<DrawTool, "text">; start: Point; client: Point; id: string };

function resizeCursor(dx: number, dy: number): string {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
}

export const ObjectLayer = memo(function ObjectLayer(props: { page: Page; transform: PageTransform }) {
  const { page, transform } = props;
  const tool = useEditorStore((s) => s.tool);
  const selectedId = useEditorStore((s) => (s.selected?.pageId === page.id ? s.selected.objectId : null));
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<PageObject | null>(null);
  /** The pointer is over an object or a handle (select tool). Elsewhere the layer lets the
   *  pointer through to the page text below it, so text can be selected (M12, D47). */
  const [hover, setHover] = useState(false);
  /** Pointer position (user space) while the signature tool shows its preview. */
  const [ghostAt, setGhostAt] = useState<Point | null>(null);
  const lib = useSignatureStore((s) => (tool === "signature" ? s.list.find((x) => x.id === s.current) : undefined));
  const [dragKind, setDragKind] = useState<Drag["kind"] | null>(null);
  const editing = useEditorStore((s) => (s.editing?.pageId === page.id ? s.editing : null));

  const scale = Math.hypot(transform.matrix[0], transform.matrix[1]);
  const userAt = (e: { clientX: number; clientY: number }): Point => {
    const r = layerRef.current!.getBoundingClientRect();
    return toUser(transform, { x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const end = useCallback(() => {
    drag.current = null;
    setDraft(null);
    setDragKind(null);
    useEditorStore.getState().setDragging(false);
  }, []);

  // Esc cancels a drag before the global shortcut handler sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !drag.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = layerRef.current;
      if (el?.hasPointerCapture(drag.current.pointerId)) el.releasePointerCapture(drag.current.pointerId);
      end();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [end]);

  // Hover is tracked on the page element, which also sees the pointer while it is over the
  // text layer (when this layer lets it through).
  const hoverAt = useRef<(e: PointerEvent) => void>(() => {});
  useLayoutEffect(() => {
    hoverAt.current = (e: PointerEvent) => {
      // Not while a button is down: a text selection being dragged across an object must
      // not switch the layer under it.
      if (drag.current || e.buttons !== 0 || tool !== "select") return;
      const p = userAt(e);
      const current = selectedId ? page.objects.find((o) => o.id === selectedId) : undefined;
      const onHandle =
        !!current &&
        handlesOf(current).some(({ at }) => {
          const s = toScreen(transform, at);
          const r = layerRef.current!.getBoundingClientRect();
          return Math.max(Math.abs(s.x - (e.clientX - r.left)), Math.abs(s.y - (e.clientY - r.top))) <= HANDLE_PX / 2 + 1;
        });
      const over = onHandle || !!hitTest(page.objects, p, HIT_TOLERANCE_PX / scale);
      // Also on the element right away: a press that follows this move at once must already
      // reach the layer, before React renders the new state.
      if (layerRef.current && !editing) layerRef.current.style.pointerEvents = over ? "" : "none";
      setHover(over);
    };
  });
  useEffect(() => {
    const pageEl = layerRef.current?.parentElement;
    if (!pageEl) return;
    const move = (e: PointerEvent) => hoverAt.current(e);
    const leave = () => setHover(false);
    // A press on the page text (outside this layer) clears the object selection.
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || layerRef.current?.contains(e.target as Node)) return;
      if (useEditorStore.getState().tool === "select") useEditorStore.getState().select(null);
    };
    pageEl.addEventListener("pointermove", move);
    pageEl.addEventListener("pointerleave", leave);
    pageEl.addEventListener("pointerdown", down);
    return () => {
      pageEl.removeEventListener("pointermove", move);
      pageEl.removeEventListener("pointerleave", leave);
      pageEl.removeEventListener("pointerdown", down);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    // Working with objects ends a text selection.
    clearTextSelection();
    const p = userAt(e);
    const editor = useEditorStore.getState();
    // A click outside the text being typed commits it (D33) and does nothing else.
    if (editor.editing) {
      (document.activeElement as HTMLElement | null)?.blur();
      e.preventDefault();
      return;
    }
    if (tool === "text") {
      // The click marks the top of the first line; the baseline is one ascent below it.
      e.preventDefault();
      const size = editor.props.text.fontSize;
      const down = screenAxes(transform).down;
      const origin = clampPoint({ x: p.x + down.x * TEXT_ASCENT * size, y: p.y + down.y * TEXT_ASCENT * size }, page.box);
      editor.select(null);
      editor.setEditing({ pageId: page.id, objectId: null, origin, rotation: displayRotation(page.baseRotation, page.userRotation) });
      return;
    }
    if (tool === "select") {
      const key = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle");
      const handle = key ? parseHandle(key) : null;
      const current = selectedId ? page.objects.find((o) => o.id === selectedId) : undefined;
      if (handle && current) {
        drag.current = { kind: "resize", pointerId: e.pointerId, handle, orig: current };
      } else {
        const id = hitTest(page.objects, p, HIT_TOLERANCE_PX / scale);
        if (!id) {
          editor.select(null);
          return;
        }
        editor.select({ pageId: page.id, objectId: id });
        drag.current = { kind: "move", pointerId: e.pointerId, start: p, orig: page.objects.find((o) => o.id === id)! };
      }
    } else if (tool === "signature") {
      // A click places the chosen library signature (D31).
      const lib = useSignatureStore.getState();
      const sig = lib.list.find((x) => x.id === lib.current);
      if (!sig) {
        lib.openDialog();
        return;
      }
      e.preventDefault();
      const object = newSignature({
        id: crypto.randomUUID(),
        signatureId: sig.id,
        at: clampPoint(p, page.box),
        aspect: sig.width / sig.height,
        box: page.box,
        axes: screenAxes(transform),
        rotation: displayRotation(page.baseRotation, page.userRotation),
      });
      commitNewObject(page.id, object, "signature");
      return;
    } else {
      drag.current = {
        kind: "create",
        pointerId: e.pointerId,
        tool,
        start: clampPoint(p, page.box),
        client: { x: e.clientX, y: e.clientY },
        id: crypto.randomUUID(),
      };
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragKind(drag.current.kind);
    editor.setDragging(true);
  };

  /** The object the current drag would produce at this pointer position. */
  const dragResult = (d: Drag, e: { clientX: number; clientY: number; shiftKey: boolean }, final: boolean) => {
    const p = userAt(e);
    switch (d.kind) {
      case "move":
        return moveObject(d.orig, p.x - d.start.x, p.y - d.start.y, page.box);
      case "resize":
        return resizeObject(d.orig, d.handle, p, page.box, e.shiftKey);
      case "create": {
        const moved = Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) >= CLICK_SLOP_PX;
        if (!moved && !final) return null;
        return newObject({
          tool: d.tool,
          id: d.id,
          start: d.start,
          end: moved ? p : null,
          props: useEditorStore.getState().props[d.tool],
          box: page.box,
          axes: screenAxes(transform),
          snap: e.shiftKey,
        });
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      if (tool === "signature") setGhostAt(clampPoint(userAt(e), page.box));
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    setDraft(dragResult(d, e, false));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const result = dragResult(d, e, true);
    end();
    if (!result) return;
    if (d.kind === "create") commitNewObject(page.id, result, d.tool);
    else if (result !== d.orig) commitObject(page.id, result);
  };

  // While dragging, the draft replaces its original (move, resize) or is added (create).
  // Double-click on a text edits it again (D33).
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (tool !== "select") return;
    const id = hitTest(page.objects, userAt(e), HIT_TOLERANCE_PX / scale);
    const o = page.objects.find((x) => x.id === id);
    if (o?.type !== "text") return;
    const editor = useEditorStore.getState();
    editor.select(null);
    editor.setEditing({ pageId: page.id, objectId: o.id, origin: o.origin, rotation: o.rotation });
  };

  const shown = editing?.objectId ? page.objects.filter((o) => o.id !== editing.objectId) : page.objects;
  const objects = draft
    ? shown.some((o) => o.id === draft.id)
      ? shown.map((o) => (o.id === draft.id ? draft : o))
      : [...shown, draft]
    : shown;
  const selectedObject = selectedId ? objects.find((o) => o.id === selectedId) : undefined;

  const passThrough = tool === "select" && !editing && !dragKind && !hover;
  const cursor = tool === "text" ? "text" : tool !== "select" ? "crosshair" : hover || dragKind === "move" ? "move" : "default";

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 touch-none"
      style={{ cursor, pointerEvents: passThrough ? "none" : undefined }}
      data-pass-through={passThrough ? "1" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
      onPointerLeave={() => {
        setHover(false);
        setGhostAt(null);
      }}
      data-page-id={page.id}
      data-testid="object-layer"
    >
      {objects.map((o) => (
        <ObjectSvg key={o.id} object={o} transform={transform} />
      ))}
      {selectedObject && <Selection object={selectedObject} transform={transform} />}
      {editing && <TextEditor key={editing.objectId ?? "new"} page={page} transform={transform} editing={editing} />}
      {tool === "signature" && lib && ghostAt && (
        // Where a click would place the chosen signature (D31).
        <div className="pointer-events-none absolute inset-0 opacity-60" data-testid="signature-ghost">
          <ObjectSvg
            object={newSignature({
              id: "ghost",
              signatureId: lib.id,
              at: ghostAt,
              aspect: lib.width / lib.height,
              box: page.box,
              axes: screenAxes(transform),
              rotation: displayRotation(page.baseRotation, page.userRotation),
            })}
            transform={transform}
          />
        </div>
      )}
    </div>
  );
});

/** Selection outline and handles, drawn in screen pixels. */
function Selection(props: { object: PageObject; transform: PageTransform }) {
  const { object, transform } = props;
  const b = objectBounds(object);
  if (!b) return null;
  const r = rectToScreen(transform, b);
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const half = HANDLE_PX / 2;
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={transform.width}
      height={transform.height}
      data-testid="selection"
      data-object-id={object.id}
    >
      {object.type !== "line" && (
        <rect
          x={r.x0}
          y={r.y0}
          width={r.x1 - r.x0}
          height={r.y1 - r.y0}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
      {handlesOf(object).map(({ handle, at }) => {
        const s = toScreen(transform, at);
        const key = handleKey(handle);
        return (
          <rect
            key={key}
            x={s.x - half}
            y={s.y - half}
            width={HANDLE_PX}
            height={HANDLE_PX}
            fill="white"
            stroke="#2563eb"
            strokeWidth={1.5}
            style={{ pointerEvents: "all", cursor: typeof handle === "string" ? "crosshair" : resizeCursor(s.x - cx, s.y - cy) }}
            data-handle={key}
            data-testid="handle"
          />
        );
      })}
    </svg>
  );
}
