// Wiring gate for raster/ramps.ts's module contract: "THE ONLY place a color ramp is defined." A
// hex-literal color (or an array of them) anywhere else under src/ is a sign that some other file is
// (re)defining a ramp/palette instead of importing ramps.ts. `src/lib/brand/**` is exempt — brand
// tokens are a SEPARATE, already-governed exception (scripts/check-hex-literals.mjs), not a ramp.
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

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HEX_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const BRAND_PREFIX = join("src", "lib", "brand"); // governed separately by check-hex-literals.mjs
// atlas-map: the map draws with a handful of colours that are neither a ramp nor a brand token —
// the `zone_style` table msens publishes (white/black/#d9d9d9 outlines), the `#ff00aa` selection,
// the `_outside_pra` mask's RGBA, and the two `--surface-map` values a WebGL background layer needs
// but cannot read from CSS. They are collected in ONE file, which this gate exempts by exact path
// (not by directory) — plus the ramp-shape assertion below, so the exception cannot become a place
// to hide a second palette.
const MAP_COLORS_FILE = join("src", "lib", "map", "colors.ts");
// U3 (round 2): the feedback annotator's own twin -- the three marker colours it draws directly
// onto a <canvas> 2D context (src/lib/feedback/colors.ts's own header), which does not read a CSS
// custom property either.
const FEEDBACK_COLORS_FILE = join("src", "lib", "feedback", "colors.ts");
// R3-W2: the Download menu's own twin -- `mapCapture.ts`'s canvas 2D context and `mapSvgExport.ts`'s
// plain SVG document each need a resolved fallback colour for the (rare) case their own
// `getComputedStyle` read comes back empty; neither reads a CSS custom property directly either
// (src/lib/download/colors.ts's own header).
const DOWNLOAD_COLORS_FILE = join("src", "lib", "download", "colors.ts");
/** an ARRAY of two or more hex stops is a ramp, whatever it is called — the shape the exempt file
 * may never contain. (A count ceiling would not do: the file legitimately holds ~8 unrelated
 * single-purpose colours, and a palette is exactly 11.) */
const RAMP_ARRAY_RE = /\[\s*"#[0-9a-fA-F]{3,8}"\s*(?:,\s*"#[0-9a-fA-F]{3,8}"\s*)+,?\s*\]/;
const RAMPS_FILE = join("src", "lib", "raster", "ramps.ts");
/** M2 fix (docs/usability.md): the one, NAMED, documented exception inside ramps.ts itself — a
 * fixed fallback ramp for a palette (Viridis/Cividis/Magma) no release publishes stops for.
 * Bounded by name, not "ramps.ts may hold ANY hex literal now" — see
 * `hexLiteralsOutsideFallbackTable` below, which keeps this a check that can still fail. */
const FALLBACK_TABLE_NAME = "FALLBACK_RAMP_ANCHORS";

/** the hex literals in `content` that fall OUTSIDE the named `FALLBACK_RAMP_ANCHORS` object literal
 * — `[]` is what "ramps.ts holds nothing but that one documented, bounded exception" now means (a
 * blanket "zero hex literals anywhere in the file" stopped being true the moment M2 gave the ONE
 * ramp-defining file an actual ramp to hold). A file with no such table at all reports every hex
 * literal it has (nothing to exempt). */
export function hexLiteralsOutsideFallbackTable(content: string): string[] {
  const start = content.indexOf(`const ${FALLBACK_TABLE_NAME}`);
  if (start === -1) return [...content.matchAll(HEX_LITERAL_RE)].map((m) => m[0]);
  const end = content.indexOf("\n};", start);
  const withoutTable =
    end === -1 ? content.slice(0, start) : content.slice(0, start) + content.slice(end + 3);
  return [...withoutTable.matchAll(HEX_LITERAL_RE)].map((m) => m[0]);
}

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

/** scans `<rootDir>/src` (excluding src/lib/brand/**, ramps.ts's own governed exception) for a bare
 * hex color literal — the heuristic for "a second ramp or palette array". `ramps.ts` ITSELF is
 * exempted too (M2): it is allowed a fallback ramp by design, and the narrower
 * `hexLiteralsOutsideFallbackTable` check below is what still polices IT specifically. */
export function findRampLiteralsOutsideRamps(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of walk(join(rootDir, "src"))) {
    const rel = relative(rootDir, file);
    if (rel.startsWith(BRAND_PREFIX)) continue;
    if (rel === MAP_COLORS_FILE) continue;
    if (rel === FEEDBACK_COLORS_FILE) continue;
    if (rel === DOWNLOAD_COLORS_FILE) continue;
    if (rel === RAMPS_FILE) continue;
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    content.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(HEX_LITERAL_RE)) {
        hits.push({ path: rel, line: i + 1, match: m[0] });
      }
    });
  }
  return hits;
}

