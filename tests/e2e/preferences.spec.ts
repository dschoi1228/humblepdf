// M7: recent settings survive a reload; F1 help and the About dialog.
import { expect, test } from "@playwright/test";
import { fixtureUrl, waitForIdle, waitForRenders, watch } from "./helpers";

test("tool properties, thumbnail panel and zoom mode are remembered", async ({ page }) => {
  const w = watch(page);
  await page.goto(`/?open=${fixtureUrl("rotated.pdf")}`);
  await waitForRenders(page);
  await page.keyboard.press("KeyR");
  await page.getByTestId("stroke-blue").click();
  await page.getByTestId("stroke-width").selectOption("6");
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyT");
  await page.getByTestId("font-size").selectOption("24");
  await page.getByTestId("font-size").evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press("Escape");
  await page.getByTestId("fit-page").click();
  await page.getByRole("button", { name: /썸네일 패널/ }).click();
  await expect(page.getByTestId("thumbnail")).toHaveCount(0);
  await page.waitForTimeout(500); // settings are written 300 ms after the last change

  await page.reload();
  await waitForRenders(page);
  await waitForIdle(page);
  await expect(page.getByTestId("thumbnail")).toHaveCount(0);
  await expect(page.getByTestId("fit-page")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("KeyR");
  await expect(page.getByTestId("stroke-blue")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("stroke-width")).toHaveValue("6");
  await page.keyboard.press("KeyT");
  await expect(page.getByTestId("font-size")).toHaveValue("24");

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});

test("F1 opens the shortcut help; the toolbar opens About", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");
  // The app is mounted (its key handler too) once the toolbar is there.
  await expect(page.getByTestId("open-help")).toBeVisible();
  const help = page.getByTestId("help-dialog");
  // A press that lands before the key handler is installed is retried.
  await expect(async () => {
    await page.keyboard.press("F1");
    await expect(help).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(help.getByTestId("help-row").first()).toBeVisible();
  await expect(help.getByText("객체 복제")).toBeVisible();
  await expect(help.getByText("Ctrl+D")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.getByTestId("open-about").click();
  const about = page.getByTestId("about-dialog");
  await expect(about).toBeVisible();
  await expect(about.getByTestId("about-version")).toHaveText(/버전 \d+\.\d+\.\d+/);
  await expect(about.getByText("MIT 라이선스")).toBeVisible();

  expect(w.external).toEqual([]);
  expect(w.consoleProblems).toEqual([]);
});
