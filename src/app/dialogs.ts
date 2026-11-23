// Open state of the help and About dialogs (M7).
import { create } from "zustand";

export const useInfoDialogs = create<{ help: boolean; about: boolean }>(() => ({ help: false, about: false }));
