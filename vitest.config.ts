import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve("src") } },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
