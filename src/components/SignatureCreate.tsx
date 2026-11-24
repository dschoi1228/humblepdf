// Creating signatures in the library dialog (SPEC 6.8, D44): adding an image with an optional
// white background removal (strength slider, preview made by the core), and drawing one.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { backend } from "../backend";
import type { PickedFile } from "../backend/types";
import { useStrings } from "../i18n";
import {
  CROP_PADDING,
  DEFAULT_STRENGTH,
  hasTransparency,
  INK_COLORS,
  inkBounds,
  STROKE_WIDTH,
  strokeWidth,
  type InkColor,
} from "../signatures/draw";

/** Checkerboard behind previews, so transparent parts show. */
const CHECKER = {
  backgroundImage: "conic-gradient(#e5e5e5 25%, #fff 0 50%, #e5e5e5 0 75%, #fff 0)",
  backgroundSize: "16px 16px",
};

/** Wait after the last slider move before asking the core for a new preview. */
const PREVIEW_DELAY_MS = 120;

async function decodeAlpha(png: Uint8Array): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([png as BlobPart]));
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-neutral-600">{props.label}</span>
      {props.children}
    </label>
  );
}

/** Adding an image: preview, white background removal with strength, name. */
export function SignatureImport(props: {
  file: PickedFile;
  defaultName: string;
  onSave: (name: string, removeWhite: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useStrings();
  const [name, setName] = useState(props.defaultName);
  const [remove, setRemove] = useState<boolean | null>(null); // null until the image is checked
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  // First look: the image as is decides the switch's default (on unless it is transparent).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const png = await backend.signaturePreview(props.file, null);
        const alpha = await decodeAlpha(png);
        if (!cancelled) setRemove(!hasTransparency(alpha));
      } catch {
        if (!cancelled) setRemove(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.file]);

  // The preview follows the switch and the slider (the core does the work, D44).
  useEffect(() => {
    if (remove === null) return;
    const id = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const png = await backend.signaturePreview(props.file, remove ? strength : null);
        if (id !== request.current) return;
        const next = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return next;
        });
      } catch {
        // The save reports errors; a failed preview leaves the last one.
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [props.file, remove, strength]);

  useEffect(() => () => setUrl((old) => (old && URL.revokeObjectURL(old), null)), []);

  const save = async () => {
    setBusy(true);
    try {
      await props.onSave(name, remove ? strength : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="signature-import"
      data-ready={url !== null && remove !== null ? "true" : "false"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex h-40 items-center justify-center rounded-md border border-neutral-200 p-2" style={CHECKER}>
        {url && <img src={url} alt={t.signatures.preview} className="max-h-full max-w-full object-contain" data-testid="signature-import-preview" />}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-neutral-900"
          checked={remove ?? false}
          disabled={remove === null}
          onChange={(e) => setRemove(e.target.checked)}
          data-testid="signature-remove-white"
        />
        {t.signatures.removeWhite}
      </label>
      <Field label={t.signatures.strength}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={strength}
          disabled={!remove}
          onChange={(e) => setStrength(Number(e.target.value))}
          className="flex-1 accent-neutral-900"
          aria-label={t.signatures.strength}
          data-testid="signature-strength"
        />
        <span className="w-8 text-right tabular-nums">{strength}</span>
      </Field>
      <p className="text-xs text-neutral-500">{t.signatures.strengthHint}</p>
      <Field label={t.signatures.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t.signatures.name} data-testid="signature-import-name" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {t.signatures.cancel}
        </Button>
        <Button type="submit" disabled={busy || remove === null || !name.trim()} data-testid="signature-import-save">
          {t.signatures.save}
        </Button>
      </div>
    </form>
  );
}

type Point = { x: number; y: number; w: number };
type Stroke = Point[];
export type PadHandle = { png: () => Promise<Uint8Array | null> };

/** Canvas resolution per CSS pixel: at least 2 so a placed signature stays sharp. */
const RESOLUTION = Math.max(2, Math.min(3, globalThis.devicePixelRatio || 1));

/** Drawing pad: mouse, pen (pressure) and touch strokes in the chosen ink. */
function SignaturePad({ ink, onChange, ref }: { ink: InkColor; onChange: (empty: boolean) => void; ref: Ref<PadHandle> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);

  const ctx = () => canvas.current?.getContext("2d") ?? null;

  const drawSegment = (c: CanvasRenderingContext2D, a: Point, b: Point) => {
    c.strokeStyle = INK_COLORS[ink];
    c.lineWidth = ((a.w + b.w) / 2) * RESOLUTION;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  };

  const redraw = () => {
    const c = ctx();
    const el = canvas.current;
    if (!c || !el) return;
    c.clearRect(0, 0, el.width, el.height);
    for (const s of strokes.current) {
      if (s.length === 1) drawSegment(c, s[0], s[0]);
      for (let i = 1; i < s.length; i++) drawSegment(c, s[i - 1], s[i]);
    }
  };

  // Size the canvas to its box once; the ink colour redraws everything.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.width = Math.round(el.clientWidth * RESOLUTION);
    el.height = Math.round(el.clientHeight * RESOLUTION);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(redraw, [ink]);

  useImperativeHandle(ref, () => ({
    png: async () => {
      const el = canvas.current;
      const c = ctx();
      if (!el || !c || !strokes.current.length) return null;
      const box = inkBounds(c.getImageData(0, 0, el.width, el.height).data, el.width, el.height, CROP_PADDING);
      if (!box) return null;
      const out = document.createElement("canvas");
      out.width = box.w;
      out.height = box.h;
      out.getContext("2d")!.drawImage(el, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  }));

  const point = (e: PointerEvent | React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * RESOLUTION,
      y: (e.clientY - r.top) * RESOLUTION,
      w: strokeWidth(STROKE_WIDTH, e.pointerType, e.pressure),
    };
  };

  return (
    <canvas
      ref={canvas}
      className="h-44 w-full touch-none rounded-md border border-neutral-300 bg-white"
      data-testid="signature-pad"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        current.current = [p];
        strokes.current.push(current.current);
        const c = ctx();
        if (c) drawSegment(c, p, p);
        onChange(false);
      }}
      onPointerMove={(e) => {
        const s = current.current;
        const c = ctx();
        if (!s || !c) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = point(ev);
          drawSegment(c, s[s.length - 1], p);
          s.push(p);
        }
      }}
      onPointerUp={() => (current.current = null)}
      onPointerCancel={() => (current.current = null)}
      onLostPointerCapture={() => (current.current = null)}
      // Clearing is done by the parent through a new key.
    />
  );
}

/** Drawing a signature: pad, ink colour, clear, name. */
export function SignatureDraw(props: {
  defaultName: string;
  onSave: (png: Uint8Array, name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useStrings();
  const [ink, setInk] = useState<InkColor>("black");
  const [empty, setEmpty] = useState(true);
  const [name, setName] = useState(props.defaultName);
  const [padKey, setPadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const pad = useRef<PadHandle>(null);

  const save = async () => {
    const png = await pad.current?.png();
    if (!png) return;
    setBusy(true);
    try {
      await props.onSave(png, name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="signature-draw"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-neutral-600">{t.signatures.drawHint}</p>
      <SignaturePad key={padKey} ref={pad} ink={ink} onChange={setEmpty} />
      <div className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0 text-neutral-600">{t.signatures.ink}</span>
        {(Object.keys(INK_COLORS) as InkColor[]).map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={ink === c ? "secondary" : "ghost"}
            aria-pressed={ink === c}
            onClick={() => setInk(c)}
            data-testid={`signature-ink-${c}`}
          >
            <span className="size-3 rounded-full" style={{ background: INK_COLORS[c] }} />
            {c === "black" ? t.signatures.inkBlack : t.signatures.inkBlue}
          </Button>
        ))}
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={empty}
          onClick={() => {
            setPadKey((k) => k + 1);
            setEmpty(true);
          }}
          data-testid="signature-clear"
        >
          {t.signatures.clear}
        </Button>
      </div>
      <Field label={t.signatures.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t.signatures.name} data-testid="signature-draw-name" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {t.signatures.cancel}
        </Button>
        <Button type="submit" disabled={busy || empty || !name.trim()} data-testid="signature-draw-save">
          {t.signatures.save}
        </Button>
      </div>
    </form>
  );
}
