// M13: highlights that follow the page text (SPEC 6.5, D48). text_select.pdf has three
// 24 pt lines (Latin, Korean, Japanese) at baselines 760, 710 and 660 starting at x = 60;
// page 2 is the same page with /Rotate 90.
import { expect, test, type Page } from "@playwright/test";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Point } from "../../src/bindings/Point";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const BASELINES = [760, 710, 660];
const LEFT = 60;
const FONT_SIZE = 24;

async function open(page: Page, files = ["text_select.pdf"]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
  await showFirst(page, 0);
}

/** Brings page `index` into view and waits for its text layer, laid out at the page's rotation. */
async function showFirst(page: Page, index: number) {
  await page.getByTestId("thumbnail").nth(index).click();
  await waitForIdle(page);
  await page.waitForFunction((i) => {
    const p = window.__viewer!.model().pages[i];
    const layer = document.querySelector(`[data-testid=page][data-page-index="${i}"] [data-testid=text-layer][data-ready='1']`);
    return !!layer?.querySelector("span") && Number(layer.getAttribute("data-main-rotation")) === (p.baseRotation + p.userRotation) % 360;
  }, index);
}

const at = (page: Page, index: number, x: number, y: number) =>
  page.evaluate(([i, px, py]) => window.__viewer!.clientPoint(i, px, py), [index, x, y] as const);

