// M6 in browser mode: a file saved by the app comes back with editable objects, drawn
// once; editing and saving again rewrites the annotations; a flattened export leaves no
// annotations and does not change the save state.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Point } from "../../src/bindings/Point";
import { repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

mkdirSync(join(repoRoot, "out", "m6"), { recursive: true });

async function open(page: Page, url: string) {
  await page.goto(`/?open=${url}`);
  await waitForRenders(page);
  await page.getByTestId("fit-page").click();
  await waitForIdle(page);
}

const model = (page: Page) => page.evaluate(() => window.__viewer!.model());
const objects = async (page: Page) => (await model(page)).pages[0].objects;

async function client(page: Page, p: Point): Promise<Point> {
  return page.evaluate(([x, y]) => window.__viewer!.clientPoint(0, x, y), [p.x, p.y] as const);
}

async function drag(page: Page, from: Point, to: Point) {
  const a = await client(page, from);
  const b = await client(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function saveTo(page: Page, path: string, button = "save-as") {
  page.once("dialog", (d) => void d.accept(path));
  await page.getByTestId(button).click();
  await expect(page.getByTestId("saving-dialog")).toHaveCount(0, { timeout: 30_000 });
}

async function annotations(page: Page, url: string) {
  return page.evaluate(async (u) => {
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      openPdf(d: Uint8Array): Promise<{
        getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string; rect: number[] }[]> }>;
        loadingTask: { destroy(): Promise<void> };
      }>;
    };
    const pdf = await mod.openPdf(new Uint8Array(await (await fetch(u)).arrayBuffer()));
    const list = await (await pdf.getPage(1)).getAnnotations();
    await pdf.loadingTask.destroy();
    return list.map((a) => ({ subtype: a.subtype, rect: Array.from(a.rect) }));
  }, url);
}

/** Share of pixels that differ clearly between two PNG screenshots of the same size. */
async function pixelDifference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (s: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")!.drawImage(img, 0, 0);
        return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
      };
      const [p, q] = [await load(x), await load(y)];
      if (p.width !== q.width || p.height !== q.height) return 1;
      let n = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
        if (d > 48) n++;
      }
      return n / (p.width * p.height);
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

async function shot(page: Page): Promise<Buffer> {
  await page.keyboard.press("Escape");
  await page.mouse.move(1, 1);
  await expect(page.getByTestId("selection")).toHaveCount(0);
  // Notifications may cover the page corner.
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("[data-sonner-toaster]").forEach((t) => (t.style.display = "none")));
  const png = await page.locator('[data-testid=page][data-page-index="0"]').screenshot();
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("[data-sonner-toaster]").forEach((t) => (t.style.display = "")));
  return png;
}

test("a saved file reopens with editable objects, drawn once; edits are saved; flattening", async ({ page }) => {
  const w = watch(page);
  await open(page, fixtureUrl("rotated.pdf"));
  const b = (await model(page)).pages[0].box;
  const P = (x: number, y: number) => ({ x: b.x0 + x, y: b.y0 + y });
  await page.keyboard.press("KeyH");
  await drag(page, P(100, 600), P(300, 625));
  await page.keyboard.press("KeyR");
  await drag(page, P(100, 400), P(250, 500));
  await page.keyboard.press("KeyT");
  const t = await client(page, P(100, 300));
  await page.mouse.click(t.x, t.y);
  await page.keyboard.type("다시 열기 テスト");
  await page.keyboard.press("Control+Enter");
  const made = await objects(page);
  expect(made.map((o) => o.type)).toEqual(["highlight", "rect", "text"]);
  const before = await shot(page);
  await saveTo(page, "/__out/m6/first.pdf");

  // Reopen in a fresh window.
  await open(page, "/__out/m6/first.pdf");
  await expect(page.getByText("이 앱으로 저장한 편집 가능한 객체 3개를 되살렸습니다.")).toBeVisible();
  const restored = await objects(page);
  const strip = (os: PageObject[]) => os.map((o) => ({ ...o, id: "" }));
  expect(strip(restored)).toEqual(strip(made));
  // Drawn once: the page looks as it did before saving.
  const after = await shot(page);
  writeFileSync(join(repoRoot, "out", "m6", "page_before_save.png"), before);
  writeFileSync(join(repoRoot, "out", "m6", "page_reopened.png"), after);
  expect(await pixelDifference(page, before, after)).toBeLessThan(0.002);

  // Edit: move the rectangle, delete the highlight, save again.
  const rect = restored.find((o) => o.type === "rect");
  if (rect?.type !== "rect") throw new Error("no rect");
  await drag(page, P(175, 450), P(225, 450));
  const hl = await client(page, P(200, 612));
  await page.mouse.click(hl.x, hl.y);
  await page.keyboard.press("Delete");
  expect((await objects(page)).map((o) => o.type)).toEqual(["rect", "text"]);
  await saveTo(page, "/__out/m6/second.pdf");
  const saved = await annotations(page, "/__out/m6/second.pdf");
  expect(saved.map((a) => a.subtype).sort()).toEqual(["FreeText", "Square"]);
  const square = saved.find((a) => a.subtype === "Square")!;
  expect(square.rect[0]).toBeGreaterThan(rect.rect.x0 + 40);

  // Flattened export: no annotations; the save state is unchanged.
  const savePath = await page.evaluate(() => window.__viewer!.savePath());
  await page.getByTestId("rotate-right").click();
  await saveTo(page, "/__out/m6/flat.pdf", "export-flattened");
  await expect(page.getByText('"flat.pdf"(으)로 평탄화하여 내보냈습니다.')).toBeVisible();
  expect(await annotations(page, "/__out/m6/flat.pdf")).toEqual([]);
  expect(await page.evaluate(() => window.__viewer!.savePath())).toBe(savePath);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);

  // The flattened file reopens with nothing to restore.
  await open(page, "/__out/m6/flat.pdf");
  expect(await objects(page)).toEqual([]);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
