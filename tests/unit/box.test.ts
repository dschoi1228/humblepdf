// M0-3: the page box computed by the core must equal pdf.js `page.view` (SPEC 5),
// for every page-structure fixture and for a merged export of all of them.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Document } from "../../src/bindings/Document";
import type { SourceInfo } from "../../src/bindings/SourceInfo";
import { cli, FIXTURE_PASSWORD, fixturesDir } from "./cli";

const PDF_FIXTURES = [
  "rotated.pdf",
  "cropbox.pdf",
  "mixed_sizes.pdf",
  "inherited.pdf",
  "shared_resources.pdf",
  "content_array.pdf",
  "korean_embedded.pdf",
  "korean_nonembedded.pdf",
  "encrypted_aes256.pdf",
  "encrypted_rc4.pdf",
];

type View = { view: number[]; rotate: number };

async function pdfjsViews(path: string, password?: string): Promise<View[]> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, password }).promise;
  const out: View[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    out.push({ view: [...page.view], rotate: page.rotate });
  }
  await doc.loadingTask.destroy();
  return out;
}

function expectSameBox(core: { x0: number; y0: number; x1: number; y1: number }, view: number[], label: string) {
  const c = [core.x0, core.y0, core.x1, core.y1];
  for (let k = 0; k < 4; k++) {
    expect(Math.abs(c[k] - view[k]), `${label} [${k}] core=${c} pdfjs=${view}`).toBeLessThan(1e-3);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "pe-box-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("core page box equals pdf.js page.view", () => {
  for (const f of PDF_FIXTURES) {
    it(f, async () => {
      const path = join(fixturesDir, f);
      const pw = f.startsWith("encrypted") ? FIXTURE_PASSWORD : undefined;
      const info = cli<SourceInfo>(["inspect", path, ...(pw ? ["--password", pw] : [])]);
      const views = await pdfjsViews(path, pw);
      expect(info.pages.length).toBe(views.length);
      info.pages.forEach((p, i) => {
        expectSameBox(p.box, views[i].view, `${f} p${i + 1}`);
        expect(p.baseRotation, `${f} p${i + 1} rotation`).toBe(views[i].rotate);
      });
    });
  }

  it("merged export of all fixtures and images", async () => {
    const files = [...PDF_FIXTURES, "photo.jpg", "alpha.png", "exif_rotate90.jpg"].map((f) => join(fixturesDir, f));
    const pwArgs = files.flatMap((f, i) => (f.includes("encrypted") ? ["--password", `${i + 1}=${FIXTURE_PASSWORD}`] : []));
    const model = cli<Document>(["model", ...files, ...pwArgs]);
    // Exercise user rotation too.
    model.pages.forEach((p, i) => {
      p.userRotation = ([0, 90, 180, 270] as const)[i % 4];
    });
    const modelPath = join(tmp, "model.json");
    writeFileSync(modelPath, JSON.stringify(model));
    const out = join(tmp, "merged.pdf");
    const passwords = model.sources
      .filter((s) => s.path.includes("encrypted"))
      .flatMap((s) => ["--password", `${s.id}=${FIXTURE_PASSWORD}`]);
    cli(["export", "--model", modelPath, "--out", out, ...passwords]);

    const views = await pdfjsViews(out);
    expect(views.length).toBe(model.pages.length);
    model.pages.forEach((p, i) => {
      expectSameBox(p.box, views[i].view, `merged p${i + 1}`);
      expect(views[i].rotate, `merged p${i + 1} rotation`).toBe((p.baseRotation + p.userRotation) % 360);
    });
  });
});
