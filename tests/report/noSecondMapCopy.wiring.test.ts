// Wiring gate, fix round 1 (Opus review item 1): "no second copy" applies to the map exactly like
// it applies to ramps.ts/categories.ts/cite.ts/the SQL files (the phase's own review checklist,
// first line). `src/report/**` must never restate the basemap tile URL, construct a MapLibre
// instance directly, or hardcode a glyphs endpoint -- those are `lib/map/{layers/basemap,map,
// style}.ts`'s own facts, reused via `composeStyle()`/`createMap()` (see reportMap.ts's header).
// A restated copy WILL drift (a tile-URL or glyph-endpoint typo silently breaks only the report,
// or a real change to the shell's basemap silently stops applying to the report) -- this is a
// source-level, not a build-output, gate because none of these three strings survive minification
// in a way a content scan of the compiled bundle could reliably assert on.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORT_DIR = fileURLToPath(new URL("../../src/report", import.meta.url));

// case-insensitive: a restated basemap host, a hand-built MapLibre Map, or a hardcoded glyphs
// endpoint, however it is spelled.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /basemaps\.cartocdn\.com/i,
  /new\s+MapLibreMap\s*\(/,
  /tiles\.basemaps\.cartocdn\.com\/fonts/i, // the glyphs URL specifically (basemap tiles use a
  // DIFFERENT cartocdn host, `basemaps.` -- already caught above -- so this is not redundant)
];

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

export function findSecondMapCopies(rootDir: string): { path: string; pattern: string }[] {
  const hits: { path: string; pattern: string }[] = [];
  for (const file of walk(rootDir)) {
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(content)) hits.push({ path: relative(rootDir, file), pattern: re.source });
    }
  }
  return hits;
}

describe("src/report/** never restates the basemap URL, a MapLibre constructor call, or a glyphs endpoint", () => {
  it("finds nothing", () => {
    expect(findSecondMapCopies(REPORT_DIR)).toEqual([]);
  });

  it("SEEDED FAULT: a restated basemap host is caught", () => {
    const fixture = new Map([
      ["rogue.ts", 'const tiles = "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";'],
    ]);
    const hits: { path: string; pattern: string }[] = [];
    for (const [path, content] of fixture) {
      for (const re of FORBIDDEN_PATTERNS)
        if (re.test(content)) hits.push({ path, pattern: re.source });
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  it("SEEDED FAULT: a hand-built MapLibre Map() is caught", () => {
    const fixture = new Map([["rogue.ts", "const map = new MapLibreMap({ container });"]]);
    const hits: { path: string; pattern: string }[] = [];
    for (const [path, content] of fixture) {
      for (const re of FORBIDDEN_PATTERNS)
        if (re.test(content)) hits.push({ path, pattern: re.source });
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  it("SEEDED FAULT: a hardcoded glyphs endpoint is caught", () => {
    const fixture = new Map([
      ["rogue.ts", 'glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf"'],
    ]);
    const hits: { path: string; pattern: string }[] = [];
    for (const [path, content] of fixture) {
      for (const re of FORBIDDEN_PATTERNS)
        if (re.test(content)) hits.push({ path, pattern: re.source });
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});
