#!/usr/bin/env node
// Usage: node scripts/check-dist-session.mjs [distDir=dist]
import { findSessionJsonFiles } from "./check-dist-session-core.mjs";

const distDir = process.argv[2] ?? "dist";
const hits = findSessionJsonFiles(distDir);

if (hits.length) {
  process.stderr.write(
    `check-dist-session: FAIL — session.json found under "${distDir}" (recursively). That file must ` +
      `only ever be answered by the preview host's Caddy (plan D6); its presence anywhere in the public ` +
      `build would switch the app into preview mode for everyone:\n`,
  );
  for (const h of hits) process.stderr.write(`  ✗ ${h}\n`);
  process.exit(1);
}

process.stdout.write(`check-dist-session: PASS — no session.json anywhere under "${distDir}"\n`);
