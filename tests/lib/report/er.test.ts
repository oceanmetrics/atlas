// Rule-level tests for `er_consolidate()` and the counts table: one small synthetic fixture per
// ARM of the R `case_when`, so a typo shows up as exactly the arm that changed rather than as a
// broad diff in the big R-fixture gate (CLAUDE.md: "many small fixtures, one per rule/branch").
import { describe, expect, it } from "vitest";
import {
  ER_CAT_ORDER,
  erColumnParts,
  erConsolidate,
  speciesCounts,
} from "../../../src/lib/report/er";

describe("erConsolidate -- one case per arm of report_area_child.qmd:47-56", () => {
  it.each([
    ["FWS:EN", "USA:EN(100)"],
    ["NMFS:EN", "USA:EN(100)"],
    ["FWS:TN", "USA:TN(50)"],
    ["NMFS:TN", "USA:TN(50)"],
    ["FWS:LC", "USA:LC(1)"],
    ["NMFS:LC", "USA:LC(1)"],
    ["IUCN:CR", "IUCN:CR(50)"],
    ["IUCN:EN", "IUCN:EN(25)"],
    ["IUCN:VU", "IUCN:VU(5)"],
    ["IUCN:NT", "IUCN:NT(2)"],
  ])("%s -> %s", (code, want) => {
    expect(erConsolidate(code)).toBe(want);
  });

  it.each([
    ["IUCN:LC", "there is no IUCN:LC arm -- the rule's own 'other' catch"],
    ["IUCN:DD", "data deficient is 'other', per the report's own note"],
    ["FWS:VU", "a US authority with a status no US arm names"],
    ["ESA:EN", "an authority the rule does not know"],
    ["NA", "the literal string R rewrites a NULL code to"],
    ["", "an empty code"],
    ["noColonAtAll", "no ':' -- str_split_i(..., 2) is NA and every predicate is false"],
  ])("%s -> other(1) (%s)", (code) => {
    expect(erConsolidate(code)).toBe("other(1)");
  });

  it("null and undefined take the SAME path as the literal 'NA' R rewrites them to", () => {
    expect(erConsolidate(null)).toBe("other(1)");
    expect(erConsolidate(undefined)).toBe("other(1)");
  });

  it("reads the SECOND colon-separated field, not 'everything after the first colon'", () => {
    // str_split_i("NMFS:EN:WesternDPS", ":", 2) is "EN"; a `slice(indexOf(':') + 1)` port would
    // read "EN:WesternDPS" and fall through to other(1).
    expect(erConsolidate("NMFS:EN:WesternDPS")).toBe("USA:EN(100)");
  });
});

describe("speciesCounts", () => {
  const rows = [
    { mdl_key: "a", sp_cat: "bird", er_code: "FWS:EN" },
    { mdl_key: "b", sp_cat: "bird", er_code: "IUCN:VU" },
    { mdl_key: "c", sp_cat: "fish", er_code: null },
    { mdl_key: "d", sp_cat: "fish", er_code: "IUCN:LC" },
    { mdl_key: "e", sp_cat: "fish", er_code: "FWS:EN" },
  ];

  it("keeps ER_CAT_ORDER's order and drops the categories nothing falls into", () => {
    expect(speciesCounts(rows).columns).toEqual(["USA:EN(100)", "IUCN:VU(5)", "other(1)"]);
    expect(ER_CAT_ORDER.length).toBe(8);
  });

  it("rows are the species categories, ascending", () => {
    expect(speciesCounts(rows).rows.map((r) => r.category)).toEqual(["bird", "fish"]);
  });

  it("the Total COLUMN is the row's own sum", () => {
    const c = speciesCounts(rows);
    expect(c.rows.map((r) => r.counts)).toEqual([
      [1, 1, 0],
      [1, 0, 2],
    ]);
    expect(c.rows.map((r) => r.total)).toEqual([2, 3]);
  });

  it("the Total ROW is the column sums, and its own total is the grand total", () => {
    const c = speciesCounts(rows);
    expect(c.totalRow.counts).toEqual([2, 1, 2]);
    expect(c.totalRow.total).toBe(5);
  });

  it("N species is n_distinct(mdl_key) -- a model listed twice counts once", () => {
    const dup = [...rows, { mdl_key: "a", sp_cat: "bird", er_code: "FWS:EN" }];
    const c = speciesCounts(dup);
    expect(c.nSpecies).toBe(5);
    expect(c.totalRow.total).toBe(5); // the DISTINCT on the triple, not just the count
  });

  it("an empty place gives an empty table, not a throw", () => {
    const c = speciesCounts([]);
    expect(c.columns).toEqual([]);
    expect(c.rows).toEqual([]);
    expect(c.totalRow).toEqual({ counts: [], total: 0 });
    expect(c.nSpecies).toBe(0);
  });
});

describe("erColumnParts: the counts table's two-line header (#8)", () => {
  it("splits every ER_CAT_ORDER label into its code and its (weight)", () => {
    expect(erColumnParts("USA:EN(100)")).toEqual({ code: "USA:EN", weight: "(100)" });
    expect(erColumnParts("IUCN:NT(2)")).toEqual({ code: "IUCN:NT", weight: "(2)" });
    expect(erColumnParts("other(1)")).toEqual({ code: "other", weight: "(1)" });
    for (const col of ER_CAT_ORDER) {
      const { code, weight } = erColumnParts(col);
      expect(`${code}${weight}`).toBe(col);
    }
  });

  it("a label without a trailing (n) is left whole", () => {
    expect(erColumnParts("Total")).toEqual({ code: "Total", weight: null });
  });
});
