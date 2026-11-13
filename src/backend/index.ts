import { mockBackend } from "./mockBackend";
import { tauriBackend } from "./tauriBackend";
import type { Backend } from "./types";

/** True inside the Tauri webview; false in a plain browser (browser mode). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const backend: Backend = isTauri() ? tauriBackend : mockBackend;

export type { Backend, BackendError, OpenedSource } from "./types";
export { isBackendError } from "./types";
