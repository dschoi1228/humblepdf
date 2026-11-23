// Builds the samples a person opens in other viewers, with the CLI:
// - out/m0_sample.pdf from tests/fixtures/m0_sample.model.json (Korean text, highlight,
//   rectangle, ellipse, arrows, baked signature; one rotated page)
// - out/m2_sample.pdf: two PDFs, an encrypted PDF and two images, reordered, with pages
//   deleted, all four rotations and both image fits (M2)
// - out/m3_sample.pdf: highlights in the four colors over Korean text, and rectangles,
//   ellipses, lines and arrows on pages rotated 0/90/180/270 (M3)
// - out/m4_sample.pdf: the synthetic signature baked over Korean text and upright on pages
//   rotated 0/90/180/270 and an image page, several times (M4)
// - out/m5_sample.pdf: Korean, English and Japanese text in several sizes and colors on
//   pages rotated 0/90/180/270, with one character outside the bundled fonts (M5)
// - out/m6_reopened.pdf: m3_sample.pdf and m5_sample.pdf added again (objects restored from
//   their annotations) and saved once more; out/m6_flattened.pdf: the same, flattened (M6)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PASSWORD = "fixture-pass";

function cli(args, capture = false) {
  const r = spawnSync("cargo", ["run", "-q", "-p", "humblepdf-cli", "--", ...args], {
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

// M3: objects as the editor makes them (ids are unique in the document).
const m3 = cli(["model", "tests/fixtures/korean_embedded.pdf", "tests/fixtures/rotated.pdf"], true);
m3.pages = m3.pages.filter((p) => p.sourceId === m3.sources[0].id || p.pageIndex < 4);
const HIGHLIGHT = { yellow: [1, 0.92, 0.23], green: [0.56, 0.93, 0.56], pink: [1, 0.6, 0.8], sky: [0.53, 0.81, 0.98] };
const RED = [0.898, 0.224, 0.208];
const BLUE = [0.118, 0.533, 0.898];
const GREEN = [0.263, 0.627, 0.278];
let next = 0;
const id = (kind) => `${kind}-${++next}`;
const quad = (b, x0, y0, x1, y1) => [
  [{ x: b.x0 + x0, y: b.y0 + y1 }, { x: b.x0 + x1, y: b.y0 + y1 }, { x: b.x0 + x0, y: b.y0 + y0 }, { x: b.x0 + x1, y: b.y0 + y0 }],
];
{
  // korean_embedded.pdf: the three text lines and one blank area.
  const b = m3.pages[0].box;
  const rows = [[760, 786], [712, 738], [664, 690], [600, 626]];
  m3.pages[0].objects = Object.entries(HIGHLIGHT).map(([, color], i) => ({
    type: "highlight", id: id("highlight"), quads: quad(b, 48, rows[i][0], 330, rows[i][1]), color, opacity: 0.4,
  }));
}
for (const p of m3.pages.slice(1)) {
  const b = p.box;
  const R = (x0, y0, x1, y1) => ({ x0: b.x0 + x0, y0: b.y0 + y0, x1: b.x0 + x1, y1: b.y0 + y1 });
  const P = (x, y) => ({ x: b.x0 + x, y: b.y0 + y });
  p.objects = [
    { type: "highlight", id: id("highlight"), quads: quad(b, 60, 250, 260, 275), color: HIGHLIGHT.yellow, opacity: 0.4 },
    { type: "rect", id: id("rect"), rect: R(80, 150, 230, 230), stroke: RED, strokeWidth: 4, fill: null, opacity: 1 },
    { type: "ellipse", id: id("ellipse"), rect: R(250, 120, 400, 220), stroke: RED, strokeWidth: 2, fill: GREEN, opacity: 0.7 },
    { type: "line", id: id("line"), from: P(70, 330), to: P(330, 330), stroke: BLUE, strokeWidth: 1, arrow: false, opacity: 1 },
    { type: "line", id: id("arrow"), from: P(70, 60), to: P(330, 100), stroke: RED, strokeWidth: 3, arrow: true, opacity: 1 },
  ];
}
writeFileSync("out/m3_sample.model.json", JSON.stringify(m3, null, 2));
cli(["export", "--model", "out/m3_sample.model.json", "--out", "out/m3_sample.pdf"]);

// M4: signatures placed the way the signature tool places them (upright on screen).
const sigPng = readFileSync("tests/fixtures/signatures/sig-demo.png");
const sigAspect = sigPng.readUInt32BE(16) / sigPng.readUInt32BE(20);
const m4 = cli(["model", "tests/fixtures/korean_embedded.pdf", "tests/fixtures/rotated.pdf", "tests/fixtures/photo.jpg"], true);
m4.pages = m4.pages.filter((p) => p.sourceId !== m4.sources[1].id || p.pageIndex < 4);
let sigN = 0;
const placeSig = (p, cx, cy, screenW) => {
  const r = (p.baseRotation + p.userRotation) % 360;
  const sideways = r === 90 || r === 270;
  const screenH = screenW / sigAspect;
  const [ex, ey] = sideways ? [screenH, screenW] : [screenW, screenH];
  const b = p.box;
  return {
    type: "signature",
    id: `signature-${++sigN}`,
    signatureId: "sig-demo",
    rect: { x0: b.x0 + cx - ex / 2, y0: b.y0 + cy - ey / 2, x1: b.x0 + cx + ex / 2, y1: b.y0 + cy + ey / 2 },
    rotation: r,
  };
};
// Page 1: over the first text line, and once more below.
m4.pages[0].objects = [placeSig(m4.pages[0], 180, 773, 150), placeSig(m4.pages[0], 300, 500, 200)];
for (const p of m4.pages.slice(1)) p.objects = [placeSig(p, 200, 200, 140), placeSig(p, 380, 420, 100)];
writeFileSync("out/m4_sample.model.json", JSON.stringify(m4, null, 2));
cli(["export", "--model", "out/m4_sample.model.json", "--out", "out/m4_sample.pdf", "--signatures", "tests/fixtures/signatures"]);

// M5: text objects as the text tool makes them (upright: rotation = display rotation).
const m5 = cli(["model", "tests/fixtures/rotated.pdf"], true);
m5.pages = m5.pages.filter((p) => p.pageIndex < 4);
const BLACK = [0, 0, 0];
let textN = 0;
/** User-space point at (u, v) pt from the top-left of the page as displayed (rotated). */
const screenPoint = (p, u, v) => {
  const { x0, y0, x1, y1 } = p.box;
  switch ((p.baseRotation + p.userRotation) % 360) {
    case 90:
      return { x: x0 + v, y: y0 + u };
    case 180:
      return { x: x1 - u, y: y0 + v };
    case 270:
      return { x: x1 - v, y: y1 - u };
    default:
      return { x: x0 + u, y: y1 - v };
  }
};
// (u, v): baseline start measured on the displayed page, like a click with the text tool.
const textAt = (p, u, v, fontSize, color, lines) => ({
  type: "text",
  id: `text-${++textN}`,
  origin: screenPoint(p, u, v),
  rotation: (p.baseRotation + p.userRotation) % 360,
  fontSize,
  color,
  lines,
});
for (const p of m5.pages) {
  p.objects = [
    textAt(p, 60, 120, 12, BLACK, ["한글 텍스트와 English text", "日本語のテキスト：ひらがな、カタカナ、漢字"]),
    textAt(p, 60, 200, 24, RED, ["큰 글자 大きい文字"]),
    textAt(p, 60, 250, 8, BLUE, ["작은 글자 8pt · 小さい文字 · small text"]),
  ];
}
// One rare character (U+2000B) outside the bundled fonts: the export warns about it.
m5.pages[0].objects.push(textAt(m5.pages[0], 60, 320, 14, GREEN, ["없는 글자 → 𠀋 ←"]));
writeFileSync("out/m5_sample.model.json", JSON.stringify(m5, null, 2));
cli(["export", "--model", "out/m5_sample.model.json", "--out", "out/m5_sample.pdf"]);

// M6: reopen the M3 and M5 samples, save again, and export a flattened copy.
const m6 = cli(["model", "out/m3_sample.pdf", "out/m5_sample.pdf"], true);
const restoredObjects = m6.pages.reduce((n, p) => n + p.objects.length, 0);
writeFileSync("out/m6_sample.model.json", JSON.stringify(m6, null, 2));
cli(["export", "--model", "out/m6_sample.model.json", "--out", "out/m6_reopened.pdf"]);
cli(["export", "--model", "out/m6_sample.model.json", "--out", "out/m6_flattened.pdf", "--flatten"]);

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

out/m3_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. Page 1: four highlights (yellow, green, pink, sky blue); the Korean text under them
     is easy to read.
  2. Pages 2-5 (rotated 0, 90, 180, 270): a yellow highlight, a red rectangle, a green
     ellipse with a red outline, a blue line and a red arrow, placed the same way relative
     to the page's own "rotate N" label on every page and in every viewer.
  3. In Acrobat Reader and Edge: each object is an annotation (comment) that can be
     selected, moved and deleted. Undo there restores it.
  4. Chrome shows the same picture (it may not let you edit annotations).

out/m4_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. Page 1: the blue signature sits over the first text line; the text shows through
     around the strokes (transparent background). A second one is lower on the page.
  2. Pages 2-5 (rotated 0, 90, 180, 270) and page 6 (photo): two signatures each, both
     upright when the page is read the right way up.
  3. In Acrobat Reader and Edge the signatures cannot be selected, moved or deleted as
     comments/annotations: they are part of the page.
  4. All three viewers show the same picture.

out/m5_sample.pdf — open it in Acrobat Reader, Edge and Chrome and check:
  1. Pages 1-4 (rotated 0, 90, 180, 270): three texts each, upright when the page is read
     the right way up: mixed Korean/English, Japanese (kana and kanji), a large red and a
     small blue line. The Korean and Japanese glyphs look like one family.
  2. Page 1 also has "없는 글자 → ? ←": the rare character is a blank (the export reported
     it as missing; the CLI printed a missing_glyphs warning above).
  3. Selecting and copying each text gives the original text (Japanese included).
  4. In Acrobat Reader and Edge each text is a text box comment that can be moved and
     deleted.
  5. All three viewers show the same picture.

out/m6_reopened.pdf and out/m6_flattened.pdf — the M3 and M5 samples opened again
(${restoredObjects} objects restored) and saved. Open them in Acrobat Reader, Edge and Chrome:
  1. Both look exactly like m3_sample.pdf followed by m5_sample.pdf (9 pages); nothing is
     doubled or missing.
  2. m6_reopened.pdf: highlights, shapes and text are still annotations (selectable in
     Acrobat Reader and Edge), each one once.
  3. m6_flattened.pdf: nothing can be selected as an annotation; everything is part of
     the page. Text can still be selected and copied as page text.
`);
