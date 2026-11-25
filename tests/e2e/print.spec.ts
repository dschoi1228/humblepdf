// M10 in browser mode: printing builds a flattened PDF in memory through the real core and
// hands it to the PDF viewer, or renders the pages as images where there is no viewer
// (SPEC 6.11, D45). Headless browsers have no print dialog, so the dialog step is skipped
// (window.__printDryRun) and everything before it is checked.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SourceInfo } from "../../src/bindings/SourceInfo";
import { cli, fixturesDir, repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const printDir = join(repoRoot, "out", "e2e", "print");
const FILES = ["mixed_sizes.pdf", "rotated.pdf"];
const thumb = (page: Page, n: number) => page.getByTestId("thumbnail").filter({ hasText: new RegExp(`^${n}쪽$`) });
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The newest PDF the browser-mode backend built for printing. */
function lastPrintFile(): string {
  const files = readdirSync(printDir)
    .filter((f) => f.endsWith(".pdf"))
    .map((f) => join(printDir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

async function open(page: Page, mode?: "pdf" | "image") {
  await page.addInitScript((m) => {
    window.__printDryRun = true;
    if (m) window.__printMode = m;
  }, mode);
  await page.goto(`/?open=${FILES.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

async function drawRect(page: Page) {
  const [a, b] = await page.evaluate(() => [window.__viewer!.clientPoint(0, 60, 60), window.__viewer!.clientPoint(0, 150, 150)]);
  await page.getByTestId("tool-rect").click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

const jobs = (page: Page) => page.evaluate(() => window.__printJobs ?? []);

test("Ctrl+P prints the whole document, flattened, through the PDF viewer; nothing is saved", async ({ page }) => {
  const w = watch(page);
  rmSync(printDir, { recursive: true, force: true });
  const hashes = Object.fromEntries(FILES.map((f) => [f, sha256(join(fixturesDir, f))]));
  await open(page, "pdf");
  await drawRect(page);
  const pageCount = (await page.evaluate(() => window.__viewer!.model())).pages.length;

  await page.keyboard.press("Control+KeyP");
  await expect.poll(() => jobs(page), { timeout: 30_000 }).toHaveLength(1);
  const [job] = await jobs(page);
  expect(job.mode).toBe("pdf");
  expect(job.pages).toBe(pageCount);
  await expect(page.getByTestId("print-frame")).toHaveAttribute("src", /^blob:/);

  // The printed PDF is the flattened export: every page, the rectangle baked into page 1,
  // nothing left to restore as an editable object.
  const info = cli<SourceInfo>(["inspect", lastPrintFile()]);
  expect(info.pages).toHaveLength(pageCount);
  expect(info.pages.every((p) => p.objects.length === 0)).toBe(true);
  expect(info.pages.slice(0, 4).map((p) => Math.round(p.box.x1))).toEqual([595, 612, 595, 1191]);

  // Printing is not saving, and the sources are only read.
  expect(await page.evaluate(() => window.__viewer!.savePath())).toBeNull();
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);
  for (const f of FILES) expect(sha256(join(fixturesDir, f))).toBe(hashes[f]);

  // The toolbar button prints again (the old frame is replaced).
  await page.getByTestId("print").click();
  await expect.poll(() => jobs(page), { timeout: 30_000 }).toHaveLength(2);
  await expect(page.getByTestId("print-frame")).toHaveCount(1);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("printing selected pages as images: one sheet per page at its own size", async ({ page }) => {
  const w = watch(page);
  await open(page, "image");
  await thumb(page, 3).click();
  await thumb(page, 1).click({ modifiers: ["Control"] });
  await thumb(page, 1).click({ button: "right" });
  const item = page.getByTestId("print-pages");
  await expect(item).toHaveText("2쪽 인쇄…");
  await item.click();
  await expect.poll(() => jobs(page), { timeout: 60_000 }).toHaveLength(1);
  expect((await jobs(page))[0]).toMatchObject({ mode: "image", pages: 2 });
  await expect(page.getByText("이 PC에서는 PDF 뷰어를 쓸 수 없어")).toBeVisible();

  // Document order (page 1 then page 3), each sheet the page's size, images at 200 dpi.
  const sheets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#print-root-done .print-sheet")].map((s) => ({
      width: s.style.width,
      height: s.style.height,
      page: s.style.getPropertyValue("page"),
      image: s.querySelector("img")!.naturalWidth,
    })),
  );
  expect(sheets).toEqual([
    { width: "595.28pt", height: "841.89pt", page: "p595_28x841_89", image: Math.ceil((595.276 * 200) / 72) },
    { width: "595.28pt", height: "419.53pt", page: "p595_28x419_53", image: Math.ceil((595.276 * 200) / 72) },
  ]);
  const css = await page.evaluate(() => document.querySelector("#print-root-done style")!.textContent);
  expect(css).toContain("@page p595_28x841_89 { size: 595.28pt 841.89pt; margin: 0; }");
  expect(css).toContain("@page p595_28x419_53 { size: 595.28pt 419.53pt; margin: 0; }");

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