async function drag(page: Page, index: number, from: [number, number], to: [number, number]) {
  const a = await at(page, index, ...from);
  const b = await at(page, index, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

const model = (page: Page) => page.evaluate(() => window.__viewer!.model());
const highlights = async (page: Page, index: number) =>
  (await model(page)).pages[index].objects.filter((o): o is Extract<PageObject, { type: "highlight" }> => o.type === "highlight");
const selection = (page: Page) => page.evaluate(() => document.getSelection()?.toString() ?? "");

type Quad = [Point, Point, Point, Point];
const bounds = (q: Quad) => ({
  x0: Math.min(...q.map((p) => p.x)),
  x1: Math.max(...q.map((p) => p.x)),
  y0: Math.min(...q.map((p) => p.y)),
  y1: Math.max(...q.map((p) => p.y)),
});

/**
 * A quad over the line at `baseline`: starts at the left of the text, one font size tall
 * around the baseline, and its points go upper left, upper right, lower left, lower right
 * as the text reads (user space, text upright in the page: y up).
 */
function expectLineQuad(q: Quad, baseline: number, startsAtLeft = true) {
  const b = bounds(q);
  if (startsAtLeft) expect(Math.abs(b.x0 - LEFT)).toBeLessThan(1.5);
  expect(Math.abs(b.y1 - b.y0 - FONT_SIZE)).toBeLessThan(1.5);
  expect(b.y0).toBeLessThan(baseline);
  expect(b.y0).toBeGreaterThan(baseline - 10);
  expect(b.y1).toBeGreaterThan(baseline + 12);
  // Quad order.
  expect(q[0].x).toBeCloseTo(b.x0, 3);
  expect(q[0].y).toBeCloseTo(b.y1, 3);
  expect(q[1].x).toBeCloseTo(b.x1, 3);
  expect(q[1].y).toBeCloseTo(b.y1, 3);
  expect(q[2].x).toBeCloseTo(b.x0, 3);
  expect(q[2].y).toBeCloseTo(b.y0, 3);
  expect(q[3].x).toBeCloseTo(b.x1, 3);
  expect(q[3].y).toBeCloseTo(b.y0, 3);
}

test("the highlight tool marks the dragged text, one quad per line", async ({ page }) => {
  const w = watch(page);
  await open(page);
  await page.getByTestId("tool-highlight").click();

  // Part of the first line: from its start into "HumblePDF".
  await drag(page, 0, [LEFT + 1, BASELINES[0] + 8], [200, BASELINES[0] + 8]);
  let hs = await highlights(page, 0);
  expect(hs).toHaveLength(1);
  expect(hs[0].quads).toHaveLength(1);
  expectLineQuad(hs[0].quads[0] as Quad, BASELINES[0]);
  const partial = bounds(hs[0].quads[0] as Quad);
  expect(partial.x1).toBeGreaterThan(180);
  expect(partial.x1).toBeLessThan(215);
  // The selection is gone and the tool stays (SPEC 6.4).
  expect(await selection(page)).toBe("");
  expect((await page.evaluate(() => window.__viewer!.editor())).tool).toBe("highlight");

  // All three lines, released past the end of the last one.
  await drag(page, 0, [LEFT + 1, BASELINES[0] + 8], [520, BASELINES[2] + 8]);
  hs = await highlights(page, 0);
  expect(hs).toHaveLength(2);
  expect(hs[1].quads).toHaveLength(3);
  hs[1].quads.forEach((q, i) => expectLineQuad(q as Quad, BASELINES[i]));
  // Each line ends at its text, not at the release point.
  for (const q of hs[1].quads) expect(bounds(q as Quad).x1).toBeLessThan(400);
  expect(hs[1].color).toEqual(hs[0].color);

  // One Undo step per drag.
  await page.keyboard.press("Control+z");
  expect(await highlights(page, 0)).toHaveLength(1);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);
  expect(w.consoleProblems).toEqual([]);
  expect(w.external).toEqual([]);
});

test("a drag away from the text, or on an image page, draws a box highlight", async ({ page }) => {
  await open(page);
  await page.getByTestId("tool-highlight").click();
  // From the left margin (30 pt left of the text) across the first line.
  await drag(page, 0, [30, BASELINES[0] + 20], [300, BASELINES[0] - 6]);
  const [h] = await highlights(page, 0);
  expect(h.quads).toHaveLength(1);
  const b = bounds(h.quads[0] as Quad);
  expect(b.x0).toBeCloseTo(30, 0);
  expect(b.x1).toBeCloseTo(300, 0);
  expect(await selection(page)).toBe("");

  await page.goto(`/?open=${fixtureUrl("photo.jpg")}`);
  await waitForRenders(page);
  await page.getByTestId("tool-highlight").click();
  const box = (await model(page)).pages[0].box;
  await drag(page, 0, [box.x0 + 40, box.y1 - 40], [box.x0 + 200, box.y1 - 80]);
  expect(await highlights(page, 0)).toHaveLength(1);
});

test("H highlights the selected text, across pages in one Undo step", async ({ page }) => {
  await open(page);
  // Select the second line with the select tool, then H.
  await drag(page, 0, [LEFT + 1, BASELINES[1] + 8], [520, BASELINES[1] + 8]);
  expect((await selection(page)).trim()).toBe("한글 본문을 복사합니다");
  await page.keyboard.press("KeyH");
  const hs = await highlights(page, 0);
  expect(hs).toHaveLength(1);
  expectLineQuad(hs[0].quads[0] as Quad, BASELINES[1]);
  expect(await selection(page)).toBe("");
  const editor = await page.evaluate(() => window.__viewer!.editor());
  expect(editor.tool).toBe("select");
  expect(editor.selected?.objectId).toBe(hs[0].id);
  await page.keyboard.press("Control+z");
  expect(await highlights(page, 0)).toHaveLength(0);

  // Without a text selection H only picks the tool.
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyH");
  expect((await page.evaluate(() => window.__viewer!.editor())).tool).toBe("highlight");
  expect(await highlights(page, 0)).toHaveLength(0);
  await page.keyboard.press("Escape");

  // From the last line of page 1 to the first line of page 2 (the drag that makes such a
  // selection is covered in text-select.spec.ts).
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=text-layer][data-ready='1']").length === 2);
  await page.evaluate(() => {
    const layers = document.querySelectorAll("[data-testid=text-layer]");
    const text = (layer: Element, last: boolean) => {
      const spans = [...layer.querySelectorAll("span:not(.markedContent)")].filter((s) => s.firstChild?.nodeType === Node.TEXT_NODE && s.textContent);
      return (last ? spans[spans.length - 1] : spans[0]).firstChild as Text;
    };
    const a = text(layers[0], true);
    const b = text(layers[1], false);
    document.getSelection()!.setBaseAndExtent(a, 0, b, b.data.length);
  });
  await page.keyboard.press("KeyH");
  const [p1, p2] = [await highlights(page, 0), await highlights(page, 1)];
  expect(p1).toHaveLength(1);
  expect(p2).toHaveLength(1);
  expectLineQuad(p1[0].quads[0] as Quad, BASELINES[2]);
  expectLineQuad(p2[0].quads[0] as Quad, BASELINES[0]);
  await page.keyboard.press("Control+z");
  expect(await highlights(page, 0)).toHaveLength(0);
  expect(await highlights(page, 1)).toHaveLength(0);
});

