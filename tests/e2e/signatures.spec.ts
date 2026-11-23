// M4 in browser mode: the signature library (add, rename, delete; a placed signature cannot
// be deleted), placing on pages shown at 0 and 90 degrees, ratio-keeping resize, move,
// delete and Undo; the saved signature is page content, not an annotation.
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Point } from "../../src/bindings/Point";
import { fixturesDir } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const SIG = "/__fixtures/signatures/sig-demo.png";
type Sig = Extract<PageObject, { type: "signature" }>;

async function open(page: Page, files: string[], seed = true) {
  const sigs = seed ? `&signatures=${SIG}` : "";
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}${sigs}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

async function showPage(page: Page, index: number) {
  const input = page.getByTestId("page-input");
  await input.fill(String(index + 1));
  await input.press("Enter");
  await input.evaluate((el) => (el as HTMLElement).blur());
  await waitForIdle(page);
}

const model = (page: Page) => page.evaluate(() => window.__viewer!.model());
const signatures = async (page: Page, index: number) =>
  (await model(page)).pages[index].objects.filter((o): o is Sig => o.type === "signature");

async function client(page: Page, index: number, p: Point): Promise<Point> {
  return page.evaluate(([i, x, y]) => window.__viewer!.clientPoint(i, x, y), [index, p.x, p.y] as const);
}

async function click(page: Page, index: number, p: Point) {
  const a = await client(page, index, p);
  await page.mouse.click(a.x, a.y);
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Natural size of the demo signature image. */
async function sigSize(page: Page) {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, SIG);
}

/** Every signature preview image lies inside its box (portrait images included). */
async function expectPreviewsInside(page: Page, scope: ReturnType<Page["locator"]>) {
  const imgs = scope.getByTestId("signature-preview");
  const n = await imgs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    await expect(img).toBeVisible();
    const ib = (await img.boundingBox())!;
    const pb = (await img.locator("xpath=..").boundingBox())!;
    expect(ib.y + ib.height, "preview bottom").toBeLessThanOrEqual(pb.y + pb.height + 0.5);
    expect(ib.x + ib.width, "preview right").toBeLessThanOrEqual(pb.x + pb.width + 0.5);
    expect(ib.y).toBeGreaterThanOrEqual(pb.y - 0.5);
  }
}

const w = (s: Sig) => s.rect.x1 - s.rect.x0;
const h = (s: Sig) => s.rect.y1 - s.rect.y0;

