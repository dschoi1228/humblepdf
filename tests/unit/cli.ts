// Helpers to run the Rust CLI from Node tests.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "..", "..");
export const fixturesDir = join(repoRoot, "tests", "fixtures");
export const FIXTURE_PASSWORD = "fixture-pass";

let built = false;

/** Builds (once per process) and returns the path of the debug CLI binary. */
export function cliPath(): string {
  const exe = join(repoRoot, "target", "debug", process.platform === "win32" ? "pdf-editor-cli.exe" : "pdf-editor-cli");
  if (!built) {
    execFileSync("cargo", ["build", "-q", "-p", "pdf-editor-cli"], { cwd: repoRoot, stdio: "inherit" });
    built = true;
  }
  if (!existsSync(exe)) throw new Error(`CLI not found: ${exe}`);
  return exe;
}

export function cli<T = unknown>(args: string[]): T {
  const out = execFileSync(cliPath(), args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as T;
}
