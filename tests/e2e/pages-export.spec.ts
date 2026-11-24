// M8 in browser mode: "Export pages" writes the selected pages, in document order, through the
// real core (dev-server /__export), and is not a save (SPEC 6.3, D43).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SourceInfo } from "../../src/bindings/SourceInfo";
import { cli, fixturesDir, repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const outDir = join(repoRoot, "out", "m8");
mkdirSync(outDir, { recursive: true });

const FILES = ["mixed_sizes.pdf", "rotated.pdf"];
const thumb = (page: Page, n: number) =>
  page.getByTestId("thumbnail").filter({ hasText: new RegExp(`^${n}쪽$`) });
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function open(page: Page) {
  await page.goto(`/?open=${FILES.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

/** Answers the browser-mode save "dialog" (window.prompt) with the given paths in turn. */
function answerSavePrompts(page: Page, answers: string[]) {
  const asked: string[] = [];
  page.on("dialog", async (d) => {
    asked.push(d.defaultValue());
    const next = answers.shift();
    if (next === undefined) await d.dismiss();
    else await d.accept(next);
  });
  return asked;
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

test("exports the selected pages in document order; not a save; sources untouched", async ({ page }) => {
  const w = watch(page);
  const hashes = Object.fromEntries(FILES.map((f) => [f, sha256(join(fixturesDir, f))]));
  const out = join(outDir, "pages.pdf");
  rmSync(out, { force: true });

  await open(page);
  await drawRect(page);
  await thumb(page, 3).click();
  await page.keyboard.press("Control+BracketRight");
  // Selected in reverse order: the output still follows the document.
  await thumb(page, 3).click();
  await thumb(page, 1).click({ modifiers: ["Control"] });
  const model = await page.evaluate(() => window.__viewer!.model());
  expect(model.pages[0].objects).toHaveLength(1);
  expect(model.pages[2].userRotation).toBe(90);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);

  const asked = answerSavePrompts(page, ["/__out/m8/pages.pdf"]);
  await thumb(page, 1).click({ button: "right" });
  const item = page.getByTestId("export-pages");
  await expect(item).toHaveText("2쪽 내보내기…");
  await item.click();
  await expect(page.getByText('"pages.pdf"(으)로 내보냈습니다.')).toBeVisible({ timeout: 30_000 });
  // Default name: <source of the first exported page>_발췌.pdf (outside the fixtures in browser mode).
  expect(asked).toEqual(["/__out/saved/mixed_sizes_발췌.pdf"]);

  // Not a save: the Ctrl+S target and the unsaved state stay as they were.
  expect(await page.evaluate(() => window.__viewer!.savePath())).toBeNull();
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);

  // The output has pages 1 and 3: boxes, rotation and the rectangle.
  expect(existsSync(out)).toBe(true);
  const info = cli<SourceInfo>(["inspect", out]);
  expect(info.pages).toHaveLength(2);
  const [p1, p3] = [model.pages[0], model.pages[2]];
  expect(info.pages[0].box).toEqual(p1.box);
  expect(info.pages[1].box).toEqual(p3.box);
  expect(info.pages[0].baseRotation).toBe((p1.baseRotation + p1.userRotation) % 360);
  expect(info.pages[1].baseRotation).toBe((p3.baseRotation + p3.userRotation) % 360);
  expect(info.pages[0].objects.map((o) => o.type)).toEqual(["rect"]);
  expect(info.pages[1].objects).toEqual([]);

  for (const f of FILES) expect(sha256(join(fixturesDir, f))).toBe(hashes[f]);
  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("without a selection the current page is exported; a source path is refused", async ({ page }) => {
  const out = join(outDir, "current.pdf");
  rmSync(out, { force: true });
  await open(page);
  await page.getByTestId("page-input").fill("5");
  await page.getByTestId("page-input").press("Enter");
  await expect.poll(() => page.evaluate(() => window.__viewer!.view().currentPage)).toBe(4);
  expect(await page.evaluate(() => window.__viewer!.selected())).toEqual([]);

  const asked = answerSavePrompts(page, [fixtureUrl("rotated.pdf"), "/__out/m8/current"]);
  await page.evaluate(async () => {
    const modPath = "/src/app/save.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as { exportPages(): Promise<boolean> };
    await mod.exportPages();
  });
  await expect(page.getByText("열려 있는 원본 파일에는 저장할 수 없습니다. 다른 이름을 고르세요.")).toBeVisible();
  await expect(page.getByText('"current.pdf"(으)로 내보냈습니다.')).toBeVisible({ timeout: 30_000 });
  expect(asked).toEqual(["/__out/saved/rotated_발췌.pdf", "/__out/saved/rotated_발췌.pdf"]);
  expect(cli<SourceInfo>(["inspect", out]).pages).toHaveLength(1);
});
