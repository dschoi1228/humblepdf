// Builds the debug CLI once before any test runs, so a cold build (CI has no build
// cache) is not counted against a single test's timeout.
import { cliPath } from "./cli";

export default function globalSetup() {
  cliPath();
}
