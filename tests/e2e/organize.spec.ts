// M2 in browser mode: selecting, dragging, deleting, rotating pages, image fit, Undo/Redo,
// saving through the real core (dev-server /__export, D26) and the unsaved-changes guard.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { cli, FIXTURE_PASSWORD, fixturesDir, repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";
import type { Document } from "../../src/bindings/Document";
import type { SourceInfo } from "../../src/bindings/SourceInfo";

const outDir = join(repoRoot, "out", "m2");
mkdirSync(outDir, { recursive: true });

const thumb = (page: Page, n: number) =>
  page.getByTestId("thumbnail").filter({ hasText: new RegExp(`^${n}쪽$`) });
const labels = (page: Page) => page.evaluate(() => window.__viewer!.pageLabels());
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Drags thumbnail `from` and drops it just above thumbnail `to` (or below it with "after"). */
async function dragThumb(page: Page, from: number, to: number, where: "before" | "after" = "before") {
  const a = (await thumb(page, from).boundingBox())!;
  const b = (await thumb(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const y = where === "before" ? b.y + 6 : b.y + b.height - 6;
  await page.mouse.move(b.x + b.width / 2, y, { steps: 8 });
  await expect(page.getByTestId("drop-line")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("drop-line")).toHaveCount(0);
}

async function open(page: Page, files: string[]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  await waitForIdle(page);
}

const INITIAL = [
  "alpha.png#1",
  "mixed_sizes.pdf#1",
  "mixed_sizes.pdf#2",
  "mixed_sizes.pdf#3",
  "mixed_sizes.pdf#4",
  "rotated.pdf#1",
  "rotated.pdf#2",
  "rotated.pdf#3",
  "rotated.pdf#4",
  "rotated.pdf#5",
];

test("reorder, multi-select, delete, rotate, image fit, undo and redo", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf", "mixed_sizes.pdf", "alpha.png"]);
  expect(await labels(page)).toEqual(INITIAL);

  // 1. Drag one page: alpha (1) before page 4.
  await dragThumb(page, 1, 4);
  expect((await labels(page)).slice(0, 4)).toEqual(["mixed_sizes.pdf#1", "mixed_sizes.pdf#2", "alpha.png#1", "mixed_sizes.pdf#3"]);

  // Esc cancels a drag.
  const before = await labels(page);
  const a = (await thumb(page, 1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height * 2, { steps: 6 });
  await expect(page.getByTestId("drop-line")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await labels(page)).toEqual(before);

  // 2. Ctrl-select pages 1 and 3 and drag them together before page 5.
  await thumb(page, 1).click();
  await thumb(page, 3).click({ modifiers: ["Control"] });
  expect(await page.evaluate(() => window.__viewer!.selected())).toEqual(["1", "3"]);
  await dragThumb(page, 3, 5);
  expect((await labels(page)).slice(0, 5)).toEqual([
    "mixed_sizes.pdf#2",
    "mixed_sizes.pdf#3",
    "mixed_sizes.pdf#1",
    "alpha.png#1",
    "mixed_sizes.pdf#4",
  ]);

  // 3. Shift range 1..2 and Delete.
  await thumb(page, 1).click();
  await thumb(page, 2).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  expect(await labels(page)).toEqual([
    "mixed_sizes.pdf#1",
    "alpha.png#1",
    "mixed_sizes.pdf#4",
    "rotated.pdf#1",
    "rotated.pdf#2",
    "rotated.pdf#3",
    "rotated.pdf#4",
    "rotated.pdf#5",
  ]);
  await expect(page.getByTestId("page-total")).toHaveText("/ 8");

  // 4. Rotate page 1: Ctrl+] then the toolbar's left rotation twice → 270. The thumbnail
  // turns sideways.
  await thumb(page, 1).click();
  const box0 = (await thumb(page, 1).locator("span").first().boundingBox())!;
  await page.keyboard.press("Control+BracketRight");
  await page.getByTestId("rotate-left").click();
  await page.getByTestId("rotate-left").click();
  expect((await labels(page))[0]).toBe("mixed_sizes.pdf#1 r270");
  await expect
    .poll(async () => {
      const b = (await thumb(page, 1).locator("span").first().boundingBox())!;
      return Math.round((b.height / b.width) * 100) / 100;
    })
    .toBeCloseTo(Math.round((box0.width / box0.height) * 100) / 100, 1);

  // 5. Image fit from the toolbar, then back from the context menu.
  await thumb(page, 2).click();
  await page.getByTestId("fit-image").click();
  expect((await labels(page))[1]).toBe("alpha.png#1 image");
  await thumb(page, 2).click({ button: "right" });
  await page.getByTestId("page-menu").getByText("A4에 맞춤").click();
  expect((await labels(page))[1]).toBe("alpha.png#1");
  // The menu also rotates and deletes the right-clicked page.
  await thumb(page, 3).click({ button: "right" });
  await page.getByTestId("page-menu").getByText("오른쪽으로 회전").click();
  expect((await labels(page))[2]).toBe("mixed_sizes.pdf#4 r90");
  const final = await labels(page);
  await page.screenshot({ path: join(outDir, "organized.png") });

  // 6. Undo every step back to the first state (one more step removes the added files),
  // then redo everything.
  const steps = 2 + 1 + 3 + 2 + 1; // moves, delete, rotations, fits, menu rotation
  for (let i = 0; i < steps; i++) await page.keyboard.press("Control+z");
  expect(await labels(page)).toEqual(INITIAL);
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("undo")).toBeDisabled();
  for (let i = 0; i < steps; i++) await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+Shift+z");
  expect(await labels(page)).toEqual(final);
  await expect(page.getByTestId("redo")).toBeDisabled();

  expect(w.external).toEqual([]);
  expect(w.failed).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("dragging to the panel edge scrolls the 300-page list", async ({ page }) => {
  await open(page, ["pages_300.pdf"]);
  const panel = page.getByTestId("thumbnail-panel");
  const p = (await panel.boundingBox())!;
  const a = (await thumb(page, 1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2, p.y + p.height - 4, { steps: 10 });
  await expect.poll(() => panel.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(2000);
  const index = Number(await page.getByTestId("drop-line").getAttribute("data-index"));
  expect(index).toBeGreaterThan(10);
  await page.mouse.up();
  const l = await labels(page);
  expect(l[0]).toBe("pages_300.pdf#2");
  expect(l.indexOf("pages_300.pdf#1")).toBe(index - 1);
  expect(l.length).toBe(300);
});

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

test("saves the organized document; the output matches the model and sources are untouched", async ({ page }) => {
  const w = watch(page);
  const files = ["mixed_sizes.pdf", "encrypted_aes256.pdf", "photo.jpg"];
  const hashes = Object.fromEntries(files.map((f) => [f, sha256(join(fixturesDir, f))]));
  const out = join(outDir, "organized.pdf");
  rmSync(out, { force: true });

  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
  await page.getByTestId("password-input").fill(FIXTURE_PASSWORD);
  await page.getByTestId("password-ok").click();
  await waitForRenders(page);
  await waitForIdle(page);
  // encrypted_aes256 (1 page), mixed_sizes (4), photo (1)
  expect(await labels(page)).toHaveLength(6);

  await thumb(page, 2).click();
  await page.keyboard.press("Control+BracketLeft");
  await thumb(page, 4).click();
  await page.keyboard.press("Delete");
  await thumb(page, 5).click();
  await page.getByTestId("fit-image").click();
  await dragThumb(page, 5, 1);
  const model = await page.evaluate(() => window.__viewer!.model());
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);

  const asked = answerSavePrompts(page, ["/__out/m2/organized.pdf"]);
  await page.keyboard.press("Control+s");
  await expect(page.getByText('"organized.pdf"에 저장했습니다.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("원본에 걸려 있던 암호는 저장한 파일에 걸리지 않습니다.")).toBeVisible();
  // Default name: <source of the first page>_편집.pdf (the photo was moved first), outside
  // the fixtures folder in browser mode.
  expect(asked).toEqual(["/__out/saved/photo_편집.pdf"]);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(false);
  expect(existsSync(out)).toBe(true);

  // The output has the pages of the model: order (by size), rotation, boxes.
  const info = cli<SourceInfo>(["inspect", out]);
  expect(info.encrypted).toBe(false);
  expect(info.pages.length).toBe(model.pages.length);
  model.pages.forEach((p: Document["pages"][number], i: number) => {
    const o = info.pages[i];
    expect(o.baseRotation, `page ${i + 1}`).toBe((p.baseRotation + p.userRotation) % 360);
    expect(o.box.x1 - o.box.x0).toBeCloseTo(p.box.x1 - p.box.x0, 2);
    expect(o.box.y1 - o.box.y0).toBeCloseTo(p.box.y1 - p.box.y0, 2);
  });
  expect(model.pages[0].imageFit).toBe("image");

  // Ctrl+S again overwrites the same file without asking.
  await thumb(page, 1).click();
  await page.keyboard.press("Control+BracketRight");
  await page.keyboard.press("Control+s");
  await expect(page.getByText('"organized.pdf"에 저장했습니다.')).toHaveCount(2, { timeout: 30_000 });
  expect(asked.length).toBe(1);
  expect(cli<SourceInfo>(["inspect", out]).pages[0].baseRotation).toBe(90);

  for (const f of files) expect(sha256(join(fixturesDir, f)), f).toBe(hashes[f]);
  expect(w.external).toEqual([]);
  expect(w.failed.filter((f) => !f.includes("/__export"))).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("saving over a source file is refused and asks again", async ({ page }) => {
  const src = join(fixturesDir, "mixed_sizes.pdf");
  const hash = sha256(src);
  const out = join(outDir, "second.pdf");
  rmSync(out, { force: true });
  await open(page, ["mixed_sizes.pdf"]);
  const asked = answerSavePrompts(page, [fixtureUrl("mixed_sizes.pdf"), "/__out/m2/second"]);
  await page.getByTestId("save-as").click();
  await expect(page.getByText("열려 있는 원본 파일에는 저장할 수 없습니다. 다른 이름을 고르세요.")).toBeVisible();
  await expect(page.getByText('"second.pdf"에 저장했습니다.')).toBeVisible({ timeout: 30_000 });
  expect(asked.length).toBe(2);
  expect(existsSync(out)).toBe(true);
  expect(sha256(src)).toBe(hash);
  expect(await page.evaluate(() => window.__viewer!.savePath())).toBe("/__out/m2/second.pdf");
});

test("new document asks about unsaved changes", async ({ page }) => {
  await open(page, ["mixed_sizes.pdf"]);
  // Files opened into an empty document are not a change (D42): reopening them is the same.
  await page.keyboard.press("Control+n");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("unsaved-dialog")).toHaveCount(0);

  // An edit is a change: the document has never been saved.
  await open(page, ["mixed_sizes.pdf"]);
  await page.keyboard.press("Control+]");
  await page.keyboard.press("Control+n");
  await expect(page.getByTestId("unsaved-dialog")).toBeVisible();
  await page.getByTestId("unsaved-cancel").click();
  await expect(page.getByTestId("unsaved-dialog")).toHaveCount(0);
  expect(await labels(page)).toHaveLength(4);

  await page.getByTestId("new-document").click();
  await page.getByTestId("unsaved-discard").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("undo")).toBeDisabled();

  // An unchanged (empty or just saved) document is replaced without asking.
  await page.keyboard.press("Control+n");
  await expect(page.getByTestId("unsaved-dialog")).toHaveCount(0);
});

// D42: one file opened into an empty window is not a change (double-click, then close);
// several files at once are a merge, so closing asks to save.
test("one opened file is not a change; several opened at once are", async ({ page }) => {
  await page.goto(`/?open=${fixtureUrl("rotated.pdf")}`);
  await waitForRenders(page);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(false);

  await page.goto(`/?open=${["mixed_sizes.pdf", "rotated.pdf"].map(fixtureUrl).join(",")}`);
  await waitForRenders(page);
  expect(await page.evaluate(() => window.__viewer!.model().pages.length)).toBeGreaterThan(4);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);
});
