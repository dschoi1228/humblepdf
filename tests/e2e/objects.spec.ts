// M3 in browser mode: drawing highlights, shapes, lines and arrows with the mouse on pages
// shown at 0/90/180 degrees; selecting, moving, nudging, resizing, property changes,
// deleting and Undo/Redo; saving and reading the annotations back with pdf.js.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Point } from "../../src/bindings/Point";
import type { Rect } from "../../src/bindings/Rect";
import { repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

mkdirSync(join(repoRoot, "out", "m3"), { recursive: true });

const BLUE = [0.118, 0.533, 0.898];
const GREEN = [0.263, 0.627, 0.278];

async function open(page: Page, files: string[]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

/** Shows page `index` (0-based) fully and moves the keyboard focus back to the page. */
async function showPage(page: Page, index: number) {
  const input = page.getByTestId("page-input");
  await input.fill(String(index + 1));
  await input.press("Enter");
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expect(page.locator(`[data-testid=page][data-page-index="${index}"]`)).toBeVisible();
  await waitForIdle(page);
}

const model = (page: Page) => page.evaluate(() => window.__viewer!.model());
const objects = async (page: Page, index: number) => (await model(page)).pages[index].objects;
const editor = (page: Page) => page.evaluate(() => window.__viewer!.editor());
const undoDepth = (page: Page) => page.evaluate(() => window.__viewer!.undoDepth());
const scale = (page: Page) => page.evaluate(() => window.__viewer!.view().scale);

async function client(page: Page, index: number, p: Point): Promise<Point> {
  return page.evaluate(([i, x, y]) => window.__viewer!.clientPoint(i, x, y), [index, p.x, p.y] as const);
}

/** Drags between two user-space points of page `index`. */
async function drag(page: Page, index: number, from: Point, to: Point, shift = false) {
  const a = await client(page, index, from);
  const b = await client(page, index, to);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

async function click(page: Page, index: number, p: Point) {
  const a = await client(page, index, p);
  await page.mouse.click(a.x, a.y);
}

function bounds(o: PageObject): Rect {
  switch (o.type) {
    case "highlight": {
      const ps = o.quads.flat();
      const xs = ps.map((p) => p.x);
      const ys = ps.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case "rect":
    case "ellipse":
      return o.rect;
    case "line":
      return { x0: Math.min(o.from.x, o.to.x), y0: Math.min(o.from.y, o.to.y), x1: Math.max(o.from.x, o.to.x), y1: Math.max(o.from.y, o.to.y) };
    default:
      throw new Error(o.type);
  }
}

function expectNear(actual: number, expected: number, tol: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
}

function expectRect(actual: Rect, expected: Rect, tol: number, what: string) {
  for (const k of ["x0", "y0", "x1", "y1"] as const) expectNear(actual[k], expected[k], tol, `${what}.${k}`);
}

test("draws each kind with the mouse on pages shown at 0 and 90 degrees; Undo and Redo", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  const tol = 1.5 / (await scale(page));
  // Adding the file is the first Undo step (M2).
  const base = await undoDepth(page);

  for (const index of [0, 1]) {
    await showPage(page, index);
    const box = (await model(page)).pages[index].box;
    const P = (x: number, y: number) => ({ x: box.x0 + x, y: box.y0 + y });
    const last = async () => (await objects(page, index)).at(-1)!;

    await page.keyboard.press("KeyH");
    await drag(page, index, P(100, 600), P(300, 630));
    const h = await last();
    expect(h.type).toBe("highlight");
    expectRect(bounds(h), { x0: box.x0 + 100, y0: box.y0 + 600, x1: box.x0 + 300, y1: box.y0 + 630 }, tol, "highlight");
    expect(await editor(page)).toMatchObject({ tool: "highlight", selected: null });

    await page.keyboard.press("KeyR");
    await drag(page, index, P(100, 400), P(250, 500));
    const r = await last();
    expect(r.type).toBe("rect");
    expectRect(bounds(r), { x0: box.x0 + 100, y0: box.y0 + 400, x1: box.x0 + 250, y1: box.y0 + 500 }, tol, "rect");
    expect(await editor(page)).toEqual({ tool: "select", selected: { pageId: (await model(page)).pages[index].id, objectId: r.id } });

    // A click makes a 120x80 pt ellipse along the screen axes.
    await page.keyboard.press("KeyO");
    await click(page, index, P(400, 450));
    const e = bounds(await last());
    const [wScreen, hScreen] = index === 0 ? [e.x1 - e.x0, e.y1 - e.y0] : [e.y1 - e.y0, e.x1 - e.x0];
    expectNear(wScreen, 120, 1e-6, "ellipse width on screen");
    expectNear(hScreen, 80, 1e-6, "ellipse height on screen");

    // Shift snaps to 45 degrees.
    await page.keyboard.press("KeyL");
    await drag(page, index, P(100, 300), P(300, 312), true);
    const l = await last();
    expect(l).toMatchObject({ type: "line", arrow: false });
    if (l.type === "line") expectNear(l.to.y, l.from.y, 1e-6, "snapped line");

    await page.keyboard.press("KeyA");
    await drag(page, index, P(100, 200), P(300, 250));
    const a = await last();
    expect(a).toMatchObject({ type: "line", arrow: true });
    if (a.type === "line") {
      expectNear(a.from.x, box.x0 + 100, tol, "arrow from.x");
      expectNear(a.to.y, box.y0 + 250, tol, "arrow to.y");
    }
    expect((await objects(page, index)).map((o) => o.type)).toEqual(["highlight", "rect", "ellipse", "line", "line"]);
  }

  // One Undo step per object.
  expect(await undoDepth(page)).toBe(base + 10);
  for (let i = 0; i < 10; i++) await page.keyboard.press("Control+z");
  expect((await model(page)).pages.every((p) => p.objects.length === 0)).toBe(true);
  for (let i = 0; i < 10; i++) await page.keyboard.press("Control+y");
  expect((await model(page)).pages.slice(0, 2).map((p) => p.objects.length)).toEqual([5, 5]);
  // Thumbnails show the objects too.
  await expect(page.getByTestId("thumbnail").first().getByTestId("object")).toHaveCount(5);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("select, move, nudge, resize, properties, delete, Esc and blocked keys", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  await showPage(page, 0);
  const tol = 1.5 / (await scale(page));
  const box = (await model(page)).pages[0].box;
  const P = (x: number, y: number) => ({ x: box.x0 + x, y: box.y0 + y });
  const rect = async () => {
    const o = (await objects(page, 0))[0];
    if (o?.type !== "rect") throw new Error("no rect");
    return o;
  };

  await page.getByTestId("tool-rect").click();
  const base = await undoDepth(page);
  await drag(page, 0, P(100, 400), P(250, 500));
  expect(await undoDepth(page)).toBe(base + 1);

  // Drag inside the shape: one step.
  await drag(page, 0, P(175, 450), P(225, 430));
  expectRect((await rect()).rect, { x0: box.x0 + 150, y0: box.y0 + 380, x1: box.x0 + 300, y1: box.y0 + 480 }, tol, "moved");
  expect(await undoDepth(page)).toBe(base + 2);

  // Dragging far outside keeps the shape on the page.
  await drag(page, 0, P(225, 430), P(2000, 430));
  expectNear((await rect()).rect.x1, box.x1, 1e-6, "clamped x1");
  await page.keyboard.press("Control+z");
  expectNear((await rect()).rect.x0, box.x0 + 150, tol, "undo clamp");

  // Arrow keys: 1 pt, Shift 10 pt, in screen directions.
  const before = (await rect()).rect;
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const after = (await rect()).rect;
  expectNear(after.x0, before.x0 + 1, 1e-9, "nudge right");
  expectNear(after.y0, before.y0 - 10, 1e-9, "nudge down");
  let depth = await undoDepth(page);

  // Resize with the upper-right handle (x1, y1 in user space).
  const handle = page.locator('[data-testid=handle][data-handle="1,1"]');
  const hb = (await handle.boundingBox())!;
  const target = await client(page, 0, P(350, 560));
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
  const resized = (await rect()).rect;
  expectRect(resized, { x0: after.x0, y0: after.y0, x1: box.x0 + 350, y1: box.y0 + 560 }, tol, "resized");
  expect(await undoDepth(page)).toBe(++depth);

  // Properties: each change is one step.
  await page.getByTestId("stroke-blue").click();
  await page.getByTestId("stroke-width").selectOption("6");
  await page.getByTestId("fill-green").click();
  await page.getByTestId("stroke-none").click();
  await page.getByTestId("opacity").selectOption("0.5");
  expect(await rect()).toMatchObject({ stroke: null, strokeWidth: 6, fill: GREEN, opacity: 0.5 });
  expect(await undoDepth(page)).toBe(depth + 5);
  // Neither stroke nor fill would hide the shape.
  await expect(page.getByTestId("fill-none")).toBeDisabled();
  // Undo goes back one property change at a time.
  await page.getByTestId("opacity").evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press("Control+z");
  expect(await rect()).toMatchObject({ stroke: null, fill: GREEN, opacity: 1 });
  await page.keyboard.press("Control+z");
  expect(await rect()).toMatchObject({ stroke: BLUE, fill: GREEN });
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+y");
  expect(await rect()).toMatchObject({ stroke: null, opacity: 0.5 });

  // Keys typed into a field do not reach the editor.
  await page.getByTestId("page-input").focus();
  await page.keyboard.press("KeyR");
  expect((await editor(page)).tool).toBe("select");
  await page.getByTestId("page-input").evaluate((el) => (el as HTMLElement).blur());

  // Delete removes the object, not the page.
  const pages = (await model(page)).pages.length;
  await page.keyboard.press("Delete");
  expect(await objects(page, 0)).toEqual([]);
  expect((await model(page)).pages.length).toBe(pages);
  await page.keyboard.press("Control+z");
  expect(await objects(page, 0)).toHaveLength(1);

  // Click selects, the edit bar's delete button removes; empty click deselects.
  await click(page, 0, P(200, 450));
  expect((await editor(page)).selected?.objectId).toBe((await rect()).id);
  await click(page, 0, P(500, 100));
  expect((await editor(page)).selected).toBeNull();
  await click(page, 0, P(200, 450));
  await page.getByTestId("delete-object").click();
  expect(await objects(page, 0)).toEqual([]);
  await page.keyboard.press("Control+z");

  // Esc: draw tool -> selection tool -> no selection.
  await click(page, 0, P(200, 450));
  await page.keyboard.press("KeyO");
  expect(await editor(page)).toEqual({ tool: "ellipse", selected: null });
  await page.keyboard.press("Escape");
  expect((await editor(page)).tool).toBe("select");
  await click(page, 0, P(200, 450));
  await page.keyboard.press("Escape");
  expect((await editor(page)).selected).toBeNull();

  // Esc during a drag cancels it.
  const count = (await objects(page, 0)).length;
  await page.keyboard.press("KeyR");
  const s = await client(page, 0, P(50, 50));
  const t = await client(page, 0, P(150, 150));
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await objects(page, 0)).toHaveLength(count);
  expect((await editor(page)).tool).toBe("rect");

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("saved objects are standard annotations that pdf.js reads back", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  for (const index of [0, 2]) {
    await showPage(page, index);
    const box = (await model(page)).pages[index].box;
    const P = (x: number, y: number) => ({ x: box.x0 + x, y: box.y0 + y });
    await page.keyboard.press("KeyH");
    await drag(page, index, P(100, 600), P(300, 630));
    await page.keyboard.press("KeyR");
    await drag(page, index, P(100, 400), P(250, 500));
    await page.keyboard.press("KeyO");
    await drag(page, index, P(300, 400), P(450, 520));
    await page.getByTestId("fill-blue").click();
    await page.keyboard.press("KeyL");
    await drag(page, index, P(100, 300), P(300, 320));
    await page.keyboard.press("KeyA");
    await drag(page, index, P(100, 200), P(300, 250));
    await page.keyboard.press("Escape");
  }

  page.on("dialog", (d) => void d.accept("/__out/m3/objects.pdf"));
  await page.keyboard.press("Control+Shift+s");
  await expect(page.getByText('"objects.pdf"에 저장했습니다.')).toBeVisible({ timeout: 30_000 });

  const doc = await model(page);
  const annots = await page.evaluate(async () => {
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      openPdf(d: Uint8Array): Promise<{
        numPages: number;
        getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string; rect: number[]; color: number[] | null }[]> }>;
        loadingTask: { destroy(): Promise<void> };
      }>;
    };
    const bytes = new Uint8Array(await (await fetch("/__out/m3/objects.pdf")).arrayBuffer());
    const pdf = await mod.openPdf(bytes);
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const list = await (await pdf.getPage(n)).getAnnotations();
      out.push(list.map((a) => ({ subtype: a.subtype, rect: Array.from(a.rect), color: a.color ? Array.from(a.color) : null })));
    }
    await pdf.loadingTask.destroy();
    return out;
  });

  const subtype = { highlight: "Highlight", rect: "Square", ellipse: "Circle", line: "Line" } as Record<string, string>;
  expect(annots.length).toBe(doc.pages.length);
  doc.pages.forEach((p, i) => {
    expect(annots[i].map((a) => a.subtype), `page ${i + 1}`).toEqual(p.objects.map((o) => subtype[o.type]));
    p.objects.forEach((o, j) => {
      const a = annots[i][j];
      const g = bounds(o);
      const [x0, y0, x1, y1] = a.rect;
      // /Rect covers the geometry plus at most the stroke and arrowhead.
      expect(x0 <= g.x0 + 1e-3 && y0 <= g.y0 + 1e-3 && x1 >= g.x1 - 1e-3 && y1 >= g.y1 - 1e-3, `${o.type} rect`).toBe(true);
      expect(Math.max(g.x0 - x0, g.y0 - y0, x1 - g.x1, y1 - g.y1), `${o.type} rect margin`).toBeLessThanOrEqual(10);
      const color =
        o.type === "highlight" ? o.color : o.type === "line" ? o.stroke : o.type === "rect" || o.type === "ellipse" ? o.stroke : null;
      if (color) expect(a.color, `${o.type} color`).toEqual(color.map((v) => Math.round(v * 255)));
    });
  });

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
