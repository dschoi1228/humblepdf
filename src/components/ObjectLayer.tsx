// Editor overlay of one page (D28): draws the page objects with the shared SVG renderer and
// handles the pointer: select, move, resize and draw. Geometry is computed in user space
// (src/editor/geometry.ts); screen <-> user conversions use the coords module only.
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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

/** Pointer travel (screen px) below which a press counts as a click. */
export const CLICK_SLOP_PX = 4;
/** Pick tolerance around objects (screen px). */
export const HIT_TOLERANCE_PX = 5;
const HANDLE_PX = 8;

// Text and signatures are drawn by M5 and M4; until then they only need placeholders.
const ASSETS: OverlayAssets = { fontFamily: "PdfEditorBundled", signatureUrl: () => "" };

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
  | { kind: "create"; pointerId: number; tool: DrawTool; start: Point; client: Point; id: string };

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
  const [hover, setHover] = useState(false);
  const [dragKind, setDragKind] = useState<Drag["kind"] | null>(null);

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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    const p = userAt(e);
    const editor = useEditorStore.getState();
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
      if (tool === "select") setHover(!!hitTest(page.objects, userAt(e), HIT_TOLERANCE_PX / scale));
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
  const objects = draft
    ? page.objects.some((o) => o.id === draft.id)
      ? page.objects.map((o) => (o.id === draft.id ? draft : o))
      : [...page.objects, draft]
    : page.objects;
  const selectedObject = selectedId ? objects.find((o) => o.id === selectedId) : undefined;

  const cursor = tool !== "select" ? "crosshair" : hover || dragKind === "move" ? "move" : "default";

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 touch-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={end}
      onPointerLeave={() => setHover(false)}
      data-page-id={page.id}
      data-testid="object-layer"
    >
      {objects.map((o) => (
        <ObjectSvg key={o.id} object={o} transform={transform} />
      ))}
      {selectedObject && <Selection object={selectedObject} transform={transform} />}
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
