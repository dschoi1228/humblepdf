// M0-5: the overlay drawn from the model and the exported PDF rendered by pdf.js must put
// every object within 1px of each other at 100% zoom, on pages rotated 0/90/180/270
// (and on a page whose box has a negative origin).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Document } from "../../src/bindings/Document";
import type { PageObject } from "../../src/bindings/PageObject";
import type { Rotation } from "../../src/bindings/Rotation";
import { cli, fixturesDir, repoRoot } from "../unit/cli";

type Kind = "highlight" | "rect" | "ellipse" | "arrow" | "text" | "signature";
const KINDS: Kind[] = ["highlight", "rect", "ellipse", "arrow", "text", "signature"];
const TOLERANCE_PX = 1;

const outDir = join(repoRoot, "out", "m0", "match");

/** One object of `kind`, placed for a page with box origin (ox, oy) and display rotation r. */
function makeObject(kind: Kind, ox: number, oy: number, r: Rotation): PageObject {
  const P = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const R = (x0: number, y0: number, x1: number, y1: number) => ({ x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1 });
  switch (kind) {
    case "highlight":
      return { type: "highlight", id: "h", quads: [[P(100, 640), P(300, 640), P(100, 600), P(300, 600)]], color: [1, 0.92, 0.23], opacity: 0.4 };
    case "rect":
      return { type: "rect", id: "r", rect: R(120, 300, 320, 450), stroke: [0.85, 0.1, 0.1], strokeWidth: 4, fill: null, opacity: 1 };
    case "ellipse":
      return { type: "ellipse", id: "e", rect: R(150, 200, 400, 330), stroke: [0.1, 0.5, 0.2], strokeWidth: 3, fill: [0.75, 0.95, 0.75], opacity: 1 };
    case "arrow":
      return { type: "line", id: "a", from: P(100, 150), to: P(400, 260), stroke: [0.1, 0.3, 0.9], strokeWidth: 3, arrow: true, opacity: 1 };
    case "text":
      return { type: "text", id: "t", origin: P(140, 520), rotation: r, fontSize: 20, color: [0.05, 0.05, 0.3], lines: ["화면 일치 검사 Text", "둘째 줄 123"] };
    case "signature":
      return {
        type: "signature",
        id: "s",
        signatureId: "sig-demo",
        rect: r === 0 || r === 180 ? R(300, 80, 480, 140) : R(300, 80, 360, 260),
        rotation: r,
      };
  }
}

/** Source pages: rotated.pdf p1..p4 (0/90/180/270) and cropbox.pdf p2 (negative origin). */
function baseModel(): Document {
  const m = cli<Document>(["model", join(fixturesDir, "rotated.pdf"), join(fixturesDir, "cropbox.pdf")]);
  const keep = [0, 1, 2, 3, 6]; // rotated p1-p4, cropbox p2
  m.pages = keep.map((i) => m.pages[i]);
  return m;
}

type Row = { kind: Kind; page: number; rotation: number; overlay: unknown; exported: unknown; maxDiff: number };
const rows: Row[] = [];

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "results.json"), JSON.stringify(rows, null, 2));
});

test("renders out/m0_sample.pdf for review", async ({ page }) => {
  const samplePdf = join(repoRoot, "out", "m0_sample.pdf");
  cli([
    "export",
    "--model", join(fixturesDir, "m0_sample.model.json"),
    "--out", samplePdf,
    "--signatures", join(fixturesDir, "signatures"),
  ]);
  await page.goto("/");
  const images = await page.evaluate(async () => {
    const modPath = "/src/viewer/pdfjs.ts";
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      openPdf(d: Uint8Array): Promise<{ numPages: number; loadingTask: { destroy(): Promise<void> } }>;
      renderPage(doc: unknown, n: number, c: HTMLCanvasElement, s: number): Promise<void>;
    };
    const bytes = new Uint8Array(await (await fetch("/__out/m0_sample.pdf")).arrayBuffer());
    const doc = await mod.openPdf(bytes);
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const c = document.createElement("canvas");
      await mod.renderPage(doc, n, c, 1);
      out.push(c.toDataURL("image/png"));
    }
    await doc.loadingTask.destroy();
    return out;
  });
  expect(images.length).toBe(2);
  images.forEach((url, i) =>
    writeFileSync(join(repoRoot, "out", "m0", `m0_sample_p${i + 1}_pdfjs.png`), Buffer.from(url.split(",")[1], "base64")),
  );
});

for (const kind of KINDS) {
  test(`screen match: ${kind}`, async ({ page }) => {
    mkdirSync(outDir, { recursive: true });
    const model = baseModel();
    model.pages.forEach((p, i) => {
      const r = ((p.baseRotation + p.userRotation) % 360) as Rotation;
      // Object ids are unique in a document (the core refuses duplicates, M3).
      p.objects = [{ ...makeObject(kind, p.box.x0, p.box.y0, r), id: `${kind}-${i}` }];
    });
    const modelPath = join(outDir, `${kind}.json`);
    const pdfPath = join(outDir, `${kind}.pdf`);
    writeFileSync(modelPath, JSON.stringify(model, null, 2));
    cli(["export", "--model", modelPath, "--out", pdfPath, "--signatures", join(fixturesDir, "signatures")]);

    await page.goto("/");
    const sourceUrls: Record<string, string> = {};
    for (const s of model.sources) sourceUrls[s.id] = `/__fixtures/${s.path.split(/[\\/]/).pop()}`;

    for (let i = 0; i < model.pages.length; i++) {
      const p = model.pages[i];
      const rotation = ((p.baseRotation + p.userRotation) % 360) as Rotation;
      const result = await page.evaluate(
        async (a) => {
          const modPath = "/src/devtools/screenMatch.ts";
          const mod = (await import(/* @vite-ignore */ modPath)) as {
            measurePage: (x: typeof a) => Promise<{
              overlay: { x0: number; y0: number; x1: number; y1: number } | null;
              exported: { x0: number; y0: number; x1: number; y1: number } | null;
              images: { overlay: string; exported: string };
            }>;
          };
          return mod.measurePage(a);
        },
        {
          sourceUrl: sourceUrls[p.sourceId],
          sourcePage: p.pageIndex + 1,
          exportedUrl: `/__out/m0/match/${kind}.pdf`,
          exportedPage: i + 1,
          box: p.box,
          rotation,
          objects: p.objects,
          signatureUrls: { "sig-demo": "/__fixtures/signatures/sig-demo.png" },
        },
      );
      for (const [name, url] of Object.entries(result.images)) {
        writeFileSync(join(outDir, `${kind}_p${i + 1}_${name}.png`), Buffer.from(url.split(",")[1], "base64"));
      }
      expect(result.overlay, `${kind} p${i + 1}: overlay drew nothing`).not.toBeNull();
      expect(result.exported, `${kind} p${i + 1}: export drew nothing`).not.toBeNull();
      const o = result.overlay!;
      const e = result.exported!;
      const maxDiff = Math.max(Math.abs(o.x0 - e.x0), Math.abs(o.y0 - e.y0), Math.abs(o.x1 - e.x1), Math.abs(o.y1 - e.y1));
      rows.push({ kind, page: i + 1, rotation, overlay: o, exported: e, maxDiff });
      expect.soft(maxDiff, `${kind} p${i + 1} rot ${rotation}: overlay ${JSON.stringify(o)} vs export ${JSON.stringify(e)}`).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });
}