test("library: add, rename and delete; a placed signature cannot be deleted", async ({ page }) => {
  const w_ = watch(page);
  await open(page, ["rotated.pdf"], false);

  // The signature tool with an empty library opens the library.
  await page.keyboard.press("KeyS");
  const dialog = page.getByTestId("signature-dialog");
  await expect(dialog).toBeVisible();
  const addFile = async (file: string) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("signature-add").click();
    await (await chooser).setFiles(file);
  };
  await addFile(join(fixturesDir, "signatures", "sig-demo.png"));
  await addFile(join(fixturesDir, "exif_rotate90.jpg"));
  const labels = dialog.getByTestId("signature-label");
  await expect(labels).toHaveText(["sig-demo", "exif_rotate90"]);
  // A wide and a portrait image: both previews fit their boxes.
  await expectPreviewsInside(page, dialog);

  // Rename the second one.
  await dialog.getByTestId("signature-row").nth(1).getByTestId("signature-rename").click();
  await dialog.getByTestId("signature-name").fill("테스트 서명");
  await dialog.getByTestId("signature-rename-save").click();
  await expect(labels).toHaveText(["sig-demo", "테스트 서명"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Place sig-demo (the last added one is chosen; pick the first).
  const choices = page.getByTestId("signature-choice");
  await expect(choices).toHaveCount(2);
  await expectPreviewsInside(page, page.getByTestId("edit-bar"));
  await choices.first().click();
  await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
  const sigDemoId = await choices.first().getAttribute("data-signature-id");
  const box = (await model(page)).pages[0].box;
  await click(page, 0, { x: box.x0 + 300, y: box.y0 + 400 });
  const placed = await signatures(page, 0);
  expect(placed).toHaveLength(1);
  await page.keyboard.press("Escape");
  expect(placed[0].signatureId).toBe(sigDemoId);

  // Deleting the placed one is refused; the other can go.
  await page.keyboard.press("KeyS");
  await page.getByTestId("manage-signatures").click();
  const rows = dialog.getByTestId("signature-row");
  await rows.first().getByTestId("signature-delete").click();
  await rows.first().getByTestId("signature-delete-confirm").click();
  await expect(page.getByText("문서에 배치된 서명은 지울 수 없습니다. 먼저 1쪽에서 이 서명을 지우세요.")).toBeVisible();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByTestId("signature-delete").click();
  await rows.nth(1).getByTestId("signature-delete-confirm").click();
  await expect(labels).toHaveText(["sig-demo"]);

  expect(w_.external).toEqual([]);
  expect(w_.consoleProblems).toEqual([]);
});

test("placing on pages shown at 0 and 90 degrees, resizing with the ratio kept, moving, deleting", async ({ page }) => {
  const w_ = watch(page);
  await open(page, ["rotated.pdf"]);
  const { w: iw, h: ih } = await sigSize(page);
  const tol = 1.5 / (await page.evaluate(() => window.__viewer!.view().scale));

  for (const index of [0, 1]) {
    await showPage(page, index);
    const p = (await model(page)).pages[index];
    const rotation = (p.baseRotation + p.userRotation) % 360;
    const at = { x: p.box.x0 + 300, y: p.box.y0 + 400 };
    await page.keyboard.press("KeyS");
    await click(page, index, at);
    const [s] = await signatures(page, index);
    expect(s.rotation).toBe(rotation);
    // 25% of the page width on screen; upright on screen, so the user-space box is
    // turned at 90 degrees.
    const sideways = rotation === 90 || rotation === 270;
    const screenW = sideways ? h(s) : w(s);
    const screenH = sideways ? w(s) : h(s);
    const pageScreenW = sideways ? p.box.y1 - p.box.y0 : p.box.x1 - p.box.x0;
    expect(screenW).toBeCloseTo(pageScreenW * 0.25, 6);
    expect(screenW / screenH).toBeCloseTo(iw / ih, 6);
    expect(Math.abs((s.rect.x0 + s.rect.x1) / 2 - at.x)).toBeLessThan(tol);
    // The tool stays, and the chosen signature follows the pointer as a preview (D31).
    expect(await page.evaluate(() => window.__viewer!.editor())).toEqual({ tool: "signature", selected: null });
    const ghost = page.locator(`[data-testid=page][data-page-index="${index}"] [data-testid=signature-ghost]`);
    await expect(ghost).toHaveCount(1);
    // The preview sits where a click would place it.
    const next = { x: p.box.x0 + 200, y: p.box.y0 + 200 };
    const c = await client(page, index, next);
    await page.mouse.move(c.x, c.y);
    const gb = (await ghost.locator("[data-object-type=signature] image").boundingBox())!;
    expect(Math.abs(gb.x + gb.width / 2 - c.x)).toBeLessThan(2);
    expect(Math.abs(gb.y + gb.height / 2 - c.y)).toBeLessThan(2);
    // A second click places a second one without picking the tool again.
    await page.mouse.click(c.x, c.y);
    expect(await signatures(page, index)).toHaveLength(2);
    await page.keyboard.press("Escape");
    expect((await page.evaluate(() => window.__viewer!.editor())).tool).toBe("select");
    await expect(ghost).toHaveCount(0);
  }

  // Corner resize on page 1: the opposite corner stays, the ratio is kept. One Undo step.
  await showPage(page, 0);
  const [before] = await signatures(page, 0);
  await page.locator(`[data-testid=object-layer] [data-testid=object][data-object-id="${before.id}"]`).first().waitFor();
  const box0 = (await model(page)).pages[0].box;
  await click(page, 0, { x: (before.rect.x0 + before.rect.x1) / 2, y: (before.rect.y0 + before.rect.y1) / 2 });
  const depth = await page.evaluate(() => window.__viewer!.undoDepth());
  const handle = page.locator('[data-testid=handle][data-handle="1,1"]');
  const hb = (await handle.boundingBox())!;
  const target = await client(page, 0, { x: before.rect.x1 + 100, y: before.rect.y1 + 10 });
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, target);
  const [resized] = await signatures(page, 0);
  expect(resized.rect.x0).toBeCloseTo(before.rect.x0, 6);
  expect(resized.rect.y0).toBeCloseTo(before.rect.y0, 6);
  expect(w(resized) / h(resized)).toBeCloseTo(w(before) / h(before), 6);
  expect(w(resized)).toBeGreaterThan(w(before) + 50);
  expect(await page.evaluate(() => window.__viewer!.undoDepth())).toBe(depth + 1);

  // Move far right: stays on the page.
  const c = await client(page, 0, { x: (resized.rect.x0 + resized.rect.x1) / 2, y: (resized.rect.y0 + resized.rect.y1) / 2 });
  const far = await client(page, 0, { x: box0.x1 + 500, y: (resized.rect.y0 + resized.rect.y1) / 2 });
  await drag(page, c, far);
  const [moved] = await signatures(page, 0);
  expect(moved.rect.x1).toBeCloseTo(box0.x1, 6);
  expect(w(moved)).toBeCloseTo(w(resized), 6);

  // Delete and Undo.
  // Delete the selected one (each page has two now) and Undo.
  await page.keyboard.press("Delete");
  expect((await signatures(page, 0)).map((x) => x.id)).not.toContain(moved.id);
  expect(await signatures(page, 0)).toHaveLength(1);
  await page.keyboard.press("Control+z");
  expect(await signatures(page, 0)).toHaveLength(2);

  expect(w_.external).toEqual([]);
  expect(w_.consoleProblems).toEqual([]);
});

test("a saved signature is page content, not an annotation", async ({ page }) => {
  const w_ = watch(page);
  await open(page, ["rotated.pdf"]);
  for (const index of [0, 2]) {
    await showPage(page, index);
    const b = (await model(page)).pages[index].box;
    await page.keyboard.press("KeyS");
    await click(page, index, { x: b.x0 + 300, y: b.y0 + 400 });
    await click(page, index, { x: b.x0 + 200, y: b.y0 + 150 });
    await page.keyboard.press("Escape");
  }
  page.once("dialog", (d) => void d.accept("/__out/m4/signatures.pdf"));
  await page.keyboard.press("Control+Shift+s");
  await expect(page.getByText('"signatures.pdf"에 저장했습니다.')).toBeVisible({ timeout: 30_000 });

  const annots = await page.evaluate(async () => {
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      openPdf(d: Uint8Array): Promise<{
        numPages: number;
        getPage(n: number): Promise<{ getAnnotations(): Promise<unknown[]> }>;
        loadingTask: { destroy(): Promise<void> };
      }>;
    };
    const pdf = await mod.openPdf(new Uint8Array(await (await fetch("/__out/m4/signatures.pdf")).arrayBuffer()));
    const out: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) out.push((await (await pdf.getPage(n)).getAnnotations()).length);
    await pdf.loadingTask.destroy();
    return out;
  });
  expect(annots.every((n) => n === 0), `annotations per page: ${annots}`).toBe(true);

  expect(w_.external).toEqual([]);
  expect(w_.consoleProblems).toEqual([]);
});
