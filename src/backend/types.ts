import type { Document } from "../bindings/Document";
import type { ExportSummary } from "../bindings/ExportSummary";
import type { SourceInfo } from "../bindings/SourceInfo";

export type OpenedSource = {
  sourceId: string;
  path: string;
  /** File name for display. */
  name: string;
  info: SourceInfo;
};

/** A file chosen in the open dialog or dropped on the window. */
export type PickedFile = { path: string; name: string };

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
  onFileDrop(cb: (files: PickedFile[]) => void): Promise<() => void>;
  /** Shows the open-file dialog. Returns null when cancelled. */
  pickFiles(): Promise<PickedFile[] | null>;
  /** Shows the save dialog (PDF filter). Returns null when cancelled. */
  pickSavePath(defaultPath: string): Promise<string | null>;
  /**
   * Writes the model to a new PDF (SPEC 6.9). Passwords of encrypted sources go by source id
   * and stay in memory. Rejects with `output_is_source` for a source path.
   */
  exportDocument(model: Document, outPath: string, passwords: Record<string, string>): Promise<ExportSummary>;
  /**
   * Guards closing the window: when `isDirty()` is true the close waits for `confirm()` and
   * is cancelled when it resolves false. Returns an unsubscribe function.
   */
  onCloseRequested(guard: { isDirty: () => boolean; confirm: () => Promise<boolean> }): Promise<() => void>;
  /** M0 measurement hook (see src-tauri `bench_config`). */
  benchConfig(): Promise<string | null>;
  benchReport(report: string): Promise<void>;
}
