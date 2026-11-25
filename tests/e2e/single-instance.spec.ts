// M11 in browser mode: files from a second launch (double-click while the app runs) reach the
// running window (D46). window.__openFiles stands in for the shell's "open-files" event.
import { expect, test, type Page } from "@playwright/test";
import { fixtureUrl, waitForRenders, watch } from "./helpers";

const pageCount = (page: Page) => page.evaluate(() => window.__viewer!.model().pages.length);

async function arrive(page: Page, names: string[]) {
  await page.waitForFunction(() => typeof window.__openFiles === "function");
  await page.evaluate((paths) => window.__openFiles!(paths), names.map(fixtureUrl));
}

test("an empty window opens arriving files; a document with pages asks how", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");

  // Empty: opened right away, no question; one file is not a change (D42).
  await arrive(page, ["rotated.pdf"]);
  await waitForRenders(page);
  await expect.poll(() => pageCount(page)).toBeGreaterThan(0);
  const first = await pageCount(page);
  await expect(page.getByTestId("incoming-dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(false);

  // Pages: the question lists the files.
  const dialog = page.getByTestId("incoming-dialog");
  await arrive(page, ["mixed_sizes.pdf"]);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("incoming-names")).toHaveText("mixed_sizes.pdf");
  await expect(dialog).toContainText("이 파일을 어떻게 열까요?");

  // Cancel: nothing changes.
  await dialog.getByTestId("incoming-cancel").click();
  await expect(dialog).toHaveCount(0);
  expect(await pageCount(page)).toBe(first);

  // New window: handed on with the paths, this document unchanged.
  await arrive(page, ["mixed_sizes.pdf", "photo.jpg"]);
  await expect(dialog).toContainText("파일 2개를 어떻게 열까요?");
  await dialog.getByTestId("incoming-window").click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__openedWindows)).toEqual([[fixtureUrl("mixed_sizes.pdf"), fixtureUrl("photo.jpg")]]);
  expect(await pageCount(page)).toBe(first);

  // Add: appended to this document, which is now changed.
  await arrive(page, ["mixed_sizes.pdf"]);
  await dialog.getByTestId("incoming-add").click();
  await expect.poll(() => pageCount(page)).toBe(first + 4);
  expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
