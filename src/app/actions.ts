import { toast } from "sonner";
import { backend } from "../backend";
import type { PickedFile } from "../backend/types";
import { openFiles } from "../files/addFiles";
import { useDocumentStore } from "../state/documentStore";
import { usePasswordPrompt } from "../state/passwordPrompt";
import { errorMessage, strings } from "../i18n";

/** Opens the files (name order, passwords, errors) and appends them to the document. */
export async function addFiles(files: PickedFile[]): Promise<number> {
  const opened = await openFiles(files, {
    backend,
    promptPassword: (name, wrong) => usePasswordPrompt.getState().request(name, wrong),
    passwordAccepted: () => usePasswordPrompt.getState().close(),
    notifyError: (name, code) => {
      usePasswordPrompt.getState().close();
      toast.error(strings().addFailed(name), { description: errorMessage(code) });
    },
  });
  if (opened.length) useDocumentStore.getState().addOpened(opened);
  return opened.length;
}

export async function pickAndAddFiles(): Promise<void> {
  const files = await backend.pickFiles();
  if (files?.length) await addFiles(files);
}
