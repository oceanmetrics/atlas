// atlas-3 step 2b: categories.ts is the one place a species category resolves to a color TOKEN.
// The seeded faults this gate exists to catch: `primprod` falling back to grey (NO_DATA_CATEGORY), and
// (0.6.1) flora folded back onto primprod --
// see parity scores app.md:826-830 and report pipeline spec.md:186-187 for why that fault is real
// (v8's "primary producer" flower component is not in msens' hard-coded hue_pal(8) name vector).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instanceTokensCss } from "../../scripts/instance.mjs";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  categoryFor,
  categoryKeyFor,
  categoryLabel,
  NO_DATA_CATEGORY,
  type CategoryKey,
} from "../../src/lib/ui/categories";

// the exact eight names parity scores app.md:827-830 quotes from msens/R/viz.R:757-759
// (`scales::hue_pal()(8)` fixed to `c("invertebrate","mammal","other","primprod","turtle","bird",
// "coral","fish")`) -- every one of those must have a row in CATEGORIES.
const PARITY_DOC_KEYS: CategoryKey[] = [
  "invertebrate",
  "mammal",
  "other",
  "primprod",
  "turtle",
  "bird",
  "coral",
  "fish",
];

describe("CATEGORIES: one row per species category", () => {
  it("has exactly nine rows (the eight msens hue_pal names plus flora, split from primprod in 0.6.1)", () => {
    expect(CATEGORIES).toHaveLength(9);
  });

  it("has a row for every category key the parity doc lists", () => {
    for (const key of PARITY_DOC_KEYS) {
      const row = CATEGORIES.find((c) => c.key === key);
      expect(row, `no CATEGORIES row for "${key}"`).toBeDefined();
    }
  });

  it("CATEGORY_KEYS matches CATEGORIES exactly, order included (it is a Map key list)", () => {
    expect(CATEGORY_KEYS).toEqual(CATEGORIES.map((c) => c.key));
  });

  it("every row's key, label, icon and color are the documented shape", () => {
    for (const row of CATEGORIES) {
      expect(typeof row.key).toBe("string");
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.icon === null || typeof row.icon === "string").toBe(true);
      expect(row.color).toMatch(/^--cat-[a-z]+$/);
    }
  });

  it("every row's color is a DISTINCT custom-property NAME, never a resolved hex value", () => {
    const colors = CATEGORIES.map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
    for (const c of colors) expect(c).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("every color token this module names actually exists in tokens.css, with a contrast pair", () => {
    const css = readFileSync(instanceTokensCss(), "utf8");
    for (const row of CATEGORIES) {
      // declared as a real custom property in the navy theme block (not just mentioned in a comment)
      expect(css, `${row.color} not declared in tokens.css`).toMatch(
        new RegExp(`\\n\\s*${row.color}:\\s*#`),
      );
      // and carries a @contrast pair, so scripts/contrast.mjs actually checks it
      expect(css, `${row.color} has no @contrast pair`).toMatch(
        new RegExp(`nontext ${row.color}\\s*:`),
      );
    }
  });
});

describe("categoryKeyFor / categoryFor: flora (primary producers) and primprod (productivity)", () => {
  // atlas 0.6.1 regression: these were folded onto ONE category and the flower dropped productivity
  // (v11 All US waters: 7 of 8 petals, mean 21 against the published composite 19.18)
  it("flora and primprod are distinct categories", () => {
    expect(categoryKeyFor("primprod")).toBe("primprod");
    expect(categoryKeyFor("primary producer")).toBe("flora");
    expect(categoryKeyFor("primary producer")).not.toBe(categoryKeyFor("primprod"));
  });

  it("each resolves to its own NON-GREY token", () => {
    const pp = categoryFor("primprod");
    const fl = categoryFor("primary producer");
    expect(pp.color).toBe("--cat-primprod");
    expect(fl.color).toBe("--cat-mangrove");
    expect(pp.color).not.toBe(fl.color);
    for (const c of [pp, fl]) expect(c.color).not.toBe(NO_DATA_CATEGORY.color);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(categoryKeyFor("  Primary Producer  ")).toBe("flora");
    expect(categoryKeyFor("PRIMPROD")).toBe("primprod");
    expect(categoryKeyFor("Primary  Productivity")).toBe("primprod");
  });

  it("recognizes every spelling of each: taxa.R's 'primary_producer', 'flora', 'productivity'", () => {
    for (const raw of ["primary_producer", "primary producers", "flora", "Flora"])
      expect(categoryKeyFor(raw), raw).toBe("flora");
    for (const raw of ["productivity", "Productivity", "primary productivity"])
      expect(categoryKeyFor(raw), raw).toBe("primprod");
  });

  it("recognizes every other category name unchanged", () => {
    for (const key of CATEGORY_KEYS) {
      expect(categoryKeyFor(key)).toBe(key);
    }
  });

  it("an unrecognized string falls back to NO_DATA_CATEGORY, not silently to a real category", () => {
    expect(categoryFor("reptile")).toEqual(NO_DATA_CATEGORY);
    expect(categoryFor("")).toEqual(NO_DATA_CATEGORY);
    expect(categoryKeyFor("reptile")).toBeNull();
  });

  it("NO_DATA_CATEGORY uses the --cat-nodata token, distinct from every real category", () => {
    expect(NO_DATA_CATEGORY.color).toBe("--cat-nodata");
    expect(CATEGORIES.map((c) => c.color)).not.toContain(NO_DATA_CATEGORY.color);
  });
});

// P round V2 fix (Opus eyes-on, 2026-09-24: "the raw key 'primprod' appears" / "raw keys show in
// the UI: 'score', 'primprod', lowercase categories"). The seeded fault this gate exists to catch:
// a known category's raw string (e.g. "primprod") printed VERBATIM instead of through this table's
// own Title/sentence-case label.
describe("categoryLabel: the report/panel DISPLAY text for a raw component/category key", () => {
  it("a known category's raw string resolves to its local table label, never the raw spelling", () => {
    // 0.6.1: two labels for two components (they were one, "Primary production", before)
    expect(categoryLabel("primprod")).toBe("Primary productivity");
    expect(categoryLabel("primary producer")).toBe("Primary producers");
    expect(categoryLabel("bird")).toBe("Bird");
    expect(categoryLabel("mammal")).toBe("Mammal");
  });

  it("every spelling of primary producer shares flora's label, never productivity's", () => {
    expect(categoryLabel("primary_producer")).toBe(categoryLabel("primary producer"));
    expect(categoryLabel("primary producer")).not.toBe(categoryLabel("primprod"));
  });

  it("a manifest metric label wins when given and non-blank, for the category's OWN extrisk metric key", () => {
    expect(categoryLabel("bird", { extrisk_bird: "bird: ext. risk" })).toBe("bird: ext. risk");
    // a DIFFERENT category's manifest entry must never leak onto this one.
    expect(categoryLabel("bird", { extrisk_fish: "fish: ext. risk" })).toBe("Bird");
  });

  it("a blank or missing manifest label falls back to the local table, never an empty string", () => {
    expect(categoryLabel("bird", { extrisk_bird: "" })).toBe("Bird");
    expect(categoryLabel("bird", { extrisk_bird: "   " })).toBe("Bird");
    expect(categoryLabel("bird", {})).toBe("Bird");
    expect(categoryLabel("bird", null)).toBe("Bird");
    expect(categoryLabel("bird")).toBe("Bird");
  });

  it(
    "an UNRECOGNIZED raw string is sentence-cased, never blanked to NO_DATA_CATEGORY's 'No data' " +
      "(a real, if legacy/compound, component label -- e.g. a release's 'invertebrate and coral' or " +
      "'marine mammal' -- must still read as prose, not disappear)",
    () => {
      expect(categoryLabel("invertebrate and coral")).toBe("Invertebrate and coral");
      expect(categoryLabel("marine mammal")).toBe("Marine mammal");
      expect(categoryLabel("diving seabird")).toBe("Diving seabird");
      expect(categoryLabel("reptile")).not.toBe("No data");
      expect(categoryLabel("reptile")).toBe("Reptile");
    },
  );

  it("an empty string stays empty (nothing to sentence-case)", () => {
    expect(categoryLabel("")).toBe("");
  });
});
