import type { Page } from "@playwright/test";

/** Collects requests leaving the app, failed responses and console warnings/errors. */
export function watch(page: Page) {
  const external: string[] = [];
  const failed: string[] = [];
  const consoleProblems: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol !== "data:" && u.protocol !== "blob:") {
      external.push(r.url());
    }
  });
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if ((m.type() === "warning" || m.type() === "error") && !m.text().includes("[vite]")) consoleProblems.push(m.text());
  });
  return { external, failed, consoleProblems };
}

/** Waits until at least `n` main-view page renders have completed. */
export async function waitForRenders(page: Page, n = 1) {
  await page.waitForFunction((k) => (window.__viewer?.stats.completed ?? 0) >= k, n, { timeout: 30_000 });
}

/** Waits until the render queue is empty. */
export async function waitForIdle(page: Page) {
  await page.waitForFunction(() => window.__viewer?.stats.running === 0, undefined, { timeout: 30_000 });
  await page.waitForTimeout(150);
  await page.waitForFunction(() => window.__viewer?.stats.running === 0, undefined, { timeout: 30_000 });
}

export const fixtureUrl = (name: string) => `/__fixtures/${name}`;
