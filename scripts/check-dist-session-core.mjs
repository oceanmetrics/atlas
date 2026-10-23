// plan D6 / atlas-0 CI: dist/ must never contain a session.json — anywhere under it, not just at
// its root. That file existing same-origin is the ONLY thing that switches the app into preview
// mode (src/lib/release/session.ts); it must be answered exclusively by the preview host's Caddy,
// never shipped as part of the public build (a nested one, e.g. under a versioned app/ subtree,
// would flip preview mode on just as surely as one at dist/session.json).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SESSION_FILENAME = "session.json";

/** every path under `distDir` (recursively) named exactly `session.json`. */
export function findSessionJsonFiles(distDir) {
  if (!existsSync(distDir)) return [];

  const hits = [];
  const stack = [distDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        stack.push(p);
      } else if (entry === SESSION_FILENAME) {
        hits.push(p);
      }
    }
  }
  return hits;
}

export function distHasSessionJson(distDir) {
  return findSessionJsonFiles(distDir).length > 0;
}
