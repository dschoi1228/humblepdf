// Browser-mode backend (SPEC 3). "Paths" are URLs: dev-server fixtures
// (/__fixtures/...) or blob: URLs of files chosen in the browser.
// - PDF page information comes from pdf.js, including password errors.
// - Image layout is computed only by the core (SPEC 6.1). The mock reads the core's
//   result from /__out/e2e/info/<file name>.json (written by the E2E setup with the
//   CLI); without it, images are reported as unsupported.
// - Saving posts the model to the dev-server route /__export, which runs the CLI (D26).
//   The save "dialog" is window.prompt; outputs go under /__out/.
import type { ExportSummary } from "../bindings/ExportSummary";
import type { PageInfo } from "../bindings/PageInfo";
import type { Rotation } from "../bindings/Rotation";
import type { SourceInfo } from "../bindings/SourceInfo";
import { baseName } from "../state/model";
import { strings } from "../i18n";
import { openPdf } from "../viewer/pdfjs";
import type { Backend, BackendError, OpenedSource, PickedFile } from "./types";
import {
  mockSignatureAdd,
  mockSignatureAddPng,
  mockSignaturePreview,
  mockSignatureBytes,
  mockSignatureDelete,
  mockSignatureFiles,
  mockSignatureList,
  mockSignatureRename,
} from "./mockSignatures";

const sources = new Map<string, string>();
let nextId = 1;

/** File names of blob URLs created by `pickFiles`/drop, for messages and info lookup. */
const blobNames = new Map<string, string>();

const fail = (code: string, message: string): BackendError => ({ code, message });

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw fail("io", `cannot fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function detect(bytes: Uint8Array): "pdf" | "image" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-") ? "pdf" : null;
}

/** Options kept per opened source: the password and whether objects were restored. */
const sourceOptions = new Map<string, { password?: string; restored: boolean }>();

const fileBacked = (path: string) => path.startsWith("/__fixtures/") || path.startsWith("/__out/");

const query = (path: string, password?: string) =>
  new URLSearchParams({ path, ...(password !== undefined ? { password } : {}) }).toString();

/** The core's view of a file under /__fixtures/ or /__out/ (dev server, D36); null if unavailable. */
async function coreInfo(path: string, password?: string): Promise<SourceInfo | null> {
  const res = await fetch(`/__inspect?${query(path, password)}`);
  return res.ok ? ((await res.json()) as SourceInfo) : null;
}

function nameOf(path: string): string {
  return blobNames.get(path) ?? baseName(path);
}

async function pdfInfo(bytes: Uint8Array, password?: string): Promise<SourceInfo> {
  let doc;
  try {
    doc = await openPdf(bytes, password);
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") {
      throw fail(password === undefined ? "password_required" : "wrong_password", "password");

    }
    throw fail("unreadable_pdf", String((e as Error)?.message ?? e));
  }
  try {
    const pages: PageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [x0, y0, x1, y1] = page.view;
      pages.push({ pageIndex: i - 1, box: { x0, y0, x1, y1 }, baseRotation: page.rotate as Rotation, objects: [] });
    }
    return { kind: "pdf", pages, encrypted: password !== undefined, image: null };
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function imageInfo(name: string): Promise<SourceInfo> {
  const res = await fetch(`/__out/e2e/info/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw fail("unsupported", "browser mode needs the core's image layout");
  return (await res.json()) as SourceInfo;
}

