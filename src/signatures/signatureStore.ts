// Signature library state in the frontend (SPEC 6.8, D30, D31): the list from the backend,
// the signature the signature tool places, blob URLs of the stored PNGs for drawing, and
// the width each signature was last resized to (M15, D50; kept by preferencesSync).
import { create } from "zustand";
import { backend } from "../backend";
import type { BackendError, PickedFile, SignatureMeta } from "../backend/types";
import { useDocumentStore } from "../state/documentStore";
import { signaturePages } from "./usage";
import { MAX_SIGNATURE_WIDTHS } from "../state/preferences";

type State = {
  list: SignatureMeta[];
  loaded: boolean;
  /** The signature the signature tool places. */
  current: string | null;
  urls: Record<string, string>;
  /** Signatures whose image could not be loaded (deleted from the library). */
  failed: Record<string, true>;
  dialogOpen: boolean;
  /** Upright width (pt) a signature is placed at; 20% of the page when absent (D50). */
  widths: Record<string, number>;

  load: () => Promise<void>;
  /** Adds an image file, removing its white background unless `removeWhite` is null (D44). */
  add: (file: PickedFile, name: string, removeWhite?: number | null) => Promise<SignatureMeta>;
  /** Adds a drawn signature (PNG bytes). */
  addPng: (png: Uint8Array, name: string) => Promise<SignatureMeta>;
  rename: (id: string, name: string) => Promise<void>;
  /** Rejects with `{ code: "in_use", pages }` when the document places the signature. */
  remove: (id: string) => Promise<void>;
  setCurrent: (id: string) => void;
  openDialog: () => void;
  closeDialog: () => void;
  /** Remembers the width `id` was resized to, for the next placements. */
  rememberWidth: (id: string, width: number) => void;
  /** Starts loading the image of `id` once. */
  ensureUrl: (id: string) => void;
};

export type InUseError = BackendError & { pages: number[] };

const loading = new Set<string>();

export const useSignatureStore = create<State>((set, get) => ({
  list: [],
  loaded: false,
  current: null,
  urls: {},
  failed: {},
  dialogOpen: false,
  widths: {},

  load: async () => {
    const list = await backend.signatureList();
    set((s) => ({
      list,
      loaded: true,
      current: s.current && list.some((x) => x.id === s.current) ? s.current : (list[0]?.id ?? null),
      // Forget signatures that left the library while the app was closed.
      widths: Object.fromEntries(Object.entries(s.widths).filter(([id]) => list.some((x) => x.id === id))),
    }));
  },
  add: async (file, name, removeWhite = null) => {
    const meta = await backend.signatureAdd(file, name, removeWhite);
    set((s) => ({ list: [...s.list, meta], current: meta.id }));
    return meta;
  },
  addPng: async (png, name) => {
    const meta = await backend.signatureAddPng(png, name);
    set((s) => ({ list: [...s.list, meta], current: meta.id }));
    return meta;
  },
  rename: async (id, name) => {
    const meta = await backend.signatureRename(id, name);
    set((s) => ({ list: s.list.map((x) => (x.id === id ? meta : x)) }));
  },
  remove: async (id) => {
    const pages = signaturePages(useDocumentStore.getState().doc, id);
    if (pages.length) throw { code: "in_use", message: "placed in the document", pages } satisfies InUseError;
    await backend.signatureDelete(id);
    const url = get().urls[id];
    if (url) URL.revokeObjectURL(url);
    set((s) => {
      const list = s.list.filter((x) => x.id !== id);
      const urls = { ...s.urls };
      delete urls[id];
      const widths = { ...s.widths };
      delete widths[id];
      return { list, urls, widths, current: s.current === id ? (list[0]?.id ?? null) : s.current };
    });
  },
  setCurrent: (current) => set({ current }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  rememberWidth: (id, width) =>
    set((s) => {
      if (s.widths[id] === width) return s;
      // Re-insert so the newest entry is last; drop the oldest past the limit.
      const rest = Object.entries(s.widths).filter(([k]) => k !== id);
      return { widths: Object.fromEntries([...rest, [id, width]].slice(-MAX_SIGNATURE_WIDTHS)) };
    }),
  ensureUrl: (id) => {
    const s = get();
    if (s.urls[id] || s.failed[id] || loading.has(id)) return;
    loading.add(id);
    backend
      .signatureBytes(id)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
        set((st) => ({ urls: { ...st.urls, [id]: url } }));
      })
      .catch(() => set((st) => ({ failed: { ...st.failed, [id]: true } })))
      .finally(() => loading.delete(id));
  },
}));
