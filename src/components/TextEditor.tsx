// In-place text editing (SPEC 6.7, D33): a textarea drawn with the bundled fonts at the
// text's size, line spacing and rotation, so the text looks the same before and after it
// is committed. The browser's own input handles Korean and Japanese composition.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Page } from "../bindings/Page";
import type { PageObject } from "../bindings/PageObject";
import { displayRotation, toScreen, type PageTransform } from "../coords";
import { useEditorStore, type TextEditing } from "../editor/editorStore";
import { TEXT_FONT_FAMILY } from "../editor/fonts";
import { keepInside } from "../editor/geometry";
import { lineWidth, linesOf, TEXT_ASCENT, TEXT_DESCENT } from "../editor/textLayout";
import { LINE_HEIGHT } from "../shapes/spec";
import { useDocumentStore } from "../state/documentStore";
import { addObject, deleteObject, updateObject } from "../state/objects";

type Text = Extract<PageObject, { type: "text" }>;

const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** Commits the editor: adds, updates or (when emptied) deletes the text; one Undo step. */
function commit(page: Page, editing: TextEditing, existing: Text | undefined, value: string, style: { fontSize: number; color: Text["color"] }) {
  const lines = linesOf(value);
  const store = useDocumentStore.getState();
  const editor = useEditorStore.getState();
  editor.setEditing(null);
  if (!lines) {
    if (existing) store.apply((d) => deleteObject(d, page.id, existing.id));
    return;
  }
  const typed: Text = existing
    ? { ...existing, lines }
    : { type: "text", id: crypto.randomUUID(), origin: editing.origin, rotation: editing.rotation, ...style, lines };
  const object = keepInside(typed, page.box) as Text;
  store.apply((d) => (existing ? updateObject(d, page.id, object) : addObject(d, page.id, object)));
  editor.setTool("select");
  editor.select({ pageId: page.id, objectId: object.id });
}

export function TextEditor(props: { page: Page; transform: PageTransform; editing: TextEditing }) {
  const { page, transform, editing } = props;
  const existing = editing.objectId
    ? (page.objects.find((o) => o.id === editing.objectId && o.type === "text") as Text | undefined)
    : undefined;
  const toolProps = useEditorStore((s) => s.props.text);
  const fontSize = existing?.fontSize ?? toolProps.fontSize;
  const color = existing?.color ?? toolProps.color;
  const [value, setValue] = useState(existing ? existing.lines.join("\n") : "");
  const valueRef = useRef(value);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    valueRef.current = value;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) commit(page, editing, existing, valueRef.current, { fontSize, color });
    else useEditorStore.getState().setEditing(null);
  };

  const scale = Math.hypot(transform.matrix[0], transform.matrix[1]);
  const px = fontSize * scale;
  const lh = LINE_HEIGHT * px;
  // Baseline of the first line inside the textarea's first line box (CSS half-leading).
  const baseline = (lh - (TEXT_ASCENT + TEXT_DESCENT) * px) / 2 + TEXT_ASCENT * px;
  const lines = value.split("\n");
  const width = Math.max(2 * px, ...lines.map((l) => lineWidth(l, fontSize) * scale + px));
  const at = toScreen(transform, editing.origin);
  // Screen angle of the text: page display rotation (clockwise) minus the text's rotation.
  const angle = (displayRotation(page.baseRotation, page.userRotation) - editing.rotation + 360) % 360;

  return (
    <div className="absolute" style={{ left: at.x, top: at.y, width: 0, height: 0, transform: `rotate(${angle}deg)`, transformOrigin: "0 0" }}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keys that finish composing a character belong to the input method.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish(true);
          }
        }}
        spellCheck={false}
        wrap="off"
        rows={lines.length}
        className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-1 outline-offset-2 outline-blue-500/70 outline-dashed"
        style={{
          left: 0,
          top: -baseline,
          width,
          height: lines.length * lh,
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: px,
          lineHeight: `${lh}px`,
          color: css(color),
          whiteSpace: "pre",
          fontKerning: "none",
          fontVariantLigatures: "none",
        }}
        data-testid="text-editor"
      />
    </div>
  );
}
