// M3 screen match on the live editor: objects drawn with the mouse on pages rotated
// 0/90/180/270 (and a page whose box has a negative origin) are compared with the saved PDF
// rendered by pdf.js. At 100% zoom the boxes of what each adds to the bare page must be
// within 1px (SPEC 9). Also checks that text under a highlight stays readable (SPEC 6.5).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Point } from "../../src/bindings/Point";
import { repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const TOLERANCE_PX = 1;
const outDir = join(repoRoot, "out", "m3", "match");
mkdirSync(outDir, { recursive: true });

type Box = { x0: number; y0: number; x1: number; y1: number };
type Match = { overlay: Box | null; exported: Box | null; dark?: { count: number; kept: number; keptExported: number }; images: { exported: string } };

/** Opens the files at 100% zoom, with the demo signature in the library (M4). */
async function openAt100(page: Page, files: string[]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}&signatures=/__fixtures/signatures/sig-demo.png`);
  await waitForRenders(page);
  const view = page.getByTestId("page-view");
  for (let i = 0; i < 20; i++) {
    const s = Number(await view.getAttribute("data-scale"));
    if (Math.abs(s - 1) < 1e-6) break;
    await page.getByTestId(s > 1 ? "zoom-out" : "zoom-in").click();
  }
  await expect(view).toHaveAttribute("data-scale", "1");
  await waitForIdle(page);
}

async function showPage(page: Page, index: number) {
  const input = page.getByTestId("page-input");
  await input.fill(String(index + 1));
  await input.press("Enter");
  await input.evaluate((el) => (el as HTMLElement).blur());
  await waitForIdle(page);
}

const pageEl = (page: Page, index: number) => page.locator(`[data-testid=page][data-page-index="${index}"]`);

async function client(page: Page, index: number, p: Point): Promise<Point> {
  return page.evaluate(([i, x, y]) => window.__viewer!.clientPoint(i, x, y), [index, p.x, p.y] as const);
}

async function drag(page: Page, index: number, from: Point, to: Point) {
  const a = await client(page, index, from);
  const b = await client(page, index, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

async function save(page: Page, path: string, name: string) {
  page.once("dialog", (d) => void d.accept(path));
  await page.keyboard.press("Control+Shift+s");
  await expect(page.getByText(`"${name}"에 저장했습니다.`)).toBeVisible({ timeout: 30_000 });
}

async function compare(
  page: Page,
  args: { sourceUrl: string; sourcePage: number; exportedUrl: string; exportedPage: number; overlayShot: Buffer; pageShot?: Buffer; darkRegion?: Box },
): Promise<Match> {
  const url = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  return page.evaluate(
    async (a) => {
      const modPath = "/src/devtools/editorMatch.ts";
      const mod = (await import(/* @vite-ignore */ modPath)) as { compareScreenshot: (x: unknown) => Promise<Match> };
      return mod.compareScreenshot(a);
    },
    { ...args, overlayShot: url(args.overlayShot), pageShot: args.pageShot && url(args.pageShot) },
  );
}

/**
 * Element screenshot without selection handles or hover state. `overlayOnly` hides the
 * page canvas so only the objects are drawn (on the page's white background).
 */
async function shoot(page: Page, index: number, overlayOnly: boolean): Promise<Buffer> {
  await page.keyboard.press("Escape");
  await page.mouse.move(1, 1);
  await expect(page.getByTestId("selection")).toHaveCount(0);
  const el = pageEl(page, index);
  const canvas = el.locator("canvas");
  await canvas.evaluate((c, hide) => ((c as HTMLElement).style.visibility = hide ? "hidden" : ""), overlayOnly);
  const shot = await el.screenshot();
  await canvas.evaluate((c) => ((c as HTMLElement).style.visibility = ""));
  return shot;
}

test("the editor overlay matches the saved PDF within 1px on rotated pages", async ({ page }) => {
  const w = watch(page);
  await openAt100(page, ["rotated.pdf", "cropbox.pdf"]);
  // rotated.pdf p1-p4 (/Rotate 0, 90, 180, 270) and cropbox.pdf p2 (negative box origin).
  // Files are added in name order, so look the pages up by source.
  const start = await page.evaluate(() => window.__viewer!.model());
  const sourceUrl = (sourceId: string) => start.sources.find((x) => x.id === sourceId)!.path;
  const wanted = (url: string, i: number) =>
    (url.endsWith("/rotated.pdf") && i < 4) || (url.endsWith("/cropbox.pdf") && i === 1);
  const targets = start.pages.flatMap((p, i) => (wanted(sourceUrl(p.sourceId), p.pageIndex) ? [i] : []));
  expect(targets).toHaveLength(5);
  const shots: Buffer[] = [];
  for (const index of targets) {
    await showPage(page, index);
    const box = (await page.evaluate(() => window.__viewer!.model())).pages[index].box;
    const P = (x: number, y: number) => ({ x: box.x0 + x, y: box.y0 + y });
    await page.keyboard.press("KeyH");
    await drag(page, index, P(60, 250), P(260, 275));
    await page.keyboard.press("KeyR");
    await drag(page, index, P(80, 150), P(230, 230));
    await page.getByTestId("stroke-width").selectOption("4");
    await page.getByTestId("stroke-width").evaluate((el) => (el as HTMLElement).blur());
    await page.keyboard.press("KeyO");
    await drag(page, index, P(250, 120), P(400, 220));
    await page.getByTestId("fill-green").click();
    await page.keyboard.press("KeyA");
    await drag(page, index, P(70, 60), P(330, 100));
    // A baked signature (M4), placed upright for the page's rotation.
    await page.keyboard.press("KeyS");
    const s = await client(page, index, P(420, 320));
    await page.mouse.click(s.x, s.y);
    await expect(page.locator(`[data-testid=page][data-page-index="${index}"] [data-object-type=signature]`)).toHaveCount(1);
    shots.push(await shoot(page, index, true));
  }
  await save(page, "/__out/m3/match/editor.pdf", "editor.pdf");

  const doc = await page.evaluate(() => window.__viewer!.model());
  const results = [];
  for (const [k, index] of targets.entries()) {
    const p = doc.pages[index];
    const r = await compare(page, {
      sourceUrl: sourceUrl(p.sourceId),
      sourcePage: p.pageIndex + 1,
      exportedUrl: "/__out/m3/match/editor.pdf",
      exportedPage: index + 1,
      overlayShot: shots[k],
    });
    writeFileSync(join(outDir, `p${index + 1}_editor.png`), shots[k]);
    writeFileSync(join(outDir, `p${index + 1}_exported.png`), Buffer.from(r.images.exported.split(",")[1], "base64"));
    expect(r.overlay, `p${index + 1}: overlay drew nothing`).not.toBeNull();
    expect(r.exported, `p${index + 1}: export drew nothing`).not.toBeNull();
    const diff = Math.max(...(["x0", "y0", "x1", "y1"] as const).map((key) => Math.abs(r.overlay![key] - r.exported![key])));
    results.push({ page: index + 1, source: `${sourceUrl(p.sourceId)}#${p.pageIndex + 1}`, rotation: (p.baseRotation + p.userRotation) % 360, overlay: r.overlay, exported: r.exported, diff });
  }
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  for (const r of results) expect(r.diff, `page ${r.page} (rotation ${r.rotation})`).toBeLessThanOrEqual(TOLERANCE_PX);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("text under a highlight stays dark on screen and in the saved PDF", async ({ page }) => {
  await openAt100(page, ["korean_embedded.pdf"]);
  const box = (await page.evaluate(() => window.__viewer!.model())).pages[0].box;
  // The first text line of the fixture.
  const from = { x: box.x0 + 48, y: box.y0 + 760 };
  const to = { x: box.x0 + 320, y: box.y0 + 786 };
  await page.keyboard.press("KeyH");
  await drag(page, 0, from, to);
  const pageShot = await shoot(page, 0, false);
  const overlayShot = await shoot(page, 0, true);
  await save(page, "/__out/m3/match/highlight.pdf", "highlight.pdf");

  const el = (await pageEl(page, 0).boundingBox())!;
  const a = await client(page, 0, from);
  const b = await client(page, 0, to);
  const region = {
    x0: Math.min(a.x, b.x) - el.x + 2,
    y0: Math.min(a.y, b.y) - el.y + 2,
    x1: Math.max(a.x, b.x) - el.x - 2,
    y1: Math.max(a.y, b.y) - el.y - 2,
  };
  const r = await compare(page, {
    sourceUrl: fixtureUrl("korean_embedded.pdf"),
    sourcePage: 1,
    exportedUrl: "/__out/m3/match/highlight.pdf",
    exportedPage: 1,
    overlayShot,
    pageShot,
    darkRegion: region,
  });
  writeFileSync(join(outDir, "highlight_editor.png"), pageShot);
  writeFileSync(join(outDir, "highlight_exported.png"), Buffer.from(r.images.exported.split(",")[1], "base64"));
  expect(r.dark!.count, "the region must contain text").toBeGreaterThan(200);
  expect(r.dark!.kept / r.dark!.count, "text pixels kept dark on screen").toBeGreaterThan(0.95);
  expect(r.dark!.keptExported / r.dark!.count, "text pixels kept dark in the saved PDF").toBeGreaterThan(0.95);
  const diff = Math.max(...(["x0", "y0", "x1", "y1"] as const).map((k) => Math.abs(r.overlay![k] - r.exported![k])));
  expect(diff).toBeLessThanOrEqual(TOLERANCE_PX);
});

