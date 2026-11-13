// Adding files (SPEC 6.1): name order, password prompts, errors that do not stop the rest.
import type { Backend, PickedFile } from "../backend/types";
import { isBackendError } from "../backend/types";
import { compareFileNames, type OpenedEntry } from "../state/model";

export type AddFilesDeps = {
  backend: Pick<Backend, "openSource">;
  /**
   * Asks for a password. `wrong` is true when the previous attempt was rejected.
   * Resolves to null when the user cancels.
   */
  promptPassword: (fileName: string, wrong: boolean) => Promise<string | null>;
  /** Called when a password given for a file was accepted (the prompt can close). */
  passwordAccepted?: () => void;
  /** Reports a file that could not be added. */
  notifyError: (fileName: string, code: string) => void;
};

/**
 * Opens the files in name order and returns those that could be opened, in that order.
 * A cancelled password prompt skips only that file.
 */
export async function openFiles(files: PickedFile[], deps: AddFilesDeps): Promise<OpenedEntry[]> {
  const sorted = [...files].sort((a, b) => compareFileNames(a.name, b.name));
  const opened: OpenedEntry[] = [];
  for (const f of sorted) {
    let password: string | undefined;
    for (;;) {
      try {
        const r = await deps.backend.openSource(f.path, password);
        opened.push({ sourceId: r.sourceId, path: r.path, name: f.name, info: r.info, password });
        if (password !== undefined) deps.passwordAccepted?.();
        break;
      } catch (e) {
        const code = isBackendError(e) ? e.code : "generic";
        if (code === "password_required" || code === "wrong_password") {
          const pw = await deps.promptPassword(f.name, password !== undefined);
          if (pw === null) break;
          password = pw;
          continue;
        }
        deps.notifyError(f.name, code);
        break;
      }
    }
  }
  return opened;
}