test("text highlights fit the glyphs when zoomed and on rotated pages", async ({ page }) => {
  await open(page);
  await page.getByTestId("tool-highlight").click();
  // Reference: the whole Korean line at fit-page.
  await drag(page, 0, [LEFT + 1, BASELINES[1] + 8], [520, BASELINES[1] + 8]);
  const ref = bounds((await highlights(page, 0))[0].quads[0] as Quad);

  // Zoomed in twice.
  await page.getByTestId("zoom-in").click();
  await page.getByTestId("zoom-in").click();
  await waitForIdle(page);
  await showFirst(page, 0);
  await drag(page, 0, [LEFT + 1, BASELINES[1] + 8], [520, BASELINES[1] + 8]);
  const zoomed = await highlights(page, 0);
  expect(zoomed).toHaveLength(2);
  const z = bounds(zoomed[1].quads[0] as Quad);
  for (const k of ["x0", "x1", "y0", "y1"] as const) expect(Math.abs(z[k] - ref[k])).toBeLessThan(1);

  // Page 2: /Rotate 90, then turned once more by the user (180 in all). In user space the
  // quad is the same as on the upright page, with the same point order.
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
  await showFirst(page, 1);
  await drag(page, 1, [LEFT + 1, BASELINES[1] + 8], [520, BASELINES[1] + 8]);
  let r = await highlights(page, 1);
  expect(r).toHaveLength(1);
  expectLineQuad(r[0].quads[0] as Quad, BASELINES[1]);
  const q90 = bounds(r[0].quads[0] as Quad);
  for (const k of ["x0", "x1", "y0", "y1"] as const) expect(Math.abs(q90[k] - ref[k])).toBeLessThan(1);

  await page.keyboard.press("Escape");
  await page.getByTestId("thumbnail").nth(1).click();
  await page.keyboard.press("Control+BracketRight");
  await waitForIdle(page);
  await page.getByTestId("tool-highlight").click();
  await showFirst(page, 1);
  await drag(page, 1, [LEFT + 1, BASELINES[2] + 8], [520, BASELINES[2] + 8]);
  r = await highlights(page, 1);
  expect(r).toHaveLength(2);
  expectLineQuad(r[1].quads[0] as Quad, BASELINES[2]);
});

test("writes out/m13_sample.pdf: text highlights on pages shown at 0, 90, 180 and 270 degrees", async ({ page }) => {
  // For people to open in other viewers (docs/M13_REPORT.md). The file twice: pages at
  // /Rotate 0, 90, 0, 90; the user turns the last two by 180 (180 and 270 in all).
  await open(page, ["text_select.pdf", "text_select.pdf"]);
  await expect(page.getByTestId("thumbnail")).toHaveCount(4);
  await page.getByTestId("thumbnail").nth(2).click();
  await page.getByTestId("thumbnail").nth(3).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+BracketRight");
  await page.keyboard.press("Control+BracketRight");
  await waitForIdle(page);
  const rotations = (await model(page)).pages.map((p) => (p.baseRotation + p.userRotation) % 360);
  expect(rotations).toEqual([0, 90, 180, 270]);

  // Small enough for a whole upright page in the view (fit-page fits the sideways ones), so
  // the text of the last page can be brought into the middle.
  await page.getByTestId("zoom-out").click();
  await page.getByTestId("zoom-out").click();
  await waitForIdle(page);

  const colors = ["yellow", "green", "pink", "sky"];
  for (const [index, color] of colors.entries()) {
    // The text in the middle of the view.
    await showFirst(page, index);
    await page.evaluate((i) => {
      const layer = document.querySelector(`[data-testid=page][data-page-index="${i}"] [data-testid=text-layer]`)!;
      const rects = [...layer.querySelectorAll("span:not(.markedContent)")].map((s) => s.getBoundingClientRect());
      const view = document.querySelector<HTMLElement>("[data-testid=page-view]")!;
      const v = view.getBoundingClientRect();
      const cy = (Math.min(...rects.map((r) => r.top)) + Math.max(...rects.map((r) => r.bottom))) / 2;
      const cx = (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2;
      view.scrollTop += cy - (v.top + v.height / 2);
      view.scrollLeft += cx - (v.left + v.width / 2);
    }, index);
    await waitForIdle(page);
    await page.getByTestId("tool-highlight").click();
    await page.getByTestId(`color-${color}`).click();
    // One word ("HumblePDF") with H from a double-click selection (first: a highlight there
    // would take the double-click), then all three lines with the tool, over that word.
    await page.keyboard.press("Escape");
    const word = await at(page, index, 200, BASELINES[0] + 8);
    await page.mouse.dblclick(word.x, word.y);
    expect((await selection(page)).trim(), `page ${index + 1}`).toBe("HumblePDF");
    await page.keyboard.press("KeyH");
    await page.getByTestId("tool-highlight").click();
    await drag(page, index, [LEFT + 1, BASELINES[0] + 8], [400, BASELINES[2] + 8]);
    const hs = await highlights(page, index);
    expect(hs.map((h) => h.quads.length), `page ${index + 1}`).toEqual([1, 3]);
    expectLineQuad(hs[0].quads[0] as Quad, BASELINES[0], false);
    hs[1].quads.forEach((q, i) => expectLineQuad(q as Quad, BASELINES[i]));
    expect(hs.every((h) => JSON.stringify(h.color) === JSON.stringify(hs[0].color))).toBe(true);
  }
  page.once("dialog", (d) => void d.accept("/__out/m13_sample.pdf"));
  await page.getByTestId("save-as").click();
  await expect(page.getByTestId("saving-dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__viewer!.dirty())).toBe(false);
});
