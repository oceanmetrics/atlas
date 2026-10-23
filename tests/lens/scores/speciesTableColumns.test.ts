// P3 fix (owner-reported, 2026-09-24): the species table's phone default column subset -- pure
// logic, see speciesTableColumns.ts's own header. Seeded fault: dropping the phone branch (always
// returning every column) turns this whole file red -- tests/faults/species-columns-no-subset.patch.
import { describe, expect, it } from "vitest";
import {
  SPECIES_PHONE_DEFAULT_COLUMNS,
  visibleSpeciesColumnKeys,
} from "../../../src/lens/scores/speciesTableColumns";

const ALL_KEYS = [
  "cat",
  "taxon",
  "scientific",
  "common",
  "er_code",
  "er_score",
  "model",
  "is_mmpa",
  "is_mbta",
  "area_km2",
  "avg_suit",
  "pct_cat",
];

describe("visibleSpeciesColumnKeys", () => {
  it("desktop (>= 900px) always shows every column, even with a phone choice set", () => {
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 1280, new Set(["cat"]))).toEqual(ALL_KEYS);
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 900, null)).toEqual(ALL_KEYS);
  });

  it("phone (< 900px), no user choice yet: the curated six-column default, in allKeys' order", () => {
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 390, null)).toEqual([
      "cat",
      "scientific",
      "common",
      "er_code",
      "er_score",
      "area_km2",
    ]);
    expect(SPECIES_PHONE_DEFAULT_COLUMNS.length).toBe(6);
  });

  it("phone, the user picked columns: exactly those, in allKeys' own order (not the picked order)", () => {
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 390, new Set(["model", "cat", "is_mmpa"]))).toEqual([
      "cat",
      "model",
      "is_mmpa",
    ]);
  });

  it("phone, the user picked NO columns: an empty list, not a silent fallback to the default", () => {
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 390, new Set())).toEqual([]);
  });

  it("the breakpoint is exactly panelGeometry.ts's own 900px switch", () => {
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 899, null).length).toBe(6);
    expect(visibleSpeciesColumnKeys(ALL_KEYS, 900, null).length).toBe(ALL_KEYS.length);
  });
});
