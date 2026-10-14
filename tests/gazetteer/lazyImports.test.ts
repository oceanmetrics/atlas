// GATE (gazetteer-places): hyparquet, the vendored client and everything that reaches them
// (src/lib/gazetteer/resolve.ts) are lazy chunks. `scripts/size-budget-core.mjs` forbids "hyparquet"
// in index.html's static graph at build time; this is the source-level twin, which also holds the
// rule for entries the budget does not walk (report.html). Only `import type` (erased) and
// `import("...")` may name resolve.ts or the vendor folder from outside src/lib/gazetteer/.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
const gazDir = join(srcDir, "lib", "gazetteer") + sep;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

const staticImportsOf = (src: string): string[] =>
  [
    ...src.matchAll(
      /(?:^|\n)\s*(?:import|export)\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

const LAZY = (spec: string) =>
  /gazetteer\/(resolve|vendor\/)/.test(spec) || /^hyparquet(-compressors)?$/.test(spec);

const files = walk(srcDir).map((p) => [p, readFileSync(p, "utf8")] as const);

describe("hyparquet and the vendored gazetteer client are dynamic imports only", () => {
  it("walks real source (an empty walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const [file, src] of files) {
    if (file.startsWith(gazDir)) continue;
    it(`${file.slice(srcDir.length)} has no static import of the lazy gazetteer modules`, () => {
      expect(staticImportsOf(src).filter(LAZY)).toEqual([]);
    });
  }

  it("config.ts (the static-safe half) imports nothing lazy", () => {
    const src = readFileSync(join(gazDir, "config.ts"), "utf8");
    expect(staticImportsOf(src)).toEqual([]);
  });

  it("the consumers reach resolve.ts dynamically", () => {
    for (const rel of ["places/placesMap.svelte.ts", "places/Places.svelte"]) {
      const src = readFileSync(join(srcDir, rel), "utf8");
      expect(
        dynamicImportsOf(src).some((s) => s.endsWith("gazetteer/resolve")),
        rel,
      ).toBe(true);
    }
  });

  it("SEEDED FAULT: the same scan flags a static import", () => {
    const seeded = 'import { resolveGazPlace } from "../lib/gazetteer/resolve";\n';
    expect(staticImportsOf(seeded).filter(LAZY)).toHaveLength(1);
    expect(
      staticImportsOf('import type { X } from "../lib/gazetteer/resolve";\n').filter(LAZY),
    ).toEqual([]);
  });
});
