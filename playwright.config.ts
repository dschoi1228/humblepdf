import { defineConfig } from "@playwright/test";

// E2E and screen-match tests run in browser mode (mock backend) against the Vite dev
// server. The installed Microsoft Edge is used: same Chromium engine as WebView2, and no
// browser download is needed.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    channel: "msedge",
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1,
    // Existing tests read Korean UI text; i18n.spec.ts sets its own locales.
    locale: "ko-KR",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
