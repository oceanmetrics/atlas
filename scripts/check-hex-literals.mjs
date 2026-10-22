#!/usr/bin/env node
// Usage: node scripts/check-hex-literals.mjs [repoRoot=.]
// atlas-3: no hex color literal outside an instance's tokens.css (instances/<id>/tokens.css). Seeded fault: put one back into
// a mockup stylesheet and this goes red, naming the file and line.
import { findHexLiterals, SCAN_ROOTS, TOKENS_FILE } from "./check-hex-literals-core.mjs";

const root = process.argv[2] ?? ".";
const hits = findHexLiterals(root);

if (hits.length) {
  process.stderr.write(`check-hex-literals: FAIL — ${hits.length} problem(s):\n`);
  for (const h of hits) {
    process.stderr.write(`  ✗ ${h.path}:${h.line} ${h.match} — ${h.reason}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `check-hex-literals: PASS — no color literal under ${SCAN_ROOTS.join(", ")} outside instances/*/tokens.css (the selected one: ${TOKENS_FILE})\n`,
);
