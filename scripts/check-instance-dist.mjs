#!/usr/bin/env node
// Usage: VITE_INSTANCE=<id> node scripts/check-instance-dist.mjs [distDir=dist]
// The dist carries the modules the instance builds and none it does not (check-instance-dist-core.mjs).
import { instanceDistProblems } from "./check-instance-dist-core.mjs";
import { instanceId, loadInstance } from "./instance.mjs";

const distDir = process.argv[2] ?? "dist";
const id = instanceId();
const errs = instanceDistProblems(distDir, loadInstance(id));

if (errs.length) {
  process.stderr.write(`check-instance-dist: FAIL — "${distDir}" as the ${id} build:\n`);
  for (const e of errs) process.stderr.write(`  ✗ ${e}\n`);
  process.exit(1);
}
process.stdout.write(
  `check-instance-dist: PASS — "${distDir}" carries exactly the ${id} instance's modules\n`,
);
