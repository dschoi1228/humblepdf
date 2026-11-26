// M14: finding page text (SPEC 6.2, D49). text_select.pdf has three 24 pt lines (Latin,
// Korean, Japanese) at baselines 760, 710 and 660 starting at x = 60; page 2 is the same
// page with /Rotate 90. pages_300.pdf says "Page N of 300" on page N.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const BASELINES = [760, 710, 660];

async function open(page: Page, files = ["text_select.pdf"]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

const count = (page: Page) => page.getByTestId("find-count");
const view = (page: Page) => page.getByTestId("page-view");
const current = (page: Page) => view(page).getByTestId("search-hit-current");

/** Opens the find bar with Ctrl+F (focus on the page view first) and types the query. */
async function find(page: Page, query: string) {
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("find-input")).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(query);
}

/** User-space box of a match box on page `index` (y up). */
async function userBox(page: Page, index: number, el: Locator) {
  const r = (await el.boundingBox())!;
  return page.evaluate(
    ([i, x0, y0, x1, y1]) => {
      const a = window.__viewer!.userPoint(i, x0, y0);
      const b = window.__viewer!.userPoint(i, x1, y1);
      return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
    },
    [index, r.x, r.y, r.x + r.width, r.y + r.height] as const,
  );
}

/** A box over the start of the line at `baseline`, one font size tall. */
function expectAtLineStart(b: { x0: number; x1: number; y0: number; y1: number }, baseline: number) {
  expect(Math.abs(b.x0 - 60)).toBeLessThan(1.5);
  expect(Math.abs(b.y1 - b.y0 - 24)).toBeLessThan(1.5);
  expect(b.y0).toBeLessThan(baseline);
  expect(b.y0).toBeGreaterThan(baseline - 10);
}

/** The box lies inside the page view. */
async function expectInView(page: Page, el: Locator) {
  const r = (await el.boundingBox())!;
  const v = (await view(page).boundingBox())!;
  expect(r.y).toBeGreaterThanOrEqual(v.y);
  expect(r.y + r.height).toBeLessThanOrEqual(v.y + v.height);
  expect(r.x).toBeGreaterThanOrEqual(v.x);
  expect(r.x + r.width).toBeLessThanOrEqual(v.x + v.width);
}

