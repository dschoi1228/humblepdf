// Signature library state in the frontend (SPEC 6.8, D30, D31): the list from the backend,
// the signature the signature tool places, and blob URLs of the stored PNGs for drawing.
import { create } from "zustand";
import { backend } from "../backend";
import type { BackendError, PickedFile, SignatureMeta } from "../backend/types";
import { useDocumentStore } from "../state/documentStore";
import { signaturePages } from "./usage";

type State = {
  list: SignatureMeta[];
  loaded: boolean;
  /** The signature the signature tool places. */
  current: string | null;
  urls: Record<string, string>;
  /** Signatures whose image could not be loaded (deleted from the library). */
  failed: Record<string, true>;
  dialogOpen: boolean;

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

  load: async () => {
    const list = await backend.signatureList();
    set((s) => ({ list, loaded: true, current: s.current && list.some((x) => x.id === s.current) ? s.current : (list[0]?.id ?? null) }));
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
      return { list, urls, current: s.current === id ? (list[0]?.id ?? null) : s.current };
    });
  },
  setCurrent: (current) => set({ current }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
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
