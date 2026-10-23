// Wiring gate: "the report model is reachable only from `report.html`" (atlas-7 step 1's budget
// line: `index.html`'s static critical path must not move).
//
// WHY A SOURCE SCAN AND NOT `scripts/size-budget.mjs`. That checker walks exactly ONE manifest
// entry, and nothing in this repo ever passes `--entry` -- so it only ever measures `index.html`.
// It would therefore stay green whether or not the report model leaked into the map app, right up
// until the leak grew past 450 KB. This scan is the direct statement of the invariant: no module
// reachable from `src/main.ts`'s STATIC import graph may reach `src/lib/report/`.
//
// `src/lib/release/cite.ts` is deliberately NOT under `src/lib/report/` for this exact reason (see
// its own header): a lens may import it without dragging the report in.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** every `from "..."` / `export ... from "..."` specifier -- STATIC edges only. A dynamic
 * `import("...")` call has no `from` keyword, which is what keeps the two distinguishable without
 * a parser (same rule as tests/treemap-lazy-import.wiring.test.ts). */
const STATIC_FROM_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s+["']([^"']+)["']/g;

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // a bare package, never `src/`
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.js`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** the transitive STATIC import closure of an entry module, as repo-relative paths. */
export function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(REPO_ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    const rel = relative(REPO_ROOT, file);
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(STATIC_FROM_RE)) {
      const next = resolveSpecifier(file, m[1]);
      if (next) queue.push(next);
    }
  }
  return seen;
}

describe("src/lib/report/ is reachable only from report.html", () => {
  const mapApp = staticGraph("src/main.ts");

  it("the map app's static graph contains no report module", () => {
    const leaked = [...mapApp].filter((f) => f.startsWith(join("src", "lib", "report")));
    expect(leaked).toEqual([]);
  });

  it("the scan is not vacuous: it really did walk the map app", () => {
    // if the resolver silently returned nothing, the assertion above would pass over an empty set.
    expect(mapApp.size).toBeGreaterThan(50);
    expect(mapApp).toContain(join("src", "shell", "Shell.svelte"));
    expect(mapApp).toContain(join("src", "lib", "state", "codec.ts"));
  });

  it("goes RED for a module that IS in that graph", () => {
    // the control, using the same rule shape as the assertion above: `src/lib/state/` IS reachable
    // from the map app, so a ban on it would fail -- which is what proves the ban on
    // `src/lib/report/` is measuring reachability and not an always-empty filter.
    const wouldLeak = [...mapApp].filter((f) => f.startsWith(join("src", "lib", "state")));
    expect(wouldLeak.length).toBeGreaterThan(0);
  });

  it("the shared citation path is NOT under report/, so a lens can use it without the report", () => {
    expect(existsSync(join(REPO_ROOT, "src/lib/release/cite.ts"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "src/lib/report/cite.ts"))).toBe(false);
  });
});
