import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";

const host = process.env.TAURI_DEV_HOST;

/**
 * Dev-server only: serves test fixtures and generated samples to the browser-mode
 * mock backend. Never part of a production build.
 */
function serveTestFiles(): Plugin {
  const mounts: Record<string, string> = {
    "/__fixtures/": resolve("tests/fixtures"),
    "/__out/": resolve("out"),
  };
  return {
    name: "serve-test-files",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        for (const [prefix, dir] of Object.entries(mounts)) {
          if (!url.startsWith(prefix)) continue;
          const file = normalize(join(dir, url.slice(prefix.length)));
          if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader("Content-Type", file.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), serveTestFiles()],
  resolve: { alias: { "@": resolve("src") } },
  // Keep Rust errors visible when run by `tauri dev`.
  clearScreen: false,
  server: {
    // Tauri expects a fixed port.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**", "**/out/**"],
    },
  },
  build: {
    // WebView2 157 is evergreen Chromium; pdf.js 6 needs a modern target anyway.
    target: "es2024",
  },
}));