test("Ctrl+F finds text on every page, moves between matches and closes with Esc", async ({ page }) => {
  const w = watch(page);
  await open(page);
  const undoDepth = await page.evaluate(() => window.__viewer!.undoDepth());
  await view(page).click({ position: { x: 5, y: 5 } });
  await find(page, "select");
  await expect(count(page)).toHaveText("1/2");
  // The current match sits on "Select" of page 1.
  await expect(current(page)).toHaveCount(1);
  expectAtLineStart(await userBox(page, 0, current(page)), BASELINES[0]);
  const width = (await userBox(page, 0, current(page))).x1 - 60;

  // Enter: page 2 (/Rotate 90), the same place in user space, in view.
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("2/2");
  await expect.poll(async () => (await page.locator('[data-page-index="1"] [data-testid=search-hit-current]').count())).toBe(1);
  const onTwo = page.locator('[data-page-index="1"] [data-testid=search-hit-current]');
  const b2 = await userBox(page, 1, onTwo);
  expectAtLineStart(b2, BASELINES[0]);
  expect(Math.abs(b2.x1 - 60 - width)).toBeLessThan(1);
  await expectInView(page, onTwo);
  // Past the end: back to the first. Shift+Enter goes back.
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("1/2");
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText("2/2");

  // Korean, Japanese, a phrase across a line end, full-width letters, nothing.
  for (const [q, n] of [["본문을", 2], ["日本語の", 2], ["humblepdf 0.3 한글", 2], ["ＳＥＬＥＣＴ　ＭＥ", 2], ["없는 말", 0]] as const) {
    await page.getByTestId("find-input").fill(q);
    await expect(count(page), q).toHaveText(n ? `1/${n}` : "결과 없음");
  }
  // Matches are not drawn in the thumbnails.
  await page.getByTestId("find-input").fill("select");
  await expect(count(page)).toHaveText("1/2");
  await expect(page.getByTestId("thumbnail").locator("[data-testid^=search-hit]")).toHaveCount(0);

  // Esc closes the bar and clears the marks; searching changed nothing.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("find-bar")).toHaveCount(0);
  await expect(view(page).locator("[data-testid^=search-hit]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(false);
  expect(await page.evaluate(() => window.__viewer!.undoDepth())).toBe(undoDepth);
  expect(w.consoleProblems).toEqual([]);
  expect(w.external).toEqual([]);
});

test("selected text fills the query; F3 and the buttons move; the toolbar button opens the bar", async ({ page }) => {
  await open(page);
  // Select the Korean line with the select tool, then Ctrl+F.
  const a = await page.evaluate(([y]) => window.__viewer!.clientPoint(0, 61, y), [BASELINES[1] + 8] as const);
  const b = await page.evaluate(([y]) => window.__viewer!.clientPoint(0, 520, y), [BASELINES[1] + 8] as const);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("find-input")).toHaveValue("한글 본문을 복사합니다");
  await expect(count(page)).toHaveText("1/2");

  await page.getByTestId("find-next").click();
  await expect(count(page)).toHaveText("2/2");
  await page.getByTestId("find-previous").click();
  await expect(count(page)).toHaveText("1/2");
  await page.getByTestId("find-close").click();
  await expect(page.getByTestId("find-bar")).toHaveCount(0);

  // F3 with the bar closed opens it with the last query; F3 again moves on.
  await view(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("F3");
  await expect(page.getByTestId("find-input")).toHaveValue("한글 본문을 복사합니다");
  await expect(count(page)).toHaveText("1/2");
  await view(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("F3");
  await expect(count(page)).toHaveText("2/2");
  await page.keyboard.press("Shift+F3");
  await expect(count(page)).toHaveText("1/2");
  // Esc outside the field closes it too (after nothing else is left to cancel).
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("find-bar")).toHaveCount(0);

  await page.getByTestId("open-find").click();
  await expect(page.getByTestId("find-input")).toBeFocused();
});

test("match boxes follow zoom and rotation", async ({ page }) => {
  await open(page);
  await view(page).click({ position: { x: 5, y: 5 } });
  await find(page, "テキスト");
  await expect(count(page)).toHaveText("1/2");
  const ref = await userBox(page, 0, current(page));
  expect(ref.y0).toBeLessThan(BASELINES[2]);
  expect(ref.y1).toBeGreaterThan(BASELINES[2] + 12);

  await page.getByTestId("zoom-in").click();
  await page.getByTestId("zoom-in").click();
  await waitForIdle(page);
  await expect.poll(async () => {
    const z = await userBox(page, 0, current(page));
    return Math.max(...(["x0", "x1", "y0", "y1"] as const).map((k) => Math.abs(z[k] - ref[k])));
  }).toBeLessThan(1);

  // Page 2 turned once more by the user (180 in all): the match is in the same user-space place.
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
  await page.getByTestId("thumbnail").nth(1).click();
  await page.keyboard.press("Control+BracketRight");
  await waitForIdle(page);
  await page.getByTestId("find-input").focus();
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("2/2");
  const onTwo = page.locator('[data-page-index="1"] [data-testid=search-hit-current]');
  await expect.poll(async () => {
    if (!(await onTwo.count())) return 99;
    const z = await userBox(page, 1, onTwo);
    return Math.max(...(["x0", "x1", "y0", "y1"] as const).map((k) => Math.abs(z[k] - ref[k])));
  }).toBeLessThan(1);
  await expectInView(page, onTwo);
});

test("pages deleted, restored or mixed with images: matches follow the document", async ({ page }) => {
  await open(page, ["text_select.pdf", "photo.jpg"]);
  await expect(page.getByTestId("thumbnail")).toHaveCount(3);
  await view(page).click({ position: { x: 5, y: 5 } });
  await find(page, "select");
  await expect(count(page)).toHaveText("1/2");
  // Delete page 1 of text_select.pdf (files are added in name order): one match left. Undo:
  // two again.
  const labels = await page.evaluate(() => window.__viewer!.pageLabels());
  await page.getByTestId("thumbnail").nth(labels.indexOf("text_select.pdf#1")).click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("thumbnail")).toHaveCount(2);
  await expect(count(page)).toHaveText("1/1");
  await page.keyboard.press("Control+z");
  await expect(count(page)).toHaveText(/^[12]\/2$/);
});

test("a far page of 300 is found and shown without blocking the page", async ({ page }) => {
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`/?open=${fixtureUrl("pages_300.pdf")}`);
  await waitForRenders(page);
  await waitForIdle(page);
  await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks.length = 0));
  await view(page).click({ position: { x: 5, y: 5 } });
  await find(page, "page 250 of");
  await expect(count(page)).toHaveText("1/1", { timeout: 30_000 });
  await expect(page.locator('[data-page-index="249"] [data-testid=search-hit-current]')).toHaveCount(1, { timeout: 15_000 });
  await expectInView(page, page.locator('[data-page-index="249"] [data-testid=search-hit-current]'));
  // Every page holds the word: 300 matches, counted while the bar stays usable.
  await page.getByTestId("find-input").fill("of 300");
  await expect(count(page)).toHaveText(/\/300$/, { timeout: 30_000 });
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(Math.max(0, ...longTasks), "longest main-thread task while searching (ms)").toBeLessThan(200);
});

