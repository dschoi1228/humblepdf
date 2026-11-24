// Builds the app icons in src-tauri/icons from assets/icon.svg (D42). `tauri icon` also
// writes Android, iOS and extra sizes; only the files the Windows build uses are kept.
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = "src-tauri/icons";
const tmp = mkdtempSync(join(tmpdir(), "humblepdf-icons-"));
try {
  execSync(`npx tauri icon assets/icon.svg -o "${tmp}"`, { stdio: "inherit" });
  const keep = readdirSync(out).filter((f) => /\.(png|ico|icns)$/.test(f));
  for (const f of keep) copyFileSync(join(tmp, f), join(out, f));
  console.log(`updated ${keep.length} files in ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
