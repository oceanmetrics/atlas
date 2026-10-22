// atlas-3 step 2b: categories.ts is the one place a species category resolves to a color TOKEN.
// The seeded fault this gate exists to catch: `primprod` falling back to grey (NO_DATA_CATEGORY) --
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
  it("has exactly eight rows", () => {
    expect(CATEGORIES).toHaveLength(8);
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

describe("categoryKeyFor / categoryFor: the two primary-producer spellings", () => {
  it("'primprod' resolves to the primprod category", () => {
    expect(categoryKeyFor("primprod")).toBe("primprod");
  });

  it("'primary producer' (the v8/v9 flower component label) resolves to the SAME category as 'primprod'", () => {
    expect(categoryKeyFor("primary producer")).toBe(categoryKeyFor("primprod"));
    expect(categoryKeyFor("primary producer")).toBe("primprod");
  });

  it("both spellings resolve to the same NON-GREY token (the seeded fault: falling back to grey)", () => {
    const a = categoryFor("primprod");
    const b = categoryFor("primary producer");
    expect(a.color).toBe(b.color);
    expect(a.color).toBe("--cat-primprod");
    expect(a.color).not.toBe(NO_DATA_CATEGORY.color); // must not be the grey "not reportable" token
  });

  it("is case- and whitespace-insensitive", () => {
    expect(categoryKeyFor("  Primary Producer  ")).toBe("primprod");
    expect(categoryKeyFor("PRIMPROD")).toBe("primprod");
  });

  it("also recognizes taxa.R's underscore spelling ('primary_producer')", () => {
    expect(categoryKeyFor("primary_producer")).toBe("primprod");
  });

  it("recognizes every other category name unchanged", () => {
    for (const key of CATEGORY_KEYS) {
      if (key === "primprod") continue;
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
    // owner review item 8 (live 0.10.62): "Primary producer" -> "Primary production", matching
    // the docs' own scoring-page wording.
    expect(categoryLabel("primprod")).toBe("Primary production");
    expect(categoryLabel("bird")).toBe("Bird");
    expect(categoryLabel("mammal")).toBe("Mammal");
  });

  it("every spelling of primary producer resolves to the SAME label as 'primprod'", () => {
    expect(categoryLabel("primary producer")).toBe(categoryLabel("primprod"));
    expect(categoryLabel("primary_producer")).toBe(categoryLabel("primprod"));
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
