// Browser mode cannot compute image layouts (only the core does, SPEC 6.1). Before the
// E2E run, the CLI inspects the image fixtures and writes the results where the mock
// backend looks for them: out/e2e/info/<file name>.json.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, fixturesDir, repoRoot } from "../unit/cli";

export default function globalSetup() {
  const dir = join(repoRoot, "out", "e2e", "info");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(fixturesDir)) {
    if (!/\.(jpe?g|png)$/i.test(f)) continue;
    writeFileSync(join(dir, `${f}.json`), JSON.stringify(cli(["inspect", join(fixturesDir, f)])));
  }
}
