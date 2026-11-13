// Builds out/m0_sample.pdf from tests/fixtures/m0_sample.model.json with the CLI
// (Korean text, highlight, rectangle, ellipse, arrows, baked signature; one rotated page).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("out", { recursive: true });
const r = spawnSync(
  "cargo",
  [
    "run", "-q", "-p", "pdf-editor-cli", "--",
    "export",
    "--model", "tests/fixtures/m0_sample.model.json",
    "--out", "out/m0_sample.pdf",
    "--signatures", "tests/fixtures/signatures",
  ],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`
out/m0_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. Korean text, highlight, rectangle, ellipse, arrows and signature look the same and sit
     in the same place in all three viewers (page 2 is rotated 90°).
  2. The text under the yellow highlight is readable.
  3. Selecting and copying the added text gives the original text.
  4. In Acrobat Reader and Edge, the highlight, shapes and text can be selected as
     annotations; the signature cannot.
`);
