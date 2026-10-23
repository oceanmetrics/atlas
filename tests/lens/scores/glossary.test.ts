import { describe, expect, it } from "vitest";
import { ER_RULE, GLOSSARY_COLUMNS } from "../../../src/lens/scores/glossary";

describe("ER_RULE — the er_score weighting rule, verbatim (parity doc §5.5 modal 3)", () => {
  it("has exactly these nine rows, in this exact order, with these exact weights", () => {
    expect(ER_RULE).toEqual([
      { label: "NMFS/FWS: EN", weight: 100 },
      { label: "NMFS/FWS: TN", weight: 50 },
      { label: "IUCN: CR", weight: 50 },
      { label: "IUCN: EN", weight: 25 },
      { label: "IUCN: VU", weight: 5 },
      { label: "IUCN: NT", weight: 2 },
      { label: "IUCN: LC / DD", weight: 1 },
      { label: "MMPA", weight: 20 },
      { label: "MBTA", weight: 10 },
    ]);
  });

  it("NMFS/FWS EN is 100, not 99 (the seeded-fault case this test pins)", () => {
    const row = ER_RULE.find((r) => r.label === "NMFS/FWS: EN");
    expect(row?.weight).toBe(100);
  });
});

describe("GLOSSARY_COLUMNS", () => {
  it("has one row per species-table column, each with a non-empty definition", () => {
    const expectedTerms = [
      "cat", "taxon", "scientific", "common", "er_code", "er_score",
      "model", "is_mmpa", "is_mbta", "area_km2", "avg_suit", "pct_cat",
    ]; // prettier-ignore
    expect(GLOSSARY_COLUMNS.map((c) => c.term)).toEqual(expectedTerms);
    for (const c of GLOSSARY_COLUMNS) expect(c.def.length).toBeGreaterThan(0);
  });
});
