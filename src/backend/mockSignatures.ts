// Browser-mode signature library (D30): kept in memory for the page's lifetime. Images
// are converted to PNG with a canvas and reduced to MAX_SIDE like the core does; the
// core's normalization itself is checked by `cargo test`. `?signatures=url1,url2` adds
// images at start (E2E tests, demos).
import type { BackendError, PickedFile, SignatureMeta } from "./types";

const MAX_SIDE = 2000;
const store = new Map<string, { meta: SignatureMeta; png: Uint8Array }>();
let nextId = 0;
let seeded: Promise<void> | null = null;

const fail = (code: string, message: string): BackendError => ({ code, message });

async function toPng(bytes: Uint8Array): Promise<{ png: Uint8Array; width: number; height: number }> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) throw fail("unknown_format", "not a PNG or JPEG");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: "from-image" });
  } catch (e) {
    throw fail("invalid_image", String(e));
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(fail("invalid_image", "encode"))), "image/png"),
  );
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n || [...n].length > 100) throw fail("invalid_name", "the name must have 1 to 100 characters");
  return n;
}

function entry(id: string) {
  const e = store.get(id);
  if (!e) throw fail("unknown_signature", "no such signature");
  return e;
}

export async function mockSignatureAdd(file: PickedFile, name: string): Promise<SignatureMeta> {
  const clean = cleanName(name);
  const res = await fetch(file.path);
  if (!res.ok) throw fail("io", `cannot read ${file.name}`);
  const { png, width, height } = await toPng(new Uint8Array(await res.arrayBuffer()));
  const meta: SignatureMeta = { id: `sg-mock-${++nextId}`, name: clean, width, height, added: Math.floor(Date.now() / 1000) };
  store.set(meta.id, { meta, png });
  return meta;
}

function seed(): Promise<void> {
  seeded ??= (async () => {
    const urls = new URLSearchParams(window.location.search).get("signatures");
    for (const url of urls ? urls.split(",") : []) {
      const name = decodeURIComponent(url.split("/").pop() ?? "signature").replace(/\.\w+$/, "");
      await mockSignatureAdd({ path: url, name }, name);
    }
  })();
  return seeded;
}

export async function mockSignatureList(): Promise<SignatureMeta[]> {
  await seed();
  return [...store.values()].map((e) => e.meta);
}

export async function mockSignatureRename(id: string, name: string): Promise<SignatureMeta> {
  const e = entry(id);
  e.meta = { ...e.meta, name: cleanName(name) };
  return e.meta;
}

export async function mockSignatureDelete(id: string): Promise<void> {
  entry(id);
  store.delete(id);
}

export async function mockSignatureBytes(id: string): Promise<Uint8Array> {
  return entry(id).png.slice();
}

/** PNGs of the signatures `ids` as base64, for the dev server's export route. */
export function mockSignatureFiles(ids: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const e = store.get(id);
    if (!e) continue;
    let bin = "";
    for (let i = 0; i < e.png.length; i += 0x8000) bin += String.fromCharCode(...e.png.subarray(i, i + 0x8000));
    out[id] = btoa(bin);
  }
  return out;
}
