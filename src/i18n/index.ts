// UI language (D27). Dictionaries are plain objects; the current language lives in a small
// store so components re-render when it changes. Non-component code calls `strings()`.
import { create } from "zustand";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import type { Strings } from "./types";

export type { Strings } from "./types";

export type Locale = "ko" | "en" | "ja";
export const LOCALES: readonly Locale[] = ["ko", "en", "ja"];
/** Each language named in itself; not translated. */
export const LOCALE_NAMES: Record<Locale, string> = { ko: "한국어", en: "English", ja: "日本語" };
export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, Strings> = { ko, en, ja };
const STORAGE_KEY = "pdf-editor.locale";

/** First supported language in the preference list (`navigator.languages`), else English. */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return DEFAULT_LOCALE;
}

function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

function storedLocale(): Locale | null {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function initialLocale(): Locale {
  const nav = globalThis.navigator;
  const preferred = nav ? (nav.languages?.length ? nav.languages : [nav.language]) : [];
  return storedLocale() ?? detectLocale(preferred);
}

type LocaleState = { locale: Locale; setLocale: (l: Locale) => void };

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // The choice still applies to this session.
    }
    set({ locale });
  },
}));

export function dictionary(locale: Locale): Strings {
  return DICTIONARIES[locale];
}

/** Strings of the current language, for code outside React components. */
export function strings(): Strings {
  return DICTIONARIES[useLocaleStore.getState().locale];
}

/** Strings of the current language; the component re-renders when the language changes. */
export function useStrings(): Strings {
  return DICTIONARIES[useLocaleStore((s) => s.locale)];
}

export function errorMessage(code: string): string {
  const errors = strings().errors as Record<string, string>;
  return errors[code] ?? errors.generic;
}
