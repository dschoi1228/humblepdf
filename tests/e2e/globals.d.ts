// Types of the test hooks the app exposes on `window` (see src/App.tsx).
export {};

declare global {
  interface Window {
    __m0?: {
      status: "idle" | "loading" | "rendered" | "error";
      timing?: { openMs: number; bytesMs: number; renderMs: number; totalMs: number; bytes: number };
      error?: string;
    };
  }
}
