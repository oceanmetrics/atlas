// GATE: `fitBounds(` never appears under src/lib/map, src/lens or src/places (atlas-4 §6.5, the
// plan's "No `fitBounds` over a zone set" review line; the antimeridian rule below still holds for
// every bbox-driven camera). A source scan is the available
// form — the failure it guards against is geometric, not observable from a unit test's return
// value: a bbox INVERTS across the antimeridian (EBS and PIS both cross it; PIS's true 67.5° span
// reads as 360°), so the camera frames the whole globe and the map looks "broken" for no
// reportable reason. Same technique tests/state/invariants.test.ts uses for pushState.
//
// m8 (atlas-8 review round 2): widened from src/lib/map + src/lens alone -- D2's rule is not
// lens-scoped, and src/places/camera.ts (Places' own antimeridian-aware bbox->camera, atlas-6)
// builds a camera from a bbox the same way a lens would.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** every `.ts`/`.svelte` file under `dir`, recursively. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // src/lens/* is still a .gitkeep placeholder until atlas-4/5 land
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

const FIT_BOUNDS_RE = /\bfitBounds\s*\(/;

/** the scanner itself, so the gate and its seeded fault run the SAME code. */
export function findFitBoundsCalls(dirs: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      if (FIT_BOUNDS_RE.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
  }
  return offenders;
}

const SCANNED = [join(ROOT, "src/lib/map"), join(ROOT, "src/lens"), join(ROOT, "src/places")];

describe("no fitBounds under src/lib/map, src/lens or src/places", () => {
  it("finds no call", () => {
    expect(findFitBoundsCalls(SCANNED)).toEqual([]);
  });

  it("is not vacuous: src/places really contains source files (m8's own widening)", () => {
    expect(listFiles(join(ROOT, "src/places")).length).toBeGreaterThan(4);
  });

  it("is not vacuous: the scanned directories really contain source files", () => {
    expect(listFiles(join(ROOT, "src/lib/map")).length).toBeGreaterThan(4);
  });

  it("SEEDED FAULT: the same scan flags tests/fixtures/map/fitbounds-fault/", () => {
    expect(findFitBoundsCalls([join(ROOT, "tests/fixtures/map/fitbounds-fault")])).toEqual([
      "tests/fixtures/map/fitbounds-fault/camera.ts",
    ]);
  });
});
