// Copies the pdf.js runtime assets into public/pdfjs/ so the app never loads them
// from a network location (CLAUDE.md rule 7, SPEC 6.2).
//   worker, cmaps, standard_fonts, wasm decoders (except the scripting sandbox), iccs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
const outDir = join(process.cwd(), "public", "pdfjs");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

cpSync(join(pkgDir, "build", "pdf.worker.min.mjs"), join(outDir, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "iccs"]) {
  cpSync(join(pkgDir, dir), join(outDir, dir), { recursive: true });
}

// quickjs-eval is only used for PDF JavaScript (scripting), which this app does not enable.
const wasmOut = join(outDir, "wasm");
mkdirSync(wasmOut, { recursive: true });
for (const f of readdirSync(join(pkgDir, "wasm"))) {
  if (f.startsWith("quickjs")) continue;
  cpSync(join(pkgDir, "wasm", f), join(wasmOut, f));
}

for (const required of ["pdf.worker.min.mjs", "cmaps", "standard_fonts", "wasm", "iccs"]) {
  if (!existsSync(join(outDir, required))) {
    console.error(`missing pdf.js asset: ${required}`);
    process.exit(1);
  }
}
console.log(`pdf.js assets copied to ${outDir}`);
