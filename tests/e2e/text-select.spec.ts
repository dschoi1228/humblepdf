// M12: selecting and copying page text (SPEC 6.2, D47). text_select.pdf has three lines
// (Latin, Korean, Japanese) at baselines 760, 710 and 660 pt; page 2 is the same page with
// /Rotate 90.
import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const LINES = ["Select me: HumblePDF 0.3", "한글 본문을 복사합니다", "日本語のテキストです"];
const BASELINES = [760, 710, 660];

async function open(page: Page, files = ["text_select.pdf"]) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  // Whole pages in view: every point the tests use is on screen.
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
  await page.getByTestId("thumbnail").first().click();
  await waitForIdle(page);
  await page.waitForFunction(() => document.querySelector("[data-testid=text-layer][data-ready='1'] span") !== null);
}

const at = (page: Page, index: number, x: number, y: number) =>
  page.evaluate(([i, px, py]) => window.__viewer!.clientPoint(i, px, py), [index, x, y] as const);

/** Drags from one user-space point to another on page `index` with a real mouse. */
async function drag(page: Page, index: number, from: [number, number], to: [number, number]) {
  const a = await at(page, index, ...from);
  const b = await at(page, index, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

/** Objects on the pages (thumbnails draw them too). */
const objects = (page: Page) => page.getByTestId("page-view").getByTestId("object");
const selection = (page: Page) => page.evaluate(() => document.getSelection()?.toString() ?? "");
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

test("drag selects the page text and Ctrl+C copies it; Esc clears it", async ({ page }) => {
  const w = watch(page);
  await open(page);
  // From inside the first glyph to past the end of the last line.
  await drag(page, 0, [61, BASELINES[0] + 8], [520, BASELINES[2] + 8]);
  expect(lines(await selection(page))).toEqual(LINES);
  await page.keyboard.press("Control+c");
  expect(lines(await clipboard(page))).toEqual(LINES);

  // A drag that starts in the margin left of the text also selects.
  await page.keyboard.press("Escape");
  expect(await selection(page)).toBe("");
  await drag(page, 0, [30, BASELINES[0] + 8], [520, BASELINES[1] + 8]);
  expect(lines(await selection(page))).toEqual(LINES.slice(0, 2));

  // Into the next page (scrolled): the pages are separate lines.
  await page.getByTestId("fit-width").click();
  await waitForIdle(page);
  await page.getByTestId("thumbnail").first().click();
  await waitForIdle(page);
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=text-layer][data-ready='1']").length === 2);
  const a = await at(page, 0, 61, BASELINES[0] + 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Past the bottom of the view: it scrolls until the second page is under the pointer.
  const view = (await page.getByTestId("page-view").boundingBox())!;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height - 4, { steps: 8 });
  await page.waitForFunction(() => (document.getSelection()?.toString().match(/Select me/g) ?? []).length === 2, undefined, { timeout: 20_000 });
  await page.mouse.up();
  expect(lines(await selection(page)).slice(0, 4)).toEqual([...LINES, LINES[0]]);

  // The page is unchanged: selecting is not an edit.
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(false);
  expect(w.consoleProblems).toEqual([]);
  expect(w.external).toEqual([]);
});

test("double-click selects a word; selection follows zoom and rotation", async ({ page }) => {
  await open(page);
  const word = await at(page, 0, 200, BASELINES[0] + 8);
  await page.mouse.dblclick(word.x, word.y);
  expect((await selection(page)).trim()).toBe("HumblePDF");

  // Zoomed in: the layer is laid out again at the new scale.
  await page.getByTestId("zoom-in").click();
  await page.getByTestId("zoom-in").click();
  await waitForIdle(page);
  await page.getByTestId("thumbnail").first().click();
  await waitForIdle(page);
  await drag(page, 0, [61, BASELINES[1] + 8], [520, BASELINES[1] + 8]);
  expect((await selection(page)).trim()).toBe(LINES[1]);

  // Page 2 has /Rotate 90; then the user turns it once more (180 in all).
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
  await page.getByTestId("thumbnail").nth(1).click();
  await waitForIdle(page);
  await drag(page, 1, [61, BASELINES[2] + 8], [520, BASELINES[2] + 8]);
  expect((await selection(page)).trim()).toBe(LINES[2]);
  await page.keyboard.press("Control+BracketRight");
  await waitForIdle(page);
  await page.getByTestId("thumbnail").nth(1).click();
  await waitForIdle(page);
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=text-layer][data-ready='1']").length === 2);
  await drag(page, 1, [61, BASELINES[0] + 8], [520, BASELINES[0] + 8]);
  expect((await selection(page)).trim()).toBe(LINES[0]);
});

test("objects keep priority over the text under them; Ctrl+C copies what is selected", async ({ page }) => {
  await open(page);
  // A highlight over the second line.
  await page.getByTestId("tool-highlight").click();
  await drag(page, 0, [55, BASELINES[1] - 6], [300, BASELINES[1] + 22]);
  await page.keyboard.press("Escape");
  await expect(objects(page)).toHaveCount(1);

  // Clicking it selects the highlight, not the text below it.
  const h = await at(page, 0, 150, BASELINES[1] + 8);
  await page.mouse.move(h.x - 3, h.y);
  await page.mouse.click(h.x, h.y);
  await expect(page.getByTestId("selection")).toHaveCount(1);
  expect(await selection(page)).toBe("");
  // Ctrl+C / Ctrl+V with the object selected still copies the object.
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects(page)).toHaveCount(2);

  // Dragging on the text away from the objects selects text and drops the object selection.
  await drag(page, 0, [61, BASELINES[2] + 8], [520, BASELINES[2] + 8]);
  await expect(page.getByTestId("selection")).toHaveCount(0);
  await page.keyboard.press("Control+c");
  expect((await clipboard(page)).trim()).toBe(LINES[2]);
  await expect(objects(page)).toHaveCount(2);

  // Clicking an object ends the text selection.
  await page.mouse.move(h.x - 3, h.y);
  await page.mouse.click(h.x, h.y);
  expect(await selection(page)).toBe("");
});

test("drawing tools draw over the text instead of selecting it; image pages have no text layer", async ({ page }) => {
  await open(page);
  await page.getByTestId("tool-rect").click();
  await drag(page, 0, [61, BASELINES[0] + 8], [300, BASELINES[1]]);
  expect(await selection(page)).toBe("");
  await expect(objects(page)).toHaveCount(1);

  await page.goto(`/?open=${fixtureUrl("photo.jpg")}`);
  await waitForRenders(page);
  await expect(page.getByTestId("page")).toHaveCount(1);
  await expect(page.getByTestId("page-view").getByTestId("text-layer")).toHaveCount(0);
});
