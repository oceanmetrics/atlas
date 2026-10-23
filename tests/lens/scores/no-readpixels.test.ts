// GATE (fix round 3, the scores click popup; widened app-wide by m8, atlas-8 review round 2):
// `readPixels(` never appears anywhere under `src/` — the popup's "displayed layer's value" must
// come from `analysis/queries.ts#cellValue()` (the wide `cell` Parquet tile), never a sampled
// raster pixel (plan D4: "numbers never come from the tile server"). A source scan is the
// available form for the same reason `tests/map/no-fitbounds.test.ts` uses one: nothing about a
// WRONG data source is otherwise distinguishable from a unit test's return value alone — both a
// tile read and a Parquet read can hand back the number 42.
//
// D4 is app-wide, not `src/lens/scores`-scoped (m8's own finding: the rule only ever got the one
// directory it was FIXED in, never the whole surface it governs), so this now scans all of `src`.
// The ONE sanctioned exception, unaffected by this scan because it is not literally `readPixels(`
// at all: the species lens' click value, which may read `/cog/point` (an HTTP endpoint titiler
// answers, plan D4's own carve-out) — a real, server-side pixel-value lookup, but never a client
// WebGL `gl.readPixels()` call.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

const READ_PIXELS_RE = /\breadPixels\s*\(/;

/** the scanner itself, so the gate and its seeded fault run the SAME code. */
export function findReadPixelsCalls(dirs: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      if (READ_PIXELS_RE.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
  }
  return offenders;
}

const SCANNED = [join(ROOT, "src")];

describe("no readPixels anywhere under src/ (D4 is app-wide)", () => {
  it("finds no call", () => {
    expect(findReadPixelsCalls(SCANNED)).toEqual([]);
  });

  it("is not vacuous: the scanned directory really contains source files", () => {
    expect(listFiles(join(ROOT, "src")).length).toBeGreaterThan(4);
  });

  it("SEEDED FAULT: the same scan flags tests/fixtures/lens/scores/readpixels-fault/", () => {
    expect(
      findReadPixelsCalls([join(ROOT, "tests/fixtures/lens/scores/readpixels-fault")]),
    ).toEqual(["tests/fixtures/lens/scores/readpixels-fault/probe.ts"]);
  });
});
