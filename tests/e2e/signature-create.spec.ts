// M9 in browser mode: adding a photographed signature with the white background removed
// (switch and strength slider, previews made by the core through the dev server), and
// drawing a signature in black or blue (SPEC 6.8, D44).
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixturesDir } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

async function open(page: Page) {
  await page.goto(`/?open=${fixtureUrl("rotated.pdf")}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

/** RGBA of an image at a point given as fractions of its size. */
function pixel(img: Locator, fx: number, fy: number): Promise<number[]> {
  return img.evaluate(
    async (el, [x, y]) => {
      const im = el as HTMLImageElement;
      await im.decode();
      const c = document.createElement("canvas");
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(im, 0, 0);
      return [...ctx.getImageData(Math.round(x * (c.width - 1)), Math.round(y * (c.height - 1)), 1, 1).data];
    },
    [fx, fy] as const,
  );
}

const CORNER = [0.01, 0.03] as const;
const SHADOW = [0.99, 0.5] as const; // the photo's paper darkens toward the right edge

test("a photographed signature: white removal with strength, previewed and stored", async ({ page }) => {
  const w = watch(page);
  await open(page);
  await page.keyboard.press("KeyS");
  const dialog = page.getByTestId("signature-dialog");
  await expect(dialog).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await dialog.getByTestId("signature-add").click();
  await (await chooser).setFiles(join(fixturesDir, "signatures", "sig-white.jpg"));
  const panel = dialog.getByTestId("signature-import");
  await expect(panel).toHaveAttribute("data-ready", "true");
  const preview = panel.getByTestId("signature-import-preview");
  const remove = panel.getByTestId("signature-remove-white");
  const slider = panel.getByTestId("signature-strength");

  // A JPEG has no transparency: the switch starts on and the paper is gone.
  await expect(remove).toBeChecked();
  await expect(slider).toHaveValue("50");
  await expect.poll(async () => (await pixel(preview, ...CORNER))[3]).toBe(0);

  // Off: the image as it is.
  await remove.uncheck();
  await expect(slider).toBeDisabled();
  await expect.poll(async () => (await pixel(preview, ...CORNER))[3]).toBe(255);

  // On again; the slider decides how much of the shadow goes.
  await remove.check();
  await slider.fill("0");
  await expect.poll(async () => (await pixel(preview, ...SHADOW))[3]).toBeGreaterThan(60);
  await slider.fill("100");
  await expect.poll(async () => (await pixel(preview, ...SHADOW))[3]).toBe(0);
  await slider.fill("70");
  await expect(panel.getByTestId("signature-import-name")).toHaveValue("sig-white");
  await panel.getByTestId("signature-import-save").click();
  await expect(page.getByText('"sig-white" 서명을 추가했습니다.')).toBeVisible();

  // Stored transparent, with the ink kept.
  const row = dialog.getByTestId("signature-row");
  await expect(row).toHaveCount(1);
  const stored = row.getByTestId("signature-preview");
  expect((await pixel(stored, ...CORNER))[3]).toBe(0);
  expect((await pixel(stored, ...SHADOW))[3]).toBe(0);
  const size = await stored.evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight]);
  expect(size).toEqual([600, 200]);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

async function stroke(page: Page, pad: Locator, points: [number, number][]) {
  const box = (await pad.boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + fx * box.width, box.y + fy * box.height] as const;
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 6 });
  await page.mouse.up();
}

test("drawing a signature in blue; clear; saved cropped and transparent; placed on a page", async ({ page }) => {
  const w = watch(page);
  await open(page);
  await page.keyboard.press("KeyS");
  const dialog = page.getByTestId("signature-dialog");
  await dialog.getByTestId("signature-draw-open").click();
  const panel = dialog.getByTestId("signature-draw");
  const pad = panel.getByTestId("signature-pad");
  const save = panel.getByTestId("signature-draw-save");

  // Nothing drawn: nothing to save or clear.
  await expect(save).toBeDisabled();
  await expect(panel.getByTestId("signature-clear")).toBeDisabled();
  await stroke(page, pad, [[0.1, 0.5], [0.3, 0.2]]);
  await expect(save).toBeEnabled();
  await panel.getByTestId("signature-clear").click();
  await expect(save).toBeDisabled();

  await panel.getByTestId("signature-ink-blue").click();
  await expect(panel.getByTestId("signature-ink-blue")).toHaveAttribute("aria-pressed", "true");
  await stroke(page, pad, [[0.3, 0.6], [0.4, 0.3], [0.5, 0.7], [0.6, 0.35], [0.7, 0.6]]);
  await expect(panel.getByTestId("signature-draw-name")).toHaveValue("서명 1");
  const padBox = (await pad.boundingBox())!;
  await save.click();
  await expect(page.getByText('"서명 1" 서명을 추가했습니다.')).toBeVisible();

  // Stored cropped to the ink (smaller than the pad), transparent around it, blue ink.
  const stored = dialog.getByTestId("signature-row").getByTestId("signature-preview");
  const [sw, sh] = await stored.evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight]);
  expect(sw).toBeLessThan(padBox.width * 2 * 0.5);
  expect(sh).toBeLessThan(padBox.height * 2 * 0.6);
  expect((await pixel(stored, 0, 0))[3]).toBe(0);
  const ink = await stored.evaluate(async (el) => {
    const im = el as HTMLImageElement;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) return [d[i], d[i + 1], d[i + 2]];
    return null;
  });
  expect(ink).not.toBeNull();
  expect(ink![2]).toBeGreaterThan(ink![0] + 60); // blue

  // The drawn signature is placed like any other.
  await dialog.getByRole("button", { name: "닫기" }).last().click();
  await expect(dialog).toHaveCount(0);
  const at = await page.evaluate(() => window.__viewer!.clientPoint(0, 200, 300));
  await page.mouse.click(at.x, at.y);
  const objects = (await page.evaluate(() => window.__viewer!.model())).pages[0].objects;
  expect(objects.map((o) => o.type)).toEqual(["signature"]);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
