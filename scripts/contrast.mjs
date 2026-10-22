#!/usr/bin/env node
// Usage: node scripts/contrast.mjs [tokens.css=instances/<VITE_INSTANCE>/tokens.css]
// atlas-3 gate: text pairs >= 4.5:1, non-text pairs >= 3:1, in both themes (WCAG 2.1 AA, and the
// MMA guide's own Section 508 commitment). Seeded fault: assign --mma-gold to --text-accent in the
// paper theme and this goes red at 1.7:1.
import { readFileSync } from "node:fs";
import { checkContrast } from "./contrast-core.mjs";
import { instanceTokensCss } from "./instance.mjs";

const file = process.argv[2] ?? instanceTokensCss();
const { results, failures } = checkContrast(readFileSync(file, "utf8"));

for (const r of results) {
  const mark = r.ok ? "✓" : "✗";
  process.stdout.write(
    `  ${mark} [${r.theme}] ${r.kind.padEnd(7)} ${r.token} on ${r.surface}: ` +
      `${r.ratio.toFixed(2)}:1 (min ${r.min}:1)\n`,
  );
}

if (failures.length) {
  process.stderr.write(`contrast: FAIL — ${failures.length} problem(s) in "${file}":\n`);
  for (const f of failures) process.stderr.write(`  ✗ ${f}\n`);
  process.exit(1);
}

process.stdout.write(
  `contrast: PASS — ${results.length} token pairs across both themes meet WCAG 2.1 AA in "${file}"\n`,
);
