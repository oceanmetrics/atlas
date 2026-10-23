#!/usr/bin/env node
// Usage: VITE_INSTANCE=<id> node scripts/check-ga.mjs [distDir=dist] [--id G-XXXXXXXXXX]
// (no --id, or an empty one: no measurement id may be anywhere in the build)
import { checkGa } from "./check-ga-core.mjs";
import { readInstance } from "./instance.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--id");
const id = (i >= 0 ? (args[i + 1] ?? "") : "").trim();
const distDir = args[0] && !args[0].startsWith("--") ? args[0] : "dist";
const instance = readInstance();
const problems = checkGa(distDir, id, { loader: instance.nav !== false });

if (problems.length) {
  process.stderr.write(`check-ga: FAIL (instance ${instance.id}, "${distDir}"):\n`);
  for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
  process.exit(1);
}
process.stdout.write(
  `check-ga: PASS (instance ${instance.id}) — ${id ? `id ${id} in the build, no gtag.js script tag in any page` : "analytics off: no id, no script tag"}\n`,
);
