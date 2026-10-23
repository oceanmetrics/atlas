import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compositionTree, type CompositionRow } from "../../../src/lens/scores/composition";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// owner decision R8 (2026-09-24): the DEFAULT measure is species COUNT, matching the ported
// Shiny app's own treemap -- before this, every box was sized by `suit_er_area` (suitability x
// extinction-risk x area), which drew a real selection's Mammal box as the LARGEST even though
// Shiny (sizing by count) draws it small (few, high-suitability species inflate a suit x ER x
// area sum without inflating a species count). `suit_er_area` still exists as an internal,
// not-yet-exposed `measure` option -- see the describe block at the bottom of this file.
describe("compositionTree (default measure: count, R8)", () => {
  it("groups by category, counting ONE per row (each row is one species, sql/composition.sql)", () => {
    const tree = compositionTree([
      { sp_cat: "bird", suit_er_area: 10 },
      { sp_cat: "bird", suit_er_area: 5 },
      { sp_cat: "fish", suit_er_area: 3 },
    ]);
    expect(tree.children).toEqual([
      { name: "Bird", categoryKey: "bird", value: 2 },
      { name: "Fish", categoryKey: "fish", value: 1 },
    ]);
  });

  it("folds synonym spellings into the same category (the primary producer bug fix)", () => {
    const tree = compositionTree([
      { sp_cat: "primary_producer", suit_er_area: 4 },
      { sp_cat: "primprod", suit_er_area: 6 },
    ]);
    // owner review item 8 (live 0.10.62): "Primary producer" -> "Primary production".
    expect(tree.children).toEqual([
      { name: "Primary production", categoryKey: "primprod", value: 2 },
    ]);
  });

  it("a category with zero rows gets no box (never a zero-size box) -- a row with suit_er_area 0 still counts as one real species", () => {
    expect(compositionTree([]).children).toEqual([]);
    // count-based: a species with NO measured suit_er_area is still a real, present species --
    // the old suit_er_area-summed behaviour (which dropped this exact row) moved to its own
    // describe block below, since "drop a 0 suit_er_area row" is no longer this measure's rule.
    const tree = compositionTree([{ sp_cat: "bird", suit_er_area: 0 }]);
    expect(tree.children).toEqual([{ name: "Bird", categoryKey: "bird", value: 1 }]);
  });

  it("an unrecognized sp_cat still gets a box under its own name, counted the same way", () => {
    const tree = compositionTree([
      { sp_cat: "reptile", suit_er_area: 2 },
      { sp_cat: "reptile", suit_er_area: 9 },
    ]);
    expect(tree.children).toEqual([{ name: "reptile", value: 2 }]);
  });

  it("real v7 fixture (zone HAR, 478 species): box values are EXACTLY the per-category species counts", () => {
    const fixture = JSON.parse(
      readFileSync(join(ROOT, "tests/fixtures/parity/v7/composition.json"), "utf8"),
    ) as { rows: CompositionRow[] };
    expect(fixture.rows).toHaveLength(478);

    const expectedCounts = new Map<string, number>();
    for (const r of fixture.rows) {
      expectedCounts.set(r.sp_cat, (expectedCounts.get(r.sp_cat) ?? 0) + 1);
    }
    // pinned against the real, checked-in fixture -- not invented numbers (regression guard: a
    // future fixture refresh that silently drops this shape would fail the toHaveLength(478)
    // assertion above before it could fail this one for the wrong reason).
    expect(Object.fromEntries(expectedCounts)).toEqual({
      invertebrate: 301,
      other: 71,
      fish: 66,
      bird: 22,
      mammal: 12,
      coral: 6,
    });

    const tree = compositionTree(fixture.rows);
    const byKey = new Map(tree.children!.map((c) => [c.categoryKey ?? c.name, c.value]));
    for (const [sp_cat, count] of expectedCounts) {
      expect(byKey.get(sp_cat), `${sp_cat} box value`).toBe(count);
    }
    // the box areas are PROPORTIONAL to species count by construction (Treemap.svelte lays out
    // boxes by `value` alone) -- Invertebrate (301 species) must be the single largest box, and
    // Mammal (12) must be smaller than Fish (66), the exact ordering `suit_er_area` used to get
    // wrong on a real selection (owner-reported R8).
    const invertebrate = byKey.get("invertebrate")!;
    const mammal = byKey.get("mammal")!;
    const fish = byKey.get("fish")!;
    expect(invertebrate).toBeGreaterThan(mammal);
    expect(fish).toBeGreaterThan(mammal);
  });
});

describe("compositionTree({ measure: 'suit_er_area' }): the pre-R8 weighted measure, kept as an internal option", () => {
  it("groups by category, summed by suit_er_area", () => {
    const tree = compositionTree(
      [
        { sp_cat: "bird", suit_er_area: 10 },
        { sp_cat: "bird", suit_er_area: 5 },
        { sp_cat: "fish", suit_er_area: 3 },
      ],
      { measure: "suit_er_area" },
    );
    expect(tree.children).toEqual([
      { name: "Bird", categoryKey: "bird", value: 15 },
      { name: "Fish", categoryKey: "fish", value: 3 },
    ]);
  });

  it("drops a category with no positive sum, never a zero-size box", () => {
    const tree = compositionTree([{ sp_cat: "bird", suit_er_area: 0 }], {
      measure: "suit_er_area",
    });
    expect(tree.children).toEqual([]);
  });

  it("an unrecognized sp_cat still gets a box under its own name", () => {
    const tree = compositionTree([{ sp_cat: "reptile", suit_er_area: 2 }], {
      measure: "suit_er_area",
    });
    expect(tree.children).toEqual([{ name: "reptile", value: 2 }]);
  });
});
