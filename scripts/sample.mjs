// Builds the samples a person opens in other viewers, with the CLI:
// - out/m0_sample.pdf from tests/fixtures/m0_sample.model.json (Korean text, highlight,
//   rectangle, ellipse, arrows, baked signature; one rotated page)
// - out/m2_sample.pdf: two PDFs, an encrypted PDF and two images, reordered, with pages
//   deleted, all four rotations and both image fits (M2)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PASSWORD = "fixture-pass";

function cli(args, capture = false) {
  const r = spawnSync("cargo", ["run", "-q", "-p", "pdf-editor-cli", "--", ...args], {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return capture ? JSON.parse(r.stdout) : null;
}

mkdirSync("out", { recursive: true });
cli([
  "export",
  "--model", "tests/fixtures/m0_sample.model.json",
  "--out", "out/m0_sample.pdf",
  "--signatures", "tests/fixtures/signatures",
]);

// M2: start from every page of the files, then change the model like the page panel does.
const files = ["mixed_sizes.pdf", "rotated.pdf", "encrypted_aes256.pdf", "photo.jpg", "alpha.png"].map(
  (f) => `tests/fixtures/${f}`,
);
const model = cli(["model", ...files, "--password", `3=${PASSWORD}`], true);
const src = Object.fromEntries(model.sources.map((s) => [s.path.split(/[\\/]/).pop(), s.id]));
const take = (name, index) => {
  const i = model.pages.findIndex((p) => p.sourceId === src[name] && p.pageIndex === index);
  return model.pages.splice(i, 1)[0];
};
// Delete rotated.pdf pages 2 and 4.
take("rotated.pdf", 1);
take("rotated.pdf", 3);
// Photo first, alpha.png in the middle with the `image` fit.
model.pages.unshift(take("photo.jpg", 0));
const alpha = take("alpha.png", 0);
const alphaInfo = cli(["inspect", "tests/fixtures/alpha.png"], true);
alpha.imageFit = "image";
alpha.box = alphaInfo.image.image.box;
model.pages.splice(3, 0, alpha);
// The encrypted page second, rotated 90; mixed_sizes pages 1..3 rotated 180, 270, 90.
model.pages.splice(1, 0, take("encrypted_aes256.pdf", 0));
model.pages[1].userRotation = 90;
for (const [index, r] of [[0, 180], [1, 270], [2, 90]]) {
  model.pages.find((p) => p.sourceId === src["mixed_sizes.pdf"] && p.pageIndex === index).userRotation = r;
}
writeFileSync("out/m2_sample.model.json", JSON.stringify(model, null, 2));
cli([
  "export",
  "--model", "out/m2_sample.model.json",
  "--out", "out/m2_sample.pdf",
  "--password", `${src["encrypted_aes256.pdf"]}=${PASSWORD}`,
]);

const order = model.pages
  .map((p, i) => {
    const name = Object.keys(src).find((k) => src[k] === p.sourceId);
    const extra = [p.userRotation ? `+${p.userRotation}°` : "", p.imageFit === "image" ? "image fit" : ""]
      .filter(Boolean)
      .join(", ");
    return `     ${String(i + 1).padStart(2)}. ${name} p${p.pageIndex + 1}${extra ? ` (${extra})` : ""}`;
  })
  .join("\n");

console.log(`
out/m0_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. Korean text, highlight, rectangle, ellipse, arrows and signature look the same and sit
     in the same place in all three viewers (page 2 is rotated 90°).
  2. The text under the yellow highlight is readable.
  3. Selecting and copying the added text gives the original text.
  4. In Acrobat Reader and Edge, the highlight, shapes and text can be selected as
     annotations; the signature cannot.

out/m2_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. It opens without a password and has ${model.pages.length} pages in this order:
${order}
  2. Every page looks the same in all three viewers (orientation, size, no clipping).
  3. The photo and alpha.png keep their proportions; alpha.png's page has the image's
     proportions, the photo's page is A4.
`);
