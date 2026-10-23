// m7 (atlas-8 review round 2, pinning G-23's wording) -- UPDATED for owner decision R8
// (2026-09-24, atlas-4 fix round 2): `Composition.svelte`'s real render is what G-23 (0.10.19,
// CHANGELOG.md) originally fixed -- before it, `Treemap.svelte`'s accessible summary hardcoded
// "species" for a value that was `suit_er_area` ("suitability x extinction-risk x area"),
// producing nonsense like "210,671,300.041 species across 7 categories" (the regression fixture
// `tests/ui/treemapLayout.test.ts` still reproduces byte-for-byte -- that pin is about
// `describeTreemapSummary()`'s ROUNDING rule and is untouched by R8). G-23's own fix was a
// `valueLabel` PROP `Composition.svelte` passes down, pinned here so nothing quietly reverts it.
//
// R8 (a real product decision, not a regression): the treemap now measures species COUNT by
// default (`compositionTree()`'s `measure: "count"`), matching the ported Shiny app -- so
// `valueLabel="n species"` is now the CORRECT, literal description of the value, not a mislabel.
// The suit_er_area measure G-23 was about still exists as an internal option
// (`compositionTree(rows, { measure: "suit_er_area" })`), just not wired to any control yet -- this
// scan still exists to catch a FUTURE caller edit that silently reverts to a stale/wrong phrase
// (e.g. reintroducing G-23's literal bug by hand-typing "species" while actually passing the
// suit_er_area-measured tree, or dropping the prop outright -- `Treemap.svelte`'s Props require
// it, a type error `svelte-check` catches but not every gate run does).
//
// A plain source scan (the technique `composition-note.test.ts`/`documentTitle.test.ts` already
// use for a property a DOM-less test run cannot observe): the REAL caller in `Composition.svelte`
// must carry the exact current phrase, verbatim -- scoped to `Composition.svelte` alone so it
// cannot be satisfied by leaving some OTHER call site (the gallery demo, `docs/spikes`) unchanged.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COMPOSITION_SVELTE = join(ROOT, "src/lens/scores/Composition.svelte");

// UI-8 (round-3 review): "16,153 n species across 7 categories" reads as a raw value-label typo,
// not English -- `valueLabel="species"` (dropping the leading "n") is the R8-correct wording.
describe("Composition.svelte's valueLabel is pinned to R8's real wording (species count)", () => {
  it("REGRESSION: passes the exact current phrase, matching the count-based measure it now renders", () => {
    const src = readFileSync(COMPOSITION_SVELTE, "utf8");
    expect(src).toContain('valueLabel="species"');
    // the exact shape G-23 originally fixed: a label that does not describe the value actually
    // passed. R8 made the value a real count, so the OLD suit_er_area phrase would now be the
    // mislabel.
    expect(src).not.toMatch(/valueLabel\s*=\s*"combined suitability/);
    expect(src).not.toContain('valueLabel="n species"'); // UI-8: the leading "n" read as a typo
  });
});
