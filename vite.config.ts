import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

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

/**
 * Dev-server only (D26): POST /__export {model, outPath, passwords} runs the CLI `export`
 * so browser mode saves through the real core. Source paths under /__fixtures/ and
 * /__out/ are mapped to files; the output must be under /__out/ or be one of the sources
 * (which core refuses). Needs the debug CLI (built by `npm run e2e`).
 */
function exportRoute(): Plugin {
  const mounts: Record<string, string> = {
    "/__fixtures/": resolve("tests/fixtures"),
    "/__out/": resolve("out"),
  };
  const toFile = (p: string): string | null => {
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (!p.startsWith(prefix)) continue;
      const file = normalize(join(dir, p.slice(prefix.length)));
      return file.startsWith(dir + sep) ? file : null;
    }
    return null;
  };
  const cliExe = resolve("target", "debug", process.platform === "win32" ? "humblepdf-cli.exe" : "humblepdf-cli");
  return {
    name: "export-route",
    apply: "serve",
    configureServer(server) {
      // Reopening in browser mode (D36): the core's restored objects and rendering bytes for
      // files under /__fixtures/ and /__out/. GET ?path=...&password=...
      const cliFor = (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string | Buffer) => void }, run: (file: string, password: string | null) => void) => {
        const q = new URL(req.url ?? "", "http://localhost").searchParams;
        const file = toFile(q.get("path") ?? "");
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!existsSync(cliExe)) {
          res.statusCode = 500;
          res.end("run `cargo build -p humblepdf-cli` first");
          return;
        }
        run(file, q.get("password"));
      };
      server.middlewares.use("/__inspect", (req, res) =>
        cliFor(req, res, (file, password) => {
          const args = ["inspect", file, ...(password ? ["--password", password] : [])];
          execFile(cliExe, args, { encoding: "utf8" }, (err, stdout, stderr) => {
            res.setHeader("Content-Type", "application/json");
            res.statusCode = err ? 400 : 200;
            res.end(err ? stderr : stdout);
          });
        }),
      );
      server.middlewares.use("/__render", (req, res) =>
        cliFor(req, res, (file, password) => {
          const work = resolve("out", "e2e", "render");
          mkdirSync(work, { recursive: true });
          const out = join(work, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
          const args = ["render-bytes", file, "--out", out, ...(password ? ["--password", password] : [])];
          execFile(cliExe, args, { encoding: "utf8" }, (err, _stdout, stderr) => {
            if (err) {
              res.statusCode = 400;
              res.end(stderr);
              return;
            }
            const body = readFileSync(out);
            rmSync(out, { force: true });
            res.setHeader("Content-Type", "application/pdf");
            res.end(body);
          });
        }),
      );
      server.middlewares.use("/__export", (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return reply(405, { code: "internal", message: "POST only" });
        let text = "";
        req.setEncoding("utf8");
        req.on("data", (c: string) => (text += c));
        req.on("end", () => {
          type Body = {
            model: { sources: { id: string; path: string }[] };
            outPath: string;
            passwords: Record<string, string>;
            /** signatureId -> base64 PNG (browser-mode signature library). */
            signatures?: Record<string, string>;
            flatten?: boolean;
          };
          const body = JSON.parse(text) as Body;
          const model = structuredClone(body.model);
          for (const s of model.sources) {
            const file = toFile(s.path);
            if (!file) return reply(400, { code: "unsupported", message: `browser mode cannot export ${s.path}` });
            s.path = file;
          }
          const isSource = body.model.sources.some((s) => s.path === body.outPath);
          const out = toFile(body.outPath);
          if (!out || (!isSource && !body.outPath.startsWith("/__out/"))) {
            return reply(400, { code: "io", message: "browser mode saves under /__out/ only" });
          }
          if (!existsSync(cliExe)) return reply(500, { code: "internal", message: "run `cargo build -p humblepdf-cli` first" });
          const work = resolve("out", "e2e", "export");
          mkdirSync(work, { recursive: true });
          mkdirSync(dirname(out), { recursive: true });
          const modelFile = join(work, `model-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
          writeFileSync(modelFile, JSON.stringify(model));
          const args = ["export", "--model", modelFile, "--out", out];
          if (body.flatten) args.push("--flatten");
          let sigDir: string | null = null;
          const sigs = Object.entries(body.signatures ?? {});
          if (sigs.length) {
            if (!sigs.every(([id]) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
              return reply(400, { code: "invalid_model", message: "bad signature id" });
            }
            sigDir = join(work, `signatures-${Date.now()}-${Math.random().toString(36).slice(2)}`);
            mkdirSync(sigDir, { recursive: true });
            for (const [id, b64] of sigs) writeFileSync(join(sigDir, `${id}.png`), Buffer.from(b64, "base64"));
            args.push("--signatures", sigDir);
          }
          for (const [id, pw] of Object.entries(body.passwords)) args.push("--password", `${id}=${pw}`);
          execFile(cliExe, args, { encoding: "utf8" }, (err, stdout, stderr) => {
            rmSync(modelFile, { force: true });
            if (sigDir) rmSync(sigDir, { recursive: true, force: true });
            if (!err) return reply(200, JSON.parse(stdout));
            try {
              reply(400, JSON.parse(stderr));
            } catch {
              reply(500, { code: "internal", message: stderr || String(err) });
            }
          });
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), serveTestFiles(), exportRoute()],
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
