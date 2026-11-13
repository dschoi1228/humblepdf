// M1 smoke tests in browser mode (mock backend, Edge): adding files, zoom, navigation,
// passwords, unreadable files and the 300-page virtualization budget.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixturesDir, repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const outDir = join(repoRoot, "out", "m1");
mkdirSync(outDir, { recursive: true });

async function addViaDialog(page: Page, files: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("add-files").click();
  await (await chooser).setFiles(files.map((f) => join(fixturesDir, f)));
}

const pageTotal = (page: Page) => page.getByTestId("page-total");
const zoomPercent = async (page: Page) => Number((await page.getByTestId("zoom-level").innerText()).replace("%", ""));

test("adds PDFs and images in name order as one document", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await addViaDialog(page, ["rotated.pdf", "photo.jpg", "mixed_sizes.pdf", "alpha.png"]);
  await expect(pageTotal(page)).toHaveText("/ 11");
  const sources = await page.evaluate(() => window.__viewer!.pageSources());
  expect(sources).toEqual([
    "alpha.png",
    ...Array(4).fill("mixed_sizes.pdf"),
    "photo.jpg",
    ...Array(5).fill("rotated.pdf"),
  ]);
  await waitForRenders(page, 2);
  await waitForIdle(page);
  await expect(page.getByTestId("thumbnail").first()).toBeVisible();
  await page.screenshot({ path: join(outDir, "merged.png") });
  expect(w.external).toEqual([]);
  expect(w.failed).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("zoom buttons, fit modes and Ctrl+wheel stay within 25–400%", async ({ page }) => {
  const w = watch(page);
  await page.goto(`/?open=${fixtureUrl("mixed_sizes.pdf")}`);
  await waitForRenders(page);
  const view = page.getByTestId("page-view");
  const viewBox = (await view.boundingBox())!;

  // Default: fit width (widest page fills the view minus padding).
  const fitWidth = await zoomPercent(page);
  const widest = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll<HTMLElement>("[data-testid=page]")].map((e) => e.getBoundingClientRect().width)),
  );
  expect(Math.abs(widest - (viewBox.width - 48))).toBeLessThan(20); // scrollbar may take some width

  await page.getByTestId("zoom-in").click();
  expect(await zoomPercent(page)).toBeGreaterThan(fitWidth);
  for (let i = 0; i < 20; i++) if (await page.getByTestId("zoom-in").isEnabled()) await page.getByTestId("zoom-in").click();
  expect(await zoomPercent(page)).toBe(400);
  for (let i = 0; i < 25; i++) if (await page.getByTestId("zoom-out").isEnabled()) await page.getByTestId("zoom-out").click();
  expect(await zoomPercent(page)).toBe(25);

  await page.getByTestId("fit-page").click();
  await expect(page.getByTestId("fit-page")).toHaveAttribute("aria-pressed", "true");
  // The current page fits entirely in the view.
  const current = await page.evaluate(() => window.__viewer!.view().currentPage);
  const box = (await page.locator(`[data-testid=page][data-page-index="${current}"]`).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(viewBox.height);
  expect(box.width).toBeLessThanOrEqual(viewBox.width);

  // Ctrl+wheel zooms in around the cursor.
  const before = await zoomPercent(page);
  await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + 200);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  await waitForIdle(page);
  expect(w.consoleProblems).toEqual([]);
});

test("page number input and thumbnails navigate", async ({ page }) => {
  await page.goto(`/?open=${fixtureUrl("pages_300.pdf")}`);
  await waitForRenders(page);
  await expect(pageTotal(page)).toHaveText("/ 300");

  const input = page.getByTestId("page-input");
  await input.fill("150");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__viewer!.view().currentPage)).toBe(149);
  await expect(input).toHaveValue("150");
  await expect(page.locator('[data-testid=page][data-page-index="149"]')).toBeInViewport();

  // Out-of-range input is clamped.
  await input.fill("999");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__viewer!.view().currentPage)).toBe(299);

  // Clicking a thumbnail goes to that page.
  const thumb = page.getByTestId("thumbnail").first();
  const label = await thumb.innerText();
  await thumb.click();
  const n = Number.parseInt(label, 10);
  await expect.poll(() => page.evaluate(() => window.__viewer!.view().currentPage)).toBe(n - 1);
  await expect(page.getByTestId("thumbnail").filter({ hasText: label })).toHaveAttribute("aria-current", "page");
});

test("encrypted PDF asks for the password again when it is wrong", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");
  await addViaDialog(page, ["encrypted_aes256.pdf"]);
  const dialog = page.getByTestId("password-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("password-input").fill("not-it");
  await page.getByTestId("password-ok").click();
  await expect(page.getByTestId("password-wrong")).toBeVisible();
  await expect(page.getByTestId("password-input")).toHaveValue("");
  await page.getByTestId("password-input").fill("fixture-pass");
  await page.getByTestId("password-ok").click();
  await expect(dialog).toBeHidden();
  await expect(pageTotal(page)).toHaveText("/ 1");
  await waitForRenders(page);
  // pdf.js reports wrong passwords on the console; anything else is a problem.
  expect(w.consoleProblems.filter((m) => !/password/i.test(m))).toEqual([]);
});

test("an unreadable file shows an error and the others are still added", async ({ page }) => {
  await page.goto("/");
  await addViaDialog(page, ["broken.pdf", "photo.jpg"]);
  await expect(page.getByText('"broken.pdf" 파일을 추가하지 못했습니다.')).toBeVisible();
  await expect(pageTotal(page)).toHaveText("/ 1");
  await waitForRenders(page);
  // The app keeps working.
  await addViaDialog(page, ["rotated.pdf"]);
  await expect(pageTotal(page)).toHaveText("/ 6");
  await page.screenshot({ path: join(outDir, "unreadable.png") });
});

test("300 pages: only nearby pages are rendered and scrolling stays responsive", async ({ page }) => {
  const w = watch(page);
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
  await page.evaluate(() => {
    window.__viewer!.resetMax();
    (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
  });

  // Scroll through the whole document like a user flinging the wheel, then jump around.
  const steps = await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>("[data-testid=page-view]")!;
    let n = 0;
    while (el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
      el.scrollTop += 600;
      n++;
      await new Promise((r) => setTimeout(r, 16));
    }
    return n;
  });
  await waitForIdle(page);
  const result = await page.evaluate(() => ({
    maxRendered: window.__viewer!.maxRenderedMain(),
    renderedNow: window.__viewer!.renderedMain(),
    mounted: document.querySelectorAll("[data-testid=page]").length,
    stats: { ...window.__viewer!.stats },
    longTasks: (window as unknown as { __longTasks: number[] }).__longTasks,
    currentPage: window.__viewer!.view().currentPage,
  }));
  const maxLongTask = Math.max(0, ...result.longTasks);
  const report = { steps, ...result, longTaskCount: result.longTasks.length, maxLongTask };
  writeFileSync(join(outDir, "scroll_300.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, longTasks: undefined }));

  expect(result.currentPage).toBe(299);
  // Virtualization: never more than visible + overscan pages hold pixels.
  expect(result.mounted).toBeLessThanOrEqual(8);
  expect(result.maxRendered).toBeLessThanOrEqual(8);
  // Renders for pages scrolled past were cancelled rather than finished.
  expect(result.stats.cancelled).toBeGreaterThan(0);
  expect(result.stats.maxRunning).toBeLessThanOrEqual(2);
  expect(maxLongTask, "longest main-thread task while scrolling (ms)").toBeLessThan(100);
  expect(w.consoleProblems).toEqual([]);
  expect(w.external).toEqual([]);
});
