// M0-2: Korean PDFs (embedded and non-embedded font) render with the bundled pdf.js
// assets, text extracts correctly, and no request leaves the app's own origin.
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { waitForIdle, waitForRenders } from "./helpers";

const CASES = [
  {
    file: "korean_embedded.pdf",
    lines: ["한글 렌더링 검사: 폰트 포함", "다람쥐 헌 쳇바퀴에 타고파", "가나다라마바사 0123456789"],
  },
  {
    file: "korean_nonembedded.pdf",
    lines: ["한글 렌더링 검사: 폰트 미포함", "키스의 고유조건은 입술끼리 만나야"],
  },
];

async function extractText(page: Page, url: string): Promise<string[]> {
  return page.evaluate(async (u) => {
    // Loaded in the page from the Vite dev server, not resolved by Node.
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as { openPdf(data: Uint8Array): Promise<PDFDocumentProxy> };
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
    const doc = await mod.openPdf(bytes);
    const p = await doc.getPage(1);
    const tc = await p.getTextContent();
    const lines: string[] = [];
    let current = "";
    for (const item of tc.items) {
      if (!("str" in item)) continue;
      current += item.str;
      if (item.hasEOL) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
    await doc.loadingTask.destroy();
    return lines.map((l) => l.trim()).filter(Boolean);
  }, url);
}

/** Fraction of canvas pixels that are dark (text drawn). */
async function inkRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("[data-testid=page] canvas")!;
    const ctx = c.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, c.width, Math.floor(c.height / 4));
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
    return dark / (data.length / 4);
  });
}

for (const c of CASES) {
  test(`renders ${c.file} offline`, async ({ page }) => {
    const external: string[] = [];
    const warnings: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol !== "data:" && u.protocol !== "blob:") {
        external.push(r.url());
      }
    });
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") warnings.push(m.text());
    });

    const url = `/__fixtures/${c.file}`;
    await page.goto(`/?open=${encodeURIComponent(url)}`);
    await waitForRenders(page);
    await waitForIdle(page);

    expect(await inkRatio(page), "text pixels on the top of the page").toBeGreaterThan(0.002);
    expect(await extractText(page, url)).toEqual(c.lines);

    // pdf.js asset requests (cMaps for the non-embedded font) were served locally.
    expect(external, "requests outside the app").toEqual([]);
    expect(failed, "failed requests").toEqual([]);
    expect(warnings.filter((w) => !w.includes("[vite]") && !w.includes("React DevTools"))).toEqual([]);

    mkdirSync("out/m0", { recursive: true });
    await page.locator("[data-testid=page]").first().screenshot({ path: `out/m0/${c.file}.png` });
  });
}
