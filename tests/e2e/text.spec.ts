// M5 in browser mode: typing text (Korean, English, Japanese) on pages shown at 0 and 90
// degrees, line breaks, commit and cancel, editing again, properties, moving, deleting,
// composition keys left to the input method, and saving as FreeText annotations.
import { expect, test, type Page } from "@playwright/test";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Point } from "../../src/bindings/Point";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

type Text = Extract<PageObject, { type: "text" }>;
const ASCENT = 1949 / 2048;
const RED = [0.898, 0.224, 0.208];

async function open(page: Page, files: string[]) {
  await page.goto(`/?open=${files.map(fixtureUrl).join(",")}`);
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
const texts = async (page: Page, index: number) =>
  (await model(page)).pages[index].objects.filter((o): o is Text => o.type === "text");
const editor = (page: Page) => page.evaluate(() => window.__viewer!.editor());
const undoDepth = (page: Page) => page.evaluate(() => window.__viewer!.undoDepth());

async function client(page: Page, index: number, p: Point): Promise<Point> {
  return page.evaluate(([i, x, y]) => window.__viewer!.clientPoint(i, x, y), [index, p.x, p.y] as const);
}

async function click(page: Page, index: number, p: Point, count = 1) {
  const a = await client(page, index, p);
  await page.mouse.click(a.x, a.y, { clickCount: count });
}

const box = (page: Page) => page.getByTestId("text-editor");

test("typing text on pages shown at 0 and 90 degrees", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  for (const index of [0, 1]) {
    await showPage(page, index);
    const p = (await model(page)).pages[index];
    const rotation = (p.baseRotation + p.userRotation) % 360;
    const at = { x: p.box.x0 + 150, y: p.box.y0 + 400 };
    await page.keyboard.press("KeyT");
    await click(page, index, at);
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("한글 English 日本語");
    await page.keyboard.press("Enter");
    await page.keyboard.type("カタカナ 漢字 123");
    await page.keyboard.press("Control+Enter");
    await expect(box(page)).toHaveCount(0);

    const [t] = await texts(page, index);
    expect(t.lines).toEqual(["한글 English 日本語", "カタカナ 漢字 123"]);
    expect(t.rotation).toBe(rotation);
    expect(t.fontSize).toBe(12);
    // The click marks the top of the first line: the baseline is one ascent lower on screen.
    const s = await client(page, index, t.origin);
    const c = await client(page, index, at);
    const scale = (await page.evaluate(() => window.__viewer!.view().scale));
    expect(Math.abs(s.x - c.x)).toBeLessThan(1);
    expect(s.y - c.y).toBeCloseTo(ASCENT * 12 * scale, 0);
    expect(await editor(page)).toEqual({ tool: "select", selected: { pageId: p.id, objectId: t.id } });
  }
  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("cancel, commit by clicking outside, edit again, properties, move, delete, Undo", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  await showPage(page, 0);
  const b = (await model(page)).pages[0].box;
  const P = (x: number, y: number) => ({ x: b.x0 + x, y: b.y0 + y });
  const base = await undoDepth(page);

  // Esc cancels: nothing is made.
  await page.keyboard.press("KeyT");
  await click(page, 0, P(150, 500));
  await page.keyboard.type("취소할 글");
  await page.keyboard.press("Escape");
  await expect(box(page)).toHaveCount(0);
  expect(await texts(page, 0)).toEqual([]);
  expect(await undoDepth(page)).toBe(base);
  // An empty box makes nothing either.
  await click(page, 0, P(150, 500));
  await click(page, 0, P(400, 200));
  expect(await texts(page, 0)).toEqual([]);

  // A click outside commits.
  await page.keyboard.press("KeyT");
  await click(page, 0, P(150, 500));
  await page.keyboard.type("첫 줄");
  await click(page, 0, P(400, 200));
  expect((await texts(page, 0)).map((t) => t.lines)).toEqual([["첫 줄"]]);
  expect(await undoDepth(page)).toBe(base + 1);

  // Double-click edits again: one more step.
  const [t] = await texts(page, 0);
  const mid = { x: t.origin.x + 10, y: t.origin.y + 3 };
  await click(page, 0, mid, 2);
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue("첫 줄");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째 줄");
  await page.keyboard.press("Control+Enter");
  const [edited] = await texts(page, 0);
  expect(edited.id).toBe(t.id);
  expect(edited.lines).toEqual(["첫 줄", "둘째 줄"]);
  expect(await undoDepth(page)).toBe(base + 2);

  // Properties of the selected text.
  await page.getByTestId("font-size").selectOption("24");
  await page.getByTestId("font-size").evaluate((el) => (el as HTMLElement).blur());
  await page.getByTestId("color-red").click();
  expect((await texts(page, 0))[0]).toMatchObject({ fontSize: 24, color: RED });
  expect(await undoDepth(page)).toBe(base + 4);

  // Move with the keyboard, then delete and Undo.
  await page.keyboard.press("Shift+ArrowRight");
  expect((await texts(page, 0))[0].origin.x).toBeCloseTo(t.origin.x + 10, 6);
  await page.keyboard.press("Delete");
  expect(await texts(page, 0)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await texts(page, 0)).toHaveLength(1);

  // Emptying a text while editing deletes it.
  const [again] = await texts(page, 0);
  await click(page, 0, { x: again.origin.x + 20, y: again.origin.y + 5 }, 2);
  await expect(box(page)).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+Enter");
  expect(await texts(page, 0)).toEqual([]);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("text typed near the page edge is kept on the page", async ({ page }) => {
  await open(page, ["rotated.pdf"]);
  for (const index of [0, 2]) {
    await showPage(page, index);
    const p = (await model(page)).pages[index];
    const el = page.locator(`[data-testid=page][data-page-index="${index}"]`);
    const pb = (await el.boundingBox())!;
    // A click 40px from the right edge of the page on screen.
    await page.keyboard.press("KeyT");
    await page.mouse.click(pb.x + pb.width - 40, pb.y + pb.height / 2);
    await page.keyboard.type("페이지 끝에서 시작한 긴 텍스트 long text 日本語");
    await page.keyboard.press("Control+Enter");
    const [t] = await texts(page, index);
    expect(t.rotation).toBe((p.baseRotation + p.userRotation) % 360);
    const glyphs = el.locator(`[data-testid=object-layer] > [data-object-id="${t.id}"] text`);
    const gb = (await glyphs.first().boundingBox())!;
    expect(gb.x + gb.width, `page ${index + 1}: text right edge`).toBeLessThanOrEqual(pb.x + pb.width + 1);
    expect(gb.x, `page ${index + 1}: text left edge`).toBeGreaterThanOrEqual(pb.x - 1);
  }
});

test("composition: keys that finish a character stay with the input method", async ({ page }) => {
  await open(page, ["rotated.pdf"]);
  await showPage(page, 0);
  const b = (await model(page)).pages[0].box;
  await page.keyboard.press("KeyT");
  await click(page, 0, { x: b.x0 + 150, y: b.y0 + 500 });
  await expect(box(page)).toBeFocused();

  // Korean composition through the DevTools protocol, the way an IME feeds the input.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "하", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
  // While composing, Escape and Ctrl+Enter belong to the IME: the editor stays open.
  for (const init of [{ key: "Escape" }, { key: "Enter", ctrlKey: true }]) {
    await box(page).evaluate(
      (el, i) => el.dispatchEvent(new KeyboardEvent("keydown", { ...i, isComposing: true, bubbles: true, cancelable: true })),
      init,
    );
  }
  await expect(box(page)).toBeVisible();
  await cdp.send("Input.insertText", { text: "한" });
  await cdp.send("Input.imeSetComposition", { text: "그", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "글", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "글" });
  await expect(box(page)).toHaveValue("한글");
  await page.keyboard.press("Control+Enter");
  expect((await texts(page, 0)).map((t) => t.lines)).toEqual([["한글"]]);
});

test("saved text is a FreeText annotation with the typed contents", async ({ page }) => {
  const w = watch(page);
  await open(page, ["rotated.pdf"]);
  const lines = ["한글 English 日本語", "カタカナ 漢字"];
  for (const index of [0, 2]) {
    await showPage(page, index);
    const b = (await model(page)).pages[index].box;
    await page.keyboard.press("KeyT");
    await click(page, index, { x: b.x0 + 150, y: b.y0 + 400 });
    await page.keyboard.type(lines[0]);
    await page.keyboard.press("Enter");
    await page.keyboard.type(lines[1]);
    await page.keyboard.press("Control+Enter");
  }
  page.once("dialog", (d) => void d.accept("/__out/m5/text.pdf"));
  await page.keyboard.press("Control+Shift+s");
  await expect(page.getByText('"text.pdf"에 저장했습니다.')).toBeVisible({ timeout: 30_000 });

  const annots = await page.evaluate(async () => {
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      openPdf(d: Uint8Array): Promise<{
        numPages: number;
        getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string; contentsObj?: { str: string } }[]> }>;
        loadingTask: { destroy(): Promise<void> };
      }>;
    };
    const pdf = await mod.openPdf(new Uint8Array(await (await fetch("/__out/m5/text.pdf")).arrayBuffer()));
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const list = await (await pdf.getPage(n)).getAnnotations();
      out.push(list.map((a) => ({ subtype: a.subtype, contents: a.contentsObj?.str ?? "" })));
    }
    await pdf.loadingTask.destroy();
    return out;
  });
  for (const i of [0, 2]) expect(annots[i]).toEqual([{ subtype: "FreeText", contents: lines.join("\n") }]);
  for (const i of [1, 3]) expect(annots[i]).toEqual([]);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