test("text under a signature's transparent background stays visible on screen and in the saved PDF", async ({ page }) => {
  await openAt100(page, ["korean_embedded.pdf"]);
  const box = (await page.evaluate(() => window.__viewer!.model())).pages[0].box;
  // Centered on the first text line of the fixture.
  await page.keyboard.press("KeyS");
  const at = await client(page, 0, { x: box.x0 + 180, y: box.y0 + 773 });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("[data-object-type=signature]").first()).toBeVisible();
  const sig = (await page.evaluate(() => window.__viewer!.model())).pages[0].objects[0];
  if (sig.type !== "signature") throw new Error("no signature");
  const pageShot = await shoot(page, 0, false);
  const overlayShot = await shoot(page, 0, true);
  await save(page, "/__out/m3/match/signature.pdf", "signature.pdf");

  const el = (await pageEl(page, 0).boundingBox())!;
  const a = await client(page, 0, { x: sig.rect.x0, y: sig.rect.y1 });
  const b = await client(page, 0, { x: sig.rect.x1, y: sig.rect.y0 });
  const region = { x0: a.x - el.x + 2, y0: a.y - el.y + 2, x1: b.x - el.x - 2, y1: b.y - el.y - 2 };
  const r = await compare(page, {
    sourceUrl: fixtureUrl("korean_embedded.pdf"),
    sourcePage: 1,
    exportedUrl: "/__out/m3/match/signature.pdf",
    exportedPage: 1,
    overlayShot,
    pageShot,
    darkRegion: region,
  });
  writeFileSync(join(outDir, "signature_editor.png"), pageShot);
  writeFileSync(join(outDir, "signature_exported.png"), Buffer.from(r.images.exported.split(",")[1], "base64"));
  expect(r.dark!.count, "the region must contain text").toBeGreaterThan(200);
  expect(r.dark!.kept / r.dark!.count, "text pixels visible on screen").toBeGreaterThan(0.95);
  expect(r.dark!.keptExported / r.dark!.count, "text pixels visible in the saved PDF").toBeGreaterThan(0.95);
  const diff = Math.max(...(["x0", "y0", "x1", "y1"] as const).map((k) => Math.abs(r.overlay![k] - r.exported![k])));
  expect(diff).toBeLessThanOrEqual(TOLERANCE_PX);
});
