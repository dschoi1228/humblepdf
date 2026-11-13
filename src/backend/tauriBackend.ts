import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { baseName } from "../state/model";
import { ko } from "../strings/ko";
import type { Backend, OpenedSource, PickedFile } from "./types";

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
      filters: [{ name: ko.fileFilterName, extensions: ["pdf", "jpg", "jpeg", "png"] }],
    });
    if (r === null) return null;
    return toPicked(Array.isArray(r) ? r : [r]);
  },

  benchConfig() {
    return invoke<string | null>("bench_config");
  },

  benchReport(report) {
    return invoke("bench_report", { report });
  },
};
