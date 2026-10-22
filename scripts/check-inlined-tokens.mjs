#!/usr/bin/env node
// Usage: node scripts/check-inlined-tokens.mjs [dist=dist] [tokensCss=instances/<VITE_INSTANCE>/tokens.css]
// atlas-3 step 3: proves index.html's inlined critical CSS carries tokens.css's ACTUAL values, not
// a hand-typed approximation of them (see check-inlined-tokens-core.mjs's header for how).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findInlinedTokenDrift } from "./check-inlined-tokens-core.mjs";
import { instanceTokensCss } from "./instance.mjs";

const dist = process.argv[2] ?? "dist";
const tokensCssPath = process.argv[3] ?? instanceTokensCss();

const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
const tokensCss = readFileSync(tokensCssPath, "utf8");

const drift = findInlinedTokenDrift(tokensCss, indexHtml);

if (drift.length) {
  process.stderr.write(`check-inlined-tokens: FAIL — ${drift.length} token(s) drifted:\n`);
  for (const d of drift) {
    process.stderr.write(
      `  ✗ [${d.theme}] ${d.token}: tokens.css says "${d.expected}", ${dist}/index.html says ` +
        `${d.actual === null ? "(missing)" : `"${d.actual}"`}\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(
  `check-inlined-tokens: PASS — every token.css value is present, unchanged, in ${dist}/index.html\n`,
);
