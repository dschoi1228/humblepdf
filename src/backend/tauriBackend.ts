import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ExportSummary } from "../bindings/ExportSummary";
import { baseName } from "../state/model";
import { strings } from "../i18n";
import type { Backend, OpenedSource, PickedFile, SignatureMeta } from "./types";

const toPicked = (paths: string[]): PickedFile[] => paths.map((path) => ({ path, name: baseName(path) }));

export const tauriBackend: Backend = {
  kind: "tauri",

  openSource(path, password) {
    return invoke<OpenedSource>("open_source", { path, password: password ?? null });
  },

  async sourceBytes(sourceId) {
    // `tauri::ipc::Response` arrives as an ArrayBuffer, not JSON.
    const buf = await invoke<ArrayBuffer>("source_bytes", { sourceId });
    return new Uint8Array(buf);
  },

  async onFileDrop(cb) {
    return getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") cb(toPicked(event.payload.paths));
    });
  },

  async pickFiles() {
    const r = await open({
      multiple: true,
      filters: [{ name: strings().fileFilterName, extensions: ["pdf", "jpg", "jpeg", "png"] }],
    });
    if (r === null) return null;
    return toPicked(Array.isArray(r) ? r : [r]);
  },

  pickSavePath(defaultPath) {
    return save({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  },

  async showWindow() {
    const w = getCurrentWindow();
    await w.show();
    await w.setFocus();
  },

  startupFiles() {
    return invoke<string[]>("startup_files");
  },

  exportDocument(model, outPath, passwords, flatten = false) {
    return invoke<ExportSummary>("export_document", { model, outPath, passwords, flatten });
  },

  async printBytes(model, passwords) {
    return new Uint8Array(await invoke<ArrayBuffer>("print_document", { model, passwords }));
  },

  async onCloseRequested(guard) {
    // Tauri destroys the window after the handler unless preventDefault() was called.
    return getCurrentWindow().onCloseRequested(async (event) => {
      if (guard.isDirty() && !(await guard.confirm())) event.preventDefault();
    });
  },

  signatureList() {
    return invoke<SignatureMeta[]>("signature_list");
  },

  async pickSignatureFile() {
    const r = await open({
      multiple: false,
      filters: [{ name: strings().signatures.fileFilterName, extensions: ["png", "jpg", "jpeg"] }],
    });
    if (r === null || Array.isArray(r)) return null;
    return toPicked([r])[0];
  },

  signatureAdd(file, name, removeWhite) {
    return invoke<SignatureMeta>("signature_add", { path: file.path, name, removeWhite });
  },

  async signaturePreview(file, removeWhite) {
    // `tauri::ipc::Response` arrives as an ArrayBuffer.
    return new Uint8Array(await invoke<ArrayBuffer>("signature_preview", { path: file.path, removeWhite }));
  },

  signatureAddPng(png, name) {
    return invoke<SignatureMeta>("signature_add_png", { png: Array.from(png), name });
  },

  signatureRename(id, name) {
    return invoke<SignatureMeta>("signature_rename", { id, name });
  },

  signatureDelete(id) {
    return invoke<void>("signature_delete", { id });
  },

  async signatureBytes(id) {
    const buf = await invoke<ArrayBuffer>("signature_bytes", { id });
    return new Uint8Array(buf);
  },

  async fontBytes(name) {
    return new Uint8Array(await invoke<ArrayBuffer>("bundled_font", { name }));
  },

  async setTitle(title) {
    document.title = title;
    await getCurrentWindow().setTitle(title);
  },

  benchConfig() {
    return invoke<string | null>("bench_config");
  },

  benchReport(report) {
    return invoke("bench_report", { report });
  },
};
