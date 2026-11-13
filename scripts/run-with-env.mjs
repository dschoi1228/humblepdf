// Cross-platform `KEY=VALUE ... -- command args...` (no bash, no extra dependency).
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
if (sep < 1 || sep === args.length - 1) {
  console.error("usage: node scripts/run-with-env.mjs KEY=VALUE [...] -- command [args...]");
  process.exit(2);
}
const env = { ...process.env };
for (const pair of args.slice(0, sep)) {
  const i = pair.indexOf("=");
  env[pair.slice(0, i)] = pair.slice(i + 1);
}
const [cmd, ...rest] = args.slice(sep + 1);
const r = spawnSync(cmd, rest, { stdio: "inherit", env });
process.exit(r.status ?? 1);
