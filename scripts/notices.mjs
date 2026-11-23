// Builds THIRD_PARTY_NOTICES.md (D40): every third-party component shipped in
// HumblePDF.exe with its version, license and the license text from its package.
// - Rust: crates reachable from the app package through normal dependencies, on Windows.
// - npm: packages in package-lock that are not development-only (the frontend bundle).
// - Fonts: Pretendard and Pretendard JP (assets/fonts).
// Fails when a license is outside the allowed set (CLAUDE.md rule 9). Identical license
// texts are printed once, followed by the packages that use them.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "THIRD_PARTY_NOTICES.md";
const ALLOWED = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "0BSD", "Unlicense",
  "Unicode-3.0", "Unicode-DFS-2016", "CC0-1.0", "MIT-0", "OFL-1.1", "BSL-1.0", "Apache-2.0 WITH LLVM-exception",
  "CDLA-Permissive-2.0", "BlueOak-1.0.0", "Python-2.0",
]);
const DENY = /(^|[^L])GPL|AGPL|SSPL/;
// MPL-2.0 (file-level copyleft) is accepted only for these unmodified crates that Tauri
// brings in (D40, user decision). Any other MPL component fails the script.
const MPL_EXCEPTIONS = new Set(["cssparser", "cssparser-macros", "selectors", "dtoa-short", "option-ext"]);

/** True when an SPDX expression can be satisfied with allowed licenses only. */
function allowed(expr) {
  if (!expr) return false;
  if (DENY.test(expr) && !/ OR /.test(expr)) return false;
  // "A OR B": one allowed alternative is enough; "A AND B": all must be allowed.
  return expr
    .replace(/[()]/g, "")
    .split(/\s+OR\s+|\//)
    .some((alt) => alt.split(/\s+AND\s+/).every((l) => ALLOWED.has(l.trim())));
}

const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE|COPYRIGHT|UNLICENSE)([-._].*)?$/i;
function licenseTexts(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
}

const components = [];
const problems = [];
function add(kind, name, version, license, texts, source) {
  const mplOk = license === "MPL-2.0" && kind === "Rust crate" && MPL_EXCEPTIONS.has(name);
  if (!mplOk && !allowed(license)) problems.push(`${kind} ${name} ${version}: ${license ?? "no license"}`);
  components.push({ kind, name, version, license: license ?? "unknown", texts, source });
}

// ---- Rust ----
const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", "--locked"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const members = new Set(meta.workspace_members);
const app = meta.packages.find((p) => p.name === "humblepdf");
const seen = new Set();
const stack = [app.id];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    // Normal dependencies only (no build scripts' or tests' dependencies).
    if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
}
for (const id of seen) {
  if (members.has(id)) continue;
  const p = byId.get(id);
  const texts = licenseTexts(dirname(p.manifest_path));
  if (!texts.length && p.license_file) texts.push(readFileSync(join(dirname(p.manifest_path), p.license_file), "utf8").trim());
  add("Rust crate", p.name, p.version, p.license, texts, p.repository ?? "");
}

// ---- npm (runtime) ----
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
for (const [path, p] of Object.entries(lock.packages)) {
  // Optional packages are platform add-ons (e.g. pdf.js canvas for Node) that never reach the bundle.
  if (!path || p.dev || p.devOptional || p.optional) continue;
  const dir = path;
  const pkg = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
  const name = pkg.name ?? path.replace(/^.*node_modules\//, "");
  const license = p.license ?? (typeof pkg.license === "string" ? pkg.license : pkg.license?.type);
  add("npm package", name, p.version ?? pkg.version, license, licenseTexts(dir), typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? ""));
}

// ---- Fonts ----
add("Font", "Pretendard (Regular)", "1.3.9", "OFL-1.1", [readFileSync("assets/fonts/OFL.txt", "utf8").replace(/\r\n/g, "\n").trim()], "https://github.com/orioncactus/pretendard");
add(
  "Font",
  "Pretendard JP (Regular, common-character subset)",
  "1.3.9",
  "OFL-1.1",
  [readFileSync("assets/fonts/OFL-PretendardJP.txt", "utf8").replace(/\r\n/g, "\n").trim()],
  "https://github.com/orioncactus/pretendard",
);

if (problems.length) {
  console.error("Licenses outside the allowed set (CLAUDE.md rule 9):\n  " + problems.join("\n  "));
  process.exit(1);
}

// ---- Output ----
components.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const groups = new Map(); // text hash -> { text, users }
for (const c of components) {
  for (const text of c.texts) {
    const h = createHash("sha256").update(text).digest("hex");
    if (!groups.has(h)) groups.set(h, { text, users: [] });
    groups.get(h).users.push(`${c.name} ${c.version}`);
  }
}
const md = [];
md.push("# Third-party notices");
md.push("");
md.push(
  "HumblePDF includes the following third-party components. Each is used under its own license, " +
    "reproduced below. This file is generated by `npm run notices`.",
);
md.push("");
md.push("| Component | Kind | Version | License |");
md.push("|---|---|---|---|");
for (const c of components) md.push(`| ${c.name} | ${c.kind} | ${c.version} | ${c.license} |`);
md.push("");
const missing = components.filter((c) => !c.texts.length);
if (missing.length) {
  md.push("Packages that ship no license file are covered by the standard text of their license:");
  md.push("");
  for (const c of missing) md.push(`- ${c.name} ${c.version} (${c.license})`);
  md.push("");
}
const mpl = components.filter((c) => c.license === "MPL-2.0");
if (mpl.length) {
  md.push("## Source of MPL-2.0 components");
  md.push("");
  md.push("These components are used unmodified under the Mozilla Public License 2.0. Their source code is available at:");
  md.push("");
  for (const c of mpl) md.push(`- ${c.name} ${c.version}: https://crates.io/crates/${c.name}/${c.version}`);
  md.push("");
}
md.push("## License texts");
for (const [i, g] of [...groups.values()].entries()) {
  md.push("");
  md.push(`### Text ${i + 1}`);
  md.push("");
  md.push(`Used by: ${[...new Set(g.users)].join(", ")}`);
  md.push("");
  md.push("```text");
  md.push(g.text.replace(/```/g, "'''"));
  md.push("```");
}
md.push("");
writeFileSync(OUT, md.join("\n"));
console.log(`${OUT}: ${components.length} components, ${groups.size} distinct license texts, ${Buffer.byteLength(md.join("\n"))} bytes`);
