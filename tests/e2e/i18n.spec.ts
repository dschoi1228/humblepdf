// M2.5: the UI language follows the system language (ko, en, ja; English otherwise), can be
// changed from the toolbar, and the choice is remembered (D27).
import { expect, test } from "@playwright/test";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

const cases = [
  { locale: "en-US", lang: "en", empty: "Add a PDF or an image", title: "HumblePDF" },
  { locale: "ja-JP", lang: "ja", empty: "PDF または画像を追加してください", title: "HumblePDF" },
  { locale: "ko-KR", lang: "ko", empty: "PDF나 이미지를 추가하세요", title: "HumblePDF" },
  { locale: "fr-FR", lang: "en", empty: "Add a PDF or an image", title: "HumblePDF" },
];

for (const c of cases) {
  test.describe(`system language ${c.locale}`, () => {
    test.use({ locale: c.locale });
    test(`starts in ${c.lang}`, async ({ page }) => {
      const w = watch(page);
      await page.goto("/");
      await expect(page.getByText(c.empty)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", c.lang);
      await expect(page).toHaveTitle(c.title);
      await expect(page.getByTestId("language")).toHaveValue(c.lang);
      expect(w.external).toEqual([]);
      expect(w.consoleProblems).toEqual([]);
    });
  });
}

test.describe("switching the language", () => {
  test.use({ locale: "en-US" });

  test("changes every visible string, keeps the document and is remembered", async ({ page }) => {
    const w = watch(page);
    await page.goto(`/?open=${fixtureUrl("mixed_sizes.pdf")}`);
    await waitForRenders(page);
    await waitForIdle(page);

    const thumbs = page.getByTestId("thumbnail");
    await expect(thumbs.first()).toHaveText("Page 1");
    await expect(page.getByTestId("undo")).toHaveAttribute("aria-label", "Undo (Ctrl+Z)");
    await page.getByTestId("rotate-right").click();

    await page.getByTestId("language").selectOption("ja");
    await expect(thumbs.first()).toHaveText("1 ページ");
    await expect(page.getByTestId("undo")).toHaveAttribute("aria-label", "元に戻す (Ctrl+Z)");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page).toHaveTitle("HumblePDF");
    // The document and its history are untouched by the language change.
    expect(await page.evaluate(() => window.__viewer!.dirty())).toBe(true);
    await expect(page.getByTestId("undo")).toBeEnabled();

    // The suggested save name uses the language's suffix.
    const asked = new Promise<string>((resolve) =>
      page.once("dialog", (d) => {
        resolve(d.defaultValue());
        void d.dismiss();
      }),
    );
    await page.keyboard.press("Control+Shift+S");
    expect(await asked).toBe("/__out/saved/mixed_sizes_編集.pdf");

    // Remembered after a reload, even though the system language is English.
    await page.goto("/");
    await expect(page.getByText("PDF または画像を追加してください")).toBeVisible();
    await expect(page.getByTestId("language")).toHaveValue("ja");

    await page.getByTestId("language").selectOption("ko");
    await expect(page.getByText("PDF나 이미지를 추가하세요")).toBeVisible();

    expect(w.external).toEqual([]);
    expect(w.consoleProblems).toEqual([]);
  });
});
