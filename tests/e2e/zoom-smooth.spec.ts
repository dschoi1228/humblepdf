// Human check of M1 found zoom (Ctrl+wheel) sluggish with flicker. This test zooms in and
// out repeatedly and samples every animation frame: a page inside the viewport must never
// show an empty canvas (one that has not received any bitmap yet).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { repoRoot } from "../unit/cli";
import { fixtureUrl, waitForIdle, waitForRenders } from "./helpers";

test("Ctrl+wheel zoom never shows a blank page in the viewport", async ({ page }) => {
  await page.goto(`/?open=${fixtureUrl("pages_300.pdf")}`);
  await waitForRenders(page);
  await waitForIdle(page);
  // Start in the middle of the document.
  const input = page.getByTestId("page-input");
  await input.fill("120");
  await input.press("Enter");
  await waitForIdle(page);

  await page.evaluate(() => {
    const w = window as unknown as { __blank: { frames: number; blankFrames: number; samples: string[] }; __stop: boolean };
    w.__blank = { frames: 0, blankFrames: 0, samples: [] };
    w.__stop = false;
    const view = document.querySelector<HTMLElement>("[data-testid=page-view]")!;
    const tick = () => {
      if (w.__stop) return;
      const vr = view.getBoundingClientRect();
      let blank = 0;
      for (const p of document.querySelectorAll<HTMLElement>("[data-testid=page]")) {
        const r = p.getBoundingClientRect();
        if (r.bottom <= vr.top || r.top >= vr.bottom) continue;
        const c = p.querySelector("canvas")!;
        // A canvas that never received a bitmap keeps the default 300x150 size.
        if (c.width === 300 && c.height === 150) blank++;
      }
      w.__blank.frames++;
      if (blank) {
        w.__blank.blankFrames++;
        if (w.__blank.samples.length < 5) w.__blank.samples.push(`frame ${w.__blank.frames}: ${blank} blank`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const box = (await page.getByTestId("page-view").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.keyboard.down("Control");
  for (const dy of [-120, -120, -120, -120, 120, 120, 120, 120, 120, 120, -120, -120]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(90);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(800);
  await waitForIdle(page);
  const result = await page.evaluate(() => {
    const w = window as unknown as { __blank: { frames: number; blankFrames: number; samples: string[] }; __stop: boolean };
    w.__stop = true;
    return { ...w.__blank, stats: { ...window.__viewer!.stats } };
  });
  writeFileSync(join(repoRoot, "out", "m1", "zoom_smooth.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  expect(result.frames).toBeGreaterThan(30);
  expect(result.blankFrames, result.samples.join("; ")).toBe(0);
});
