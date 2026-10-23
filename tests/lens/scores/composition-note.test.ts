// G-23 (2) fix (docs/parity.html) -- mislabelled "G-24" at the time (corrected atlas-8 phase
// review M8, 0.10.24: this is G-23's SECOND defect, the stale bird note beside its summary-line
// defect, not the unrelated G-24 zones-table-header issue). A ported note above the composition
// treemap used to read "the 'bird' component has yet to be added to this visualization" -- true
// of the SHINY app's six-rank WoRMS hierarchy treemap (its `inner_join` against `d_taxonomy`
// drops BOTW taxa, which carry no WoRMS row -- G-06, not built here), but never true of the
// ONE-LEVEL treemap this repo ships (`composition.ts#compositionTree` groups by `sp_cat` via a
// LEFT JOIN, `sql/composition.sql`, so a bird row is never excluded by construction).
//
// Two things are asserted: (1) a plain source scan, the same technique
// `tests/shell/documentTitle.test.ts` / `tests/treemap-lazy-import.wiring.test.ts` use for a
// property a real DOM render can't observe under vitest's node environment -- the literal note
// text must never reappear in `Composition.svelte`. (2) the DATA claim the removal rests on: real
// release fixtures (v7 AND v9) carry `sp_cat: "bird"` rows, and `compositionTree()` (already
// unit-tested on its own in composition.test.ts) turns any category with a positive sum into a
// box -- bird included, exactly like every other category.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compositionTree, type CompositionRow } from "../../../src/lens/scores/composition";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COMPOSITION_SVELTE = join(ROOT, "src/lens/scores/Composition.svelte");

describe("Composition.svelte no longer carries the stale 'bird' note (G-23 (2))", () => {
  it("REGRESSION: the literal note text is absent from the source", () => {
    const src = readFileSync(COMPOSITION_SVELTE, "utf8");
    expect(src).not.toContain("yet to be added");
  });

  it("REGRESSION: the template renders no static caveat about birds (comments may still discuss them)", () => {
    const src = readFileSync(COMPOSITION_SVELTE, "utf8");
    // strip the <script>...</script> block (this file's own explanatory comments legitimately
    // discuss birds/BOTW at length) so this assertion is only about what actually RENDERS.
    const template = src.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(template.toLowerCase()).not.toContain("bird");
  });
});

describe("why the note is never true of the shipped treemap (data-driven)", () => {
  // v7 only: v9 is a restricted release, and its fixtures stay out of this public repo (the
  // MarineSensitivity/atlas copy ran both; the v7 case is the public one)
  for (const ver of ["v7"] as const) {
    it(`${ver}'s real composition fixture carries a bird row that survives into a box`, () => {
      const fixture = JSON.parse(
        readFileSync(join(ROOT, `tests/fixtures/parity/${ver}/composition.json`), "utf8"),
      ) as { rows: CompositionRow[] };
      const birdRows = fixture.rows.filter((r) => r.sp_cat === "bird");
      expect(birdRows.length).toBeGreaterThan(0); // the fixture actually exercises this

      const tree = compositionTree(fixture.rows);
      const birdBox = (tree.children ?? []).find((c) => c.categoryKey === "bird");
      expect(birdBox).toBeDefined();
      expect(birdBox!.value).toBeGreaterThan(0);
    });
  }

  it("a selection with bird models never drops them — no note could ever fire", () => {
    const rows: CompositionRow[] = [
      { sp_cat: "bird", suit_er_area: 10 },
      { sp_cat: "fish", suit_er_area: 5 },
    ];
    const tree = compositionTree(rows);
    expect((tree.children ?? []).map((c) => c.categoryKey ?? c.name)).toContain("bird");
  });
});
