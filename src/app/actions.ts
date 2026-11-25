import { toast } from "sonner";
import { create } from "zustand";
import { backend } from "../backend";
import type { PickedFile } from "../backend/types";
import { openFiles } from "../files/addFiles";
import { useDocumentStore } from "../state/documentStore";
import { restoredCount } from "../state/model";
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
  if (opened.length) {
    useDocumentStore.getState().addOpened(opened);
    const restored = restoredCount(opened);
    if (restored) toast.info(strings().restored(restored));
  }
  return opened.length;
}

export type IncomingChoice = "add" | "window" | "cancel";
type IncomingPrompt = { names: string[]; resolve: (c: IncomingChoice) => void };

/** The question shown when files arrive from a second launch and the document has pages. */
export const useIncomingPrompt = create<{ pending: IncomingPrompt | null }>(() => ({ pending: null }));

function askIncoming(names: string[]): Promise<IncomingChoice> {
  return new Promise((resolve) => {
    useIncomingPrompt.getState().pending?.resolve("cancel");
    useIncomingPrompt.setState({
      pending: {
        names,
        resolve: (c) => {
          useIncomingPrompt.setState({ pending: null });
          resolve(c);
        },
      },
    });
  });
}

/**
 * Files from a second launch (D46): an empty window opens them; otherwise the user chooses
 * between adding them to this document and opening them in a new window.
 */
export async function openIncoming(files: PickedFile[]): Promise<void> {
  if (!files.length) return;
  if (!useDocumentStore.getState().doc.pages.length) {
    await addFiles(files);
    return;
  }
  const choice = await askIncoming(files.map((f) => f.name));
  if (choice === "add") await addFiles(files);
  else if (choice === "window") await backend.openWindow(files.map((f) => f.path));
}

export async function pickAndAddFiles(): Promise<void> {
  const files = await backend.pickFiles();
  if (files?.length) await addFiles(files);
}
