// Builds assets/fonts/PretendardJP-Common.ttf (D32): the Japanese companion of the bundled
// font, cut down to common characters so the app stays small.
// Characters: everything in JIS X 0208 (kana, symbols, level 1 and level 2 kanji), plus
// halfwidth katakana and the fullwidth forms block.
// Needs Python with fontTools (`pip install --user fonttools`); only used to regenerate
// the font, never by the app or the build.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";

const SOURCE = "assets/fonts/source/PretendardJP-Regular.ttf";
const OUT = "assets/fonts/PretendardJP-Common.ttf";
const LIST = "assets/fonts/PretendardJP-Common.chars.txt";

const decoder = new TextDecoder("shift_jis", { fatal: true });
const chars = new Set();
// Shift_JIS double-byte codes of JIS X 0208 (lead 0x81-0x9F, 0xE0-0xEA; NEC/IBM extensions excluded).
for (let lead = 0x81; lead <= 0xea; lead++) {
  if (lead > 0x9f && lead < 0xe0) continue;
  for (let trail = 0x40; trail <= 0xfc; trail++) {
    if (trail === 0x7f) continue;
    const code = (lead << 8) | trail;
    if (code >= 0x8740 && code <= 0x879f) continue; // NEC row 13 extension
    if (code > 0xeaa4) continue;
    let s;
    try {
      s = decoder.decode(new Uint8Array([lead, trail]));
    } catch {
      continue;
    }
    if ([...s].length === 1) chars.add(s.codePointAt(0));
  }
}
for (let c = 0xff61; c <= 0xff9f; c++) chars.add(c); // halfwidth katakana
for (let c = 0xff01; c <= 0xff5e; c++) chars.add(c); // fullwidth ASCII
for (let c = 0x3000; c <= 0x30ff; c++) chars.add(c); // CJK punctuation, hiragana, katakana

const sorted = [...chars].sort((a, b) => a - b);
const hex = (c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
mkdirSync("out", { recursive: true });
writeFileSync("out/fonts-unicodes.txt", sorted.map(hex).join(","));
writeFileSync(LIST, String.fromCodePoint(...sorted).replace(/(.{64})/gu, "$1\n") + "\n");

const r = spawnSync(
  "python",
  [
    "-P",
    "-m",
    "fontTools.subset",
    SOURCE,
    "--unicodes-file=out/fonts-unicodes.txt",
    "--no-hinting",
    // No layout features: the app draws with advance widths only (SPEC 7.6).
    "--layout-features=",
    "--drop-tables+=DSIG",
    "--name-IDs=*",
    "--name-legacy",
    "--name-languages=*",
    `--output-file=${OUT}`,
  ],
  { stdio: "inherit" },
);
if (r.status !== 0) {
  console.error("fontTools failed. Install it with: python -m pip install --user fonttools");
  process.exit(r.status ?? 1);
}
console.log(`${OUT}: ${sorted.length} characters, ${statSync(OUT).size} bytes`);
