// Second toolbar row (D29): editing tools on the left, properties of the selected object
// (or of the current draw tool) on the right.
import { Ban, Circle, Highlighter, MousePointer2, MoveUpRight, Slash, Square, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PageObject } from "../bindings/PageObject";
import { deleteSelectedObject, setProps } from "../app/objectActions";
import { useEditorStore } from "../editor/editorStore";
import {
  HIGHLIGHT_COLORS,
  OPACITIES,
  PALETTE,
  STROKE_WIDTHS,
  TOOL_KEYS,
  TOOLS,
  propsOf,
  sameColor,
  toolOf,
  type DrawTool,
  type PropsPatch,
  type Rgb,
  type Tool,
} from "../editor/tools";
import { useStrings } from "../i18n";
import { useDocumentStore } from "../state/documentStore";
import { findObject } from "../state/objects";
import { Divider, IconButton } from "./IconButton";

const TOOL_ICONS: Record<Tool, ReactNode> = {
  select: <MousePointer2 />,
  highlight: <Highlighter />,
  rect: <Square />,
  ellipse: <Circle />,
  line: <Slash />,
  arrow: <MoveUpRight />,
};

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** The selected object, re-read whenever the document changes. */
function useSelectedObject(): PageObject | null {
  const sel = useEditorStore((s) => s.selected);
  return useDocumentStore((s) => (sel ? (findObject(s.doc, sel.pageId, sel.objectId)?.object ?? null) : null));
}

function Swatches(props: {
  label: string;
  colors: Record<string, Rgb>;
  value: Rgb | null;
  onPick: (c: Rgb | null) => void;
  /** Offers "none"; disabled when picking it would leave the shape invisible. */
  none?: { disabled: boolean };
  testId: string;
}) {
  const t = useStrings();
  const names = t.editor.colors as Record<string, string>;
  return (
    <div className="flex items-center gap-1" role="group" aria-label={props.label}>
      <span className="mr-0.5 text-xs text-neutral-600">{props.label}</span>
      {props.none && (
        <button
          type="button"
          className="grid size-5 place-items-center rounded-full border border-neutral-400 bg-white text-neutral-500 disabled:opacity-40 aria-pressed:ring-2 aria-pressed:ring-blue-500 aria-pressed:ring-offset-1"
          aria-label={t.editor.none}
          title={t.editor.none}
          aria-pressed={props.value === null}
          disabled={props.none.disabled}
          onClick={() => props.onPick(null)}
          data-testid={`${props.testId}-none`}
        >
          <Ban className="size-3.5" />
        </button>
      )}
      {Object.entries(props.colors).map(([name, c]) => (
        <button
          key={name}
          type="button"
          className="size-5 rounded-full border border-neutral-400 aria-pressed:ring-2 aria-pressed:ring-blue-500 aria-pressed:ring-offset-1"
          style={{ background: css(c) }}
          aria-label={names[name]}
          title={names[name]}
          aria-pressed={sameColor(props.value, c)}
          onClick={() => props.onPick(c)}
          data-testid={`${props.testId}-${name}`}
        />
      ))}
    </div>
  );
}

function NumberSelect(props: {
  label: string;
  value: number;
  options: readonly number[];
  format: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
  testId: string;
}) {
  // A value from elsewhere (a reopened file) is still shown.
  const options = props.options.includes(props.value) ? props.options : [...props.options, props.value].sort((a, b) => a - b);
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-600">
      {props.label}
      <select
        className="h-7 rounded-md border border-neutral-300 bg-white px-1 text-sm text-neutral-900 disabled:opacity-40"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        data-testid={props.testId}
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {props.format(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Properties(props: { kind: DrawTool; values: PropsPatch }) {
  const t = useStrings();
  const v = props.values;
  const opacity = (
    <NumberSelect
      label={t.editor.opacity}
      value={v.opacity ?? 1}
      options={OPACITIES}
      format={(o) => `${Math.round(o * 100)}%`}
      onChange={(opacity) => setProps({ opacity })}
      testId="opacity"
    />
  );
  const width = (disabled: boolean) => (
    <NumberSelect
      label={t.editor.strokeWidth}
      value={v.strokeWidth ?? 2}
      options={STROKE_WIDTHS}
      format={(w) => `${w}pt`}
      disabled={disabled}
      onChange={(strokeWidth) => setProps({ strokeWidth })}
      testId="stroke-width"
    />
  );

  if (props.kind === "highlight") {
    return (
      <>
        <Swatches label={t.editor.color} colors={HIGHLIGHT_COLORS} value={v.color ?? null} onPick={(c) => c && setProps({ color: c })} testId="color" />
        {opacity}
      </>
    );
  }
  if (props.kind === "line" || props.kind === "arrow") {
    return (
      <>
        <Swatches label={t.editor.stroke} colors={PALETTE} value={v.stroke ?? null} onPick={(c) => c && setProps({ stroke: c })} testId="stroke" />
        {width(false)}
        {opacity}
      </>
    );
  }
  const stroke = v.stroke ?? null;
  const fill = v.fill ?? null;
  return (
    <>
      <Swatches
        label={t.editor.stroke}
        colors={PALETTE}
        value={stroke}
        onPick={(c) => setProps({ stroke: c })}
        none={{ disabled: fill === null }}
        testId="stroke"
      />
      {width(stroke === null)}
      <Swatches
        label={t.editor.fill}
        colors={PALETTE}
        value={fill}
        onPick={(c) => setProps({ fill: c })}
        none={{ disabled: stroke === null }}
        testId="fill"
      />
      {opacity}
    </>
  );
}

export function EditBar() {
  const t = useStrings();
  const empty = useDocumentStore((s) => s.doc.pages.length === 0);
  const tool = useEditorStore((s) => s.tool);
  const toolProps = useEditorStore((s) => s.props);
  const selected = useSelectedObject();

  const kind: DrawTool | null = selected ? toolOf(selected) : tool === "select" ? null : tool;
  const values = selected ? propsOf(selected) : kind ? toolProps[kind] : null;

  return (
    <div
      role="toolbar"
      aria-label={t.editor.label}
      className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-300 bg-neutral-50 px-2"
      data-testid="edit-bar"
    >
      {TOOLS.map((tl) => (
        <IconButton
          key={tl}
          label={`${t.editor.tools[tl]} (${TOOL_KEYS[tl].slice(3)})`}
          pressed={tool === tl}
          disabled={empty}
          onClick={() => useEditorStore.getState().setTool(tl)}
          testId={`tool-${tl}`}
        >
          {TOOL_ICONS[tl]}
        </IconButton>
      ))}
      <Divider />
      <div className="flex items-center gap-3" data-testid="properties">
        {kind && values ? (
          <Properties kind={kind} values={values} />
        ) : (
          !empty && <span className="text-xs text-neutral-500">{t.editor.hint}</span>
        )}
      </div>
      {selected && (
        <>
          <Divider />
          <IconButton label={`${t.editor.deleteObject} (Delete)`} onClick={() => deleteSelectedObject()} testId="delete-object">
            <Trash2 />
          </IconButton>
        </>
      )}
    </div>
  );
}
