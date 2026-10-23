// Wiring gate: "d3-hierarchy reachable only dynamically" (Treemap.svelte, plan atlas-3 step 2b;
// size-budget-core.mjs's FORBIDDEN_LAZY_MARKERS already lists "treemap" for the general case).
//
// This is a SOURCE-level scan, not a build-output one, on purpose. Measured against a real build
// (`vite build` of a fixture importing d3-hierarchy the exact way Treemap.svelte does -- only
// `hierarchy()` and `.sum()`): the compiled output contains neither "d3-hierarchy" nor "treemap" as
// literal text once tree-shaken, AND Rollup inlines a statically-imported module this small
// directly into the entry chunk with no separate manifest entry at all (confirmed: an
// INEFFECTIVE_DYNAMIC_IMPORT warning, no distinguishing manifest key either). No build-output
// signal reliably catches a static import of it, so scripts/size-budget-core.mjs's content/marker
// scan cannot be the gate for this one dependency -- this SOURCE scan is (same pattern as
// tests/raster/ramps.wiring.test.ts's "no second ramp defined outside ramps.ts").
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// a static ESM binding to d3-hierarchy: `import ... from "d3-hierarchy"` or a re-export
// (`export ... from "d3-hierarchy"`). Deliberately requires the `from` keyword, which a dynamic
// `import("d3-hierarchy")` CALL never has -- that is exactly what keeps the two syntactically
// distinguishable by a plain regex, with no need to parse the file.
const STATIC_IMPORT_RE = /^\s*(?:import|export)\b[^;\n]*\bfrom\s+["']d3-hierarchy["']/m;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']d3-hierarchy["']\s*\)/;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function findStaticD3HierarchyImports(rootDir: string): { path: string; line: number }[] {
  const hits: { path: string; line: number }[] = [];
  for (const file of walk(join(rootDir, "src"))) {
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    content.split("\n").forEach((text, i) => {
      if (STATIC_IMPORT_RE.test(text)) {
        hits.push({ path: relative(rootDir, file), line: i + 1 });
      }
    });
  }
  return hits;
}

export function findDynamicD3HierarchyImports(rootDir: string): string[] {
  const hits: string[] = [];
  for (const file of walk(join(rootDir, "src"))) {
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    if (DYNAMIC_IMPORT_RE.test(readFileSync(file, "utf8"))) {
      hits.push(relative(rootDir, file));
    }
  }
  return hits;
}

describe("d3-hierarchy is reachable only through a dynamic import()", () => {
  it("no file under src/ statically imports d3-hierarchy", () => {
    expect(findStaticD3HierarchyImports(REPO_ROOT)).toEqual([]);
  });

  it("at least one file DOES dynamically import it (the gate is not vacuous -- someone actually uses it)", () => {
    const hits = findDynamicD3HierarchyImports(REPO_ROOT);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain(join("src", "lib", "ui", "Treemap.svelte"));
  });
});

describe("findStaticD3HierarchyImports — seeded fault (a static import planted elsewhere)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-treemap-wiring-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  it("goes RED on a plain static import", () => {
    const root = makeFixtureRoot({
      "src/lib/rogue.ts": `import { hierarchy } from "d3-hierarchy";\nexport { hierarchy };\n`,
    });
    const hits = findStaticD3HierarchyImports(root);
    expect(hits).toEqual([{ path: join("src", "lib", "rogue.ts"), line: 1 }]);
  });

  it("goes RED on a static re-export", () => {
    const root = makeFixtureRoot({
      "src/lib/rogue.ts": `export { hierarchy } from "d3-hierarchy";\n`,
    });
    expect(findStaticD3HierarchyImports(root).length).toBe(1);
  });

  it("goes RED on a namespace import", () => {
    const root = makeFixtureRoot({
      "src/lib/rogue.ts": `import * as d3h from "d3-hierarchy";\nvoid d3h;\n`,
    });
    expect(findStaticD3HierarchyImports(root).length).toBe(1);
  });

  it("stays GREEN for a genuine dynamic import() (not flagged as static)", () => {
    const root = makeFixtureRoot({
      "src/lib/ok.ts": `export async function f() { const { hierarchy } = await import("d3-hierarchy"); return hierarchy; }\n`,
    });
    expect(findStaticD3HierarchyImports(root)).toEqual([]);
  });

  it("stays GREEN for an unrelated import", () => {
    const root = makeFixtureRoot({
      "src/lib/ok.ts": `import { hierarchy } from "some-other-package";\nvoid hierarchy;\n`,
    });
    expect(findStaticD3HierarchyImports(root)).toEqual([]);
  });
});