function pickWithInput(accept = ".pdf,.jpg,.jpeg,.png", multiple = true): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = () => resolve(input.files?.length ? filesToPicked([...input.files]) : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function filesToPicked(files: File[]): PickedFile[] {
  return files.map((f) => {
    const path = URL.createObjectURL(f);
    blobNames.set(path, f.name);
    return { path, name: f.name };
  });
}

export const mockBackend: Backend = {
  kind: "mock",

  async openSource(path, password) {
    const bytes = await fetchBytes(path);
    const name = nameOf(path);
    const kind = detect(bytes);
    if (kind === null) throw fail("unknown_format", "not a PDF, JPEG or PNG");
    const info = kind === "pdf" ? await pdfInfo(bytes, password) : await imageInfo(name);
    // Files the dev server can read also get the core's restored objects (SPEC 7.7, D36).
    let restored = false;
    if (kind === "pdf" && fileBacked(path)) {
      const core = await coreInfo(path, password);
      if (core) {
        info.pages.forEach((p, i) => (p.objects = core.pages[i]?.objects ?? []));
        restored = info.pages.some((p) => p.objects.length > 0);
      }
    }
    const sourceId = `m${nextId++}`;
    sources.set(sourceId, path);
    sourceOptions.set(sourceId, { password, restored });
    const opened: OpenedSource = { sourceId, path, name, info };
    return opened;
  },

  async sourceBytes(sourceId) {
    const path = sources.get(sourceId);
    if (!path) throw fail("unknown_source", sourceId);
    // Without the annotations restored as objects, as the Tauri backend does.
    const opt = sourceOptions.get(sourceId);
    if (opt?.restored) return fetchBytes(`/__render?${query(path, opt.password)}`);
    return fetchBytes(path);
  },

  async onFileDrop(cb) {
    // Browser mode: HTML5 drop of File objects (the Tauri window uses the native handler).
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) cb(filesToPicked(files));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  },

  pickFiles: () => pickWithInput(),

  async pickSavePath(defaultPath) {
    // Never suggest writing into the fixtures folder.
    const suggested = defaultPath.startsWith("/__fixtures/") ? `/__out/saved/${baseName(defaultPath)}` : defaultPath;
    return window.prompt(strings().save.title, suggested);
  },

  async exportDocument(model, outPath, passwords, flatten = false) {
    const res = await fetch("/__export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        outPath,
        passwords,
        flatten,
        // The dev server writes these where the CLI's --signatures folder points.
        signatures: mockSignatureFiles(
          model.pages.flatMap((p) => p.objects.flatMap((o) => (o.type === "signature" ? [o.signatureId] : []))),
        ),
      }),
    });
    const body = (await res.json()) as unknown;
    if (!res.ok) throw body as BackendError;
    return body as ExportSummary;
  },

  async printBytes(model, passwords) {
    // Browser mode: the core writes a flattened export under out/ and the page reads it back.
    const path = `/__out/e2e/print/print-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    await this.exportDocument(model, path, passwords, true);
    const res = await fetch(path);
    if (!res.ok) throw { code: "internal", message: `cannot read ${path}` } satisfies BackendError;
    return new Uint8Array(await res.arrayBuffer());
  },

  async onCloseRequested(guard) {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (guard.isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },

  signatureList: mockSignatureList,
  async pickSignatureFile() {
    const files = await pickWithInput(".png,.jpg,.jpeg", false);
    return files?.[0] ?? null;
  },
  signatureAdd: mockSignatureAdd,
  signaturePreview: mockSignaturePreview,
  signatureAddPng: mockSignatureAddPng,
  signatureRename: mockSignatureRename,
  signatureDelete: mockSignatureDelete,
  signatureBytes: mockSignatureBytes,

  async fontBytes(name) {
    // Dev server only (/__fonts/ serves assets/fonts).
    return fetchBytes(name === "jp" ? "/__fonts/PretendardJP-Common.ttf" : "/__fonts/Pretendard-Regular.ttf");
  },

  async setTitle(title) {
    document.title = title;
  },

  async showWindow() {},

  async startupFiles() {
    // Browser-mode convenience: ?open=/__fixtures/a.pdf,/__fixtures/b.pdf
    const open = new URLSearchParams(window.location.search).get("open");
    return open ? open.split(",") : [];
  },

  async benchConfig() {
    return new URLSearchParams(window.location.search).get("bench");
  },

  async benchReport(report) {
    (window as unknown as { __benchReport?: string }).__benchReport = report;
    console.info(report);
  },
};