/**
 * The box's edges fall in the gaps between glyphs: on the rendered canvas no run of inked
 * columns (part of a glyph) crosses them, and the box holds ink.
 */
async function expectBoxOnGlyphs(page: Page, index: number, el: Locator) {
  const r = (await el.boundingBox())!;
  const result = await page.evaluate(
    ([i, x, y, w, h]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid=page][data-page-index="${i}"] canvas`)!;
      const c = canvas.getBoundingClientRect();
      const k = canvas.width / c.width;
      // Columns from one box width before to one after, rows of the box.
      const cx0 = Math.max(0, Math.floor((x - w - c.left) * k));
      const cx1 = Math.min(canvas.width, Math.ceil((x + 2 * w - c.left) * k));
      const cy0 = Math.floor((y - c.top) * k);
      const cy1 = Math.ceil((y + h - c.top) * k);
      const data = canvas.getContext("2d")!.getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0);
      const ink: boolean[] = [];
      for (let col = 0; col < data.width; col++) {
        let dark = false;
        for (let row = 0; row < data.height && !dark; row++) {
          const p = (row * data.width + col) * 4;
          dark = data.data[p] + data.data[p + 1] + data.data[p + 2] < 3 * 140;
        }
        ink.push(dark);
      }
      // Runs of inked columns, in client px.
      const runs: [number, number][] = [];
      ink.forEach((d, col) => {
        const at = c.left + (cx0 + col) / k;
        if (d && (col === 0 || !ink[col - 1])) runs.push([at, at + 1 / k]);
        else if (d) runs[runs.length - 1][1] = at + 1 / k;
      });
      return runs;
    },
    [index, r.x, r.y, r.width, r.height] as const,
  );
  const tol = 1;
  const inside = result.filter(([a, b]) => b > r.x + tol && a < r.x + r.width - tol);
  expect(inside.length, "ink in the box").toBeGreaterThan(0);
  for (const [a, b] of inside) {
    expect(a, "a glyph crosses the box's left edge").toBeGreaterThanOrEqual(r.x - tol);
    expect(b, "a glyph crosses the box's right edge").toBeLessThanOrEqual(r.x + r.width + tol);
  }
}

test("match boxes sit on the glyphs inside a line, also after Hangul in another font", async ({ page }) => {
  // korean_embedded.pdf: "가나다라마바사 0123456789" in an embedded Korean font whose digits
  // are much wider than the browser's fallback font (D49). At 300%.
  await page.goto(`/?open=${fixtureUrl("korean_embedded.pdf")}`);
  await waitForRenders(page);
  for (let i = 0; i < 8 && Number(await view(page).getAttribute("data-scale")) < 3; i++) await page.getByTestId("zoom-in").click();
  await waitForIdle(page);
  await view(page).click({ position: { x: 5, y: 5 } });
  for (const q of ["0", "5", "345", "바사"]) {
    await find(page, q);
    await expect(count(page), q).toHaveText("1/1");
    await expect(current(page)).toHaveCount(1);
    await expectInView(page, current(page));
    await expectBoxOnGlyphs(page, 0, current(page));
  }
  // A word inside a Latin line (text_select.pdf, Helvetica).
  await page.keyboard.press("Escape");
  await open(page);
  await view(page).click({ position: { x: 5, y: 5 } });
  await find(page, "blePD");
  await expect(count(page)).toHaveText("1/2");
  await expectBoxOnGlyphs(page, 0, current(page));
});

test("fit-page fits every page whole when upright and sideways pages are mixed", async ({ page }) => {
  await open(page);
  const v = (await view(page).boundingBox())!;
  for (const i of [0, 1]) {
    const r = (await page.locator(`[data-testid=page][data-page-index="${i}"]`).boundingBox())!;
    expect(r.height, `page ${i + 1}`).toBeLessThanOrEqual(v.height);
    expect(r.width, `page ${i + 1}`).toBeLessThanOrEqual(v.width);
  }
});
