// Rule-level tests for the species sorts: the full list's order, the top 20's distinct + stable
// descending sort, and the tie-breaking that makes the fixture's exact-order assertion meaningful
// rather than flaky.
import { describe, expect, it } from "vitest";
import {
  compareBytes,
  sortSpeciesRows,
  topSpecies,
  SPECIES_CSV_COLUMNS,
} from "../../../src/lib/report/species";
import type { SpeciesRow } from "../../../src/lib/analysis/queries";

function row(p: Partial<SpeciesRow> & { mdl_key: string }): SpeciesRow {
  return {
    sp_cat: "fish",
    sp_common: null,
    sp_scientific: p.mdl_key,
    taxon_id: null,
    taxon_authority: null,
    er_code: null,
    er_score: 0.5,
    is_mmpa: null,
    is_mbta: null,
    area_km2: 1,
    avg_suit: 0.5,
    suit_er: 0.25,
    suit_er_area: 0.25,
    cat_suit_er_area: 1,
    pct_cat: 0.25,
    ...p,
  } as SpeciesRow;
}

describe("sortSpeciesRows -- arrange(sp_cat, sp_scientific)", () => {
  it("orders by category first, then scientific name", () => {
    const got = sortSpeciesRows([
      row({ mdl_key: "1", sp_cat: "fish", sp_scientific: "Bbb" }),
      row({ mdl_key: "2", sp_cat: "bird", sp_scientific: "Zzz" }),
      row({ mdl_key: "3", sp_cat: "fish", sp_scientific: "Aaa" }),
    ]);
    expect(got.map((r) => r.mdl_key)).toEqual(["2", "3", "1"]);
  });

  it("uses C-locale byte order, not localeCompare (which folds case and ignores punctuation)", () => {
    // in the C locale every uppercase letter precedes every lowercase one; `localeCompare` would
    // answer the other way round for these two.
    expect(compareBytes("Zea", "aaa")).toBeLessThan(0);
    expect("Zea".localeCompare("aaa")).toBeGreaterThan(0);
  });

  it("does not mutate its input", () => {
    const input = [row({ mdl_key: "b" }), row({ mdl_key: "a" })];
    sortSpeciesRows(input);
    expect(input.map((r) => r.mdl_key)).toEqual(["b", "a"]);
  });
});

describe("topSpecies", () => {
  it("sorts by suit_er_area DESCENDING and takes the first N", () => {
    const got = topSpecies(
      [
        row({ mdl_key: "lo", suit_er_area: 1 }),
        row({ mdl_key: "hi", suit_er_area: 9 }),
        row({ mdl_key: "mid", suit_er_area: 5 }),
      ],
      2,
    );
    expect(got.map((r) => r.mdl_key)).toEqual(["hi", "mid"]);
  });

  it("is not avg_suit: the two columns rank differently and only one is the Score", () => {
    const got = topSpecies([
      row({ mdl_key: "a", avg_suit: 0.9, suit_er_area: 1 }),
      row({ mdl_key: "b", avg_suit: 0.1, suit_er_area: 100 }),
    ]);
    expect(got[0].mdl_key).toBe("b");
  });

  it("ties break by (sp_cat, sp_scientific) -- the order R's `d` was already in", () => {
    const got = topSpecies([
      row({ mdl_key: "z", sp_cat: "fish", sp_scientific: "Zeta", suit_er_area: 7 }),
      row({ mdl_key: "a", sp_cat: "fish", sp_scientific: "Alpha", suit_er_area: 7 }),
    ]);
    expect(got.map((r) => r.mdl_key)).toEqual(["a", "z"]);
  });

  it("the input's own order cannot change the answer (the model sorts, it does not trust)", () => {
    const rows = [
      row({ mdl_key: "a", sp_scientific: "Alpha", suit_er_area: 7 }),
      row({ mdl_key: "z", sp_scientific: "Zeta", suit_er_area: 7 }),
    ];
    expect(topSpecies(rows).map((r) => r.mdl_key)).toEqual(
      topSpecies([...rows].reverse()).map((r) => r.mdl_key),
    );
  });

  it("de-duplicates on the SEVEN display columns, keeping the first", () => {
    const dup = row({ mdl_key: "a", suit_er_area: 7 });
    expect(topSpecies([dup, { ...dup }]).map((r) => r.mdl_key)).toEqual(["a"]);
  });

  it("two rows of the same model that DIFFER in a display column both survive (R's distinct)", () => {
    const got = topSpecies([
      row({ mdl_key: "a", suit_er_area: 7 }),
      row({ mdl_key: "a", suit_er_area: 3 }),
    ]);
    expect(got).toHaveLength(2);
  });

  it("defaults to 20", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ mdl_key: `m${i}`, sp_scientific: `S${String(i).padStart(2, "0")}`, suit_er_area: i }),
    );
    expect(topSpecies(rows)).toHaveLength(20);
  });

  it("an empty list is an empty top 20", () => {
    expect(topSpecies([])).toEqual([]);
  });
});

describe("SPECIES_CSV_COLUMNS", () => {
  it("is msens::species_for_cells()'s own frame, in its own order (spec §7)", () => {
    expect([...SPECIES_CSV_COLUMNS]).toEqual([
      "sp_cat",
      "sp_common",
      "sp_scientific",
      "taxon_id",
      "taxon_authority",
      "er_code",
      "er_score",
      "is_mmpa",
      "is_mbta",
      "mdl_key",
      "area_km2",
      "avg_suit",
      "suit_er",
      "suit_er_area",
      "cat_suit_er_area",
      "pct_cat",
    ]);
  });
});