describe("raster/ramps.ts is the only ramp/palette definition under src/ (brand/** excepted)", () => {
  it("finds zero hex-literal colors anywhere under src/ outside src/lib/brand/**", () => {
    expect(findRampLiteralsOutsideRamps(REPO_ROOT)).toEqual([]);
  });

  // M2 fix (docs/usability.md): before M2, ramps.ts held zero hex literals at all — every palette
  // color came from boot.json, no exception. M2 gives it ONE bounded, named exception (a fallback
  // ramp for a palette no release publishes), so the blanket "zero hex literals" claim is no longer
  // true BY DESIGN; what still must be true is that nothing else in the file is ramp-shaped.
  it("ramps.ts's own hex literals live ONLY inside the documented FALLBACK_RAMP_ANCHORS table (M2) — nowhere else in the file", () => {
    const content = readFileSync(join(REPO_ROOT, RAMPS_FILE), "utf8");
    expect(hexLiteralsOutsideFallbackTable(content)).toEqual([]);
  });

  it("the FALLBACK_RAMP_ANCHORS exception is not vacuous — it actually holds stops", () => {
    const content = readFileSync(join(REPO_ROOT, RAMPS_FILE), "utf8");
    expect(content).toContain(`const ${FALLBACK_TABLE_NAME}`);
    const start = content.indexOf(`const ${FALLBACK_TABLE_NAME}`);
    const end = content.indexOf("\n};", start);
    expect(end).toBeGreaterThan(start);
    const table = content.slice(start, end);
    expect(table.match(HEX_LITERAL_RE)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("SEEDED FAULT: a hex literal planted OUTSIDE the fallback table is still flagged", () => {
    const rogue = `const ${FALLBACK_TABLE_NAME} = {\n  viridis: ["#440154"],\n};\nexport const rogue = "#123456";\n`;
    expect(hexLiteralsOutsideFallbackTable(rogue)).toEqual(["#123456"]);
  });

  // the exemption above is narrow BECAUSE of this: the one exempt file may hold the map's fixed
  // data colours, but never anything ramp-shaped. A palette is 11 stops (boot.palettes); five is
  // already well past "a table of outline colours".
  it("the exempt map colour file defines nothing ramp-shaped", () => {
    const content = readFileSync(join(REPO_ROOT, MAP_COLORS_FILE), "utf8");
    expect(RAMP_ARRAY_RE.test(content)).toBe(false);
  });

  it("SEEDED FAULT: that same check flags a palette array planted in the exempt file", () => {
    expect(RAMP_ARRAY_RE.test('export const rogue = ["#9E0142", "#D53E4F", "#3288BD"];')).toBe(
      true,
    );
  });

  it("the exempt FEEDBACK colour file defines nothing ramp-shaped either (3 marker colours, not a palette)", () => {
    const content = readFileSync(join(REPO_ROOT, FEEDBACK_COLORS_FILE), "utf8");
    expect(RAMP_ARRAY_RE.test(content)).toBe(false);
  });
});

describe("findRampLiteralsOutsideRamps — seeded fault (a second ramp planted outside ramps.ts)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-ramp-wiring-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  it("goes RED when a second palette array is planted in an unrelated src/ file", () => {
    const root = makeFixtureRoot({
      "src/lens/scores/legend.ts": `export const rogueRamp = ["#9E0142", "#D53E4F", "#3288BD"];\n`,
    });
    const hits = findRampLiteralsOutsideRamps(root);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe(join("src", "lens", "scores", "legend.ts"));
  });

  it("stays GREEN for a clean fixture tree with no stray hex literals", () => {
    const root = makeFixtureRoot({
      "src/lib/raster/ramps.ts": `export const noop = 1;\n`,
      "src/lens/scores/legend.ts": `export const label = "spectral_r";\n`,
    });
    expect(findRampLiteralsOutsideRamps(root)).toEqual([]);
  });

  it("stays GREEN for a hex literal under src/lib/brand/** (governed by check-hex-literals.mjs instead)", () => {
    const root = makeFixtureRoot({
      "src/lib/brand/tokens.css": `:root { --brand-navy: #0b2a4a; }\n`,
    });
    expect(findRampLiteralsOutsideRamps(root)).toEqual([]);
  });
});
