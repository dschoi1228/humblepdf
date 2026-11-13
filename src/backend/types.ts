import type { SourceInfo } from "../bindings/SourceInfo";

export type OpenedSource = {
  sourceId: string;
  path: string;
  info: SourceInfo;
};

/** Error shape returned by the backend: `{ code, message }`. */
export type BackendError = { code: string; message: string };

export function isBackendError(e: unknown): e is BackendError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

/**
 * All backend calls go through this interface (SPEC 3). The Tauri implementation
 * calls Rust commands; the mock implementation runs in a plain browser.
 */
export interface Backend {
  readonly kind: "tauri" | "mock";
  openSource(path: string, password?: string): Promise<OpenedSource>;
  /** Fresh bytes on every call: pdf.js takes ownership of the buffer it is given. */
  sourceBytes(sourceId: string): Promise<Uint8Array>;
  /** Registers a callback for files dropped onto the window. Returns an unsubscribe function. */
  onFileDrop(cb: (paths: string[]) => void): Promise<() => void>;
  /** Shows the open-file dialog. Returns null when cancelled. */
  pickFiles(): Promise<string[] | null>;
  /** M0 measurement hook (see src-tauri `bench_config`). */
  benchConfig(): Promise<string | null>;
  benchReport(report: string): Promise<void>;
}
