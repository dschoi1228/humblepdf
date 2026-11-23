// Every error code the core, the Tauri shell or the backends can send has its own message
// in each language (M7, SPEC 8). Codes are read from the sources so new ones are caught.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionary, LOCALES } from ".";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const filesIn = (dir: string, ext: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));

function errorCodes(): Set<string> {
  const codes = new Set<string>();
  for (const m of read("crates/core/src/error.rs").matchAll(/=> "([a-z_]+)"/g)) codes.add(m[1]);
  for (const f of [...filesIn("src-tauri/src", ".rs"), ...filesIn("crates/cli/src", ".rs")]) {
    for (const m of read(f).matchAll(/code: "([a-z_]+)"|fail\("([a-z_]+)"/g)) codes.add(m[1] ?? m[2]);
  }
  for (const f of filesIn("src/backend", ".ts")) {
    for (const m of read(f).matchAll(/fail\("([a-z_]+)"/g)) codes.add(m[1]);
  }
  return codes;
}

describe("error messages", () => {
  const codes = errorCodes();
  it("finds the codes", () => {
    for (const c of ["io", "pdf", "font", "internal", "signature_missing", "unknown_signature", "invalid_name"]) expect(codes).toContain(c);
  });
  it.each(LOCALES)("%s has a message for every code", (l) => {
    const errors = dictionary(l).errors as Record<string, string>;
    const missing = [...codes].filter((c) => !errors[c]);
    expect(missing).toEqual([]);
  });
});
