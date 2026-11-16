// Types of the test hooks the app exposes on `window` (defined in src/viewer/testHooks.ts).
import type { ViewerHooks } from "../../src/viewer/testHooks";

declare global {
  interface Window {
    __viewer?: ViewerHooks;
  }
}
