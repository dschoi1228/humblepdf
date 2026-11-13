import { create } from "zustand";

type Pending = {
  /** Changes on every request, so the form is reset. */
  id: number;
  fileName: string;
  wrong: boolean;
  /** An answer was given and is being checked; the dialog stays open meanwhile. */
  checking: boolean;
  resolve: (password: string | null) => void;
};

let nextId = 1;

type PasswordPromptState = {
  pending: Pending | null;
  /**
   * Shows the password dialog (or reuses the open one when asking again after a wrong
   * password). Resolves to null when the user skips the file.
   */
  request: (fileName: string, wrong: boolean) => Promise<string | null>;
  /** Submit (string) or skip (null). Submitting keeps the dialog open until `close`. */
  answer: (password: string | null) => void;
  /** Closes the dialog once the password was accepted. */
  close: () => void;
};

export const usePasswordPrompt = create<PasswordPromptState>((set, get) => ({
  pending: null,
  request: (fileName, wrong) =>
    new Promise((resolve) => {
      const prev = get().pending;
      if (prev && !prev.checking) prev.resolve(null);
      set({ pending: { id: nextId++, fileName, wrong, checking: false, resolve } });
    }),
  answer: (password) => {
    const p = get().pending;
    if (!p || p.checking) return;
    // Closing and reopening the dialog for a retry would race its exit animation.
    set({ pending: password === null ? null : { ...p, checking: true } });
    p.resolve(password);
  },
  close: () => set({ pending: null }),
}));
