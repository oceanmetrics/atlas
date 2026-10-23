import { describe, expect, it } from "vitest";
import { zoneRows } from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  componentLabel,
  dedupeFlowerComponents,
  defaultFlowerComponents,
  flowerEmptyText,
  flowerTitle,
  zoneFlowerComponents,
} from "../../../src/lens/scores/flower";
import { computeFlowerGeometry } from "../../../src/lib/ui/flowerGeometry";
import { categoryFor, NO_DATA_CATEGORY } from "../../../src/lib/ui/categories";
import { BOOT_V7, BOOT_V1_PLANAREA, BOOT_V9 } from "./fixtures";

describe("componentLabel", () => {
  it("strips extrisk_ and _ecoregion_rescaled, underscores to spaces", () => {
    expect(componentLabel("extrisk_bird_ecoregion_rescaled")).toBe("bird");
    expect(componentLabel("extrisk_primary_producer_ecoregion_rescaled")).toBe("primary producer");
    expect(componentLabel("primprod_ecoregion_rescaled")).toBe("primprod");
  });
});

describe("zoneFlowerComponents", () => {
  it("reads the zone's own ecoregion-rescaled metrics", () => {
    const rows = zoneRows(BOOT_V7, "programarea");
    const flower = zoneFlowerComponents(rows, "GAA")!;
    expect(flower.components).toEqual(
      expect.arrayContaining([
        { key: "bird", score: 59.09 },
        { key: "other", score: 25.54 },
      ]),
    );
    expect(flower.droppedLabels).toEqual([]);
  });

  it("an unknown zone key: null", () => {
    expect(zoneFlowerComponents(zoneRows(BOOT_V7, "programarea"), "NOPE")).toBeNull();
  });

  // atlas-4 fix round 2: v9's GAA zone publishes BOTH `extrisk_primary_producer_ecoregion_rescaled`
  // (the ER-weighted species-category term) and `primprod_ecoregion_rescaled` (the bare
  // environmental twin) -- both fold onto the SAME "primprod" category (categories.ts SYNONYMS),
  // so `computeFlowerGeometry` would throw on the raw 8-entry list (tests/ui/flowerGeometry.test.ts
  // pins that throw for exactly this pair). `zoneFlowerComponents` must have already resolved it to
  // 7, keeping the species-category ("primary producer") term and dropping the bare "primprod" one.
  describe("v9's GAA zone (real 8-key collision)", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V9, "programarea"), "GAA")!;

    it("de-duplicates to exactly 7 components, keeping the extrisk_* (species-category) term", () => {
      expect(flower.components).toHaveLength(7);
      expect(flower.components.map((c) => c.key)).toContain("primary producer");
      expect(flower.components.map((c) => c.key)).not.toContain("primprod");
      expect(flower.droppedLabels).toEqual(["primprod"]);
    });

    it("computeFlowerGeometry does not throw on the de-duplicated 7 and draws 7 petals", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(7);
      const mean =
        flower.components.reduce((sum, c) => sum + (c.score ?? 0), 0) / flower.components.length;
      expect(Math.round(g.centerValue!)).toBe(Math.round(mean));
    });

    it("SEEDED FAULT (manual gate, not committed): the raw un-deduplicated 8 still throws", () => {
      // proves the fix is load-bearing -- `dedupeFlowerComponents` is what stands between this
      // zone's real data and computeFlowerGeometry's collision guard.
      const rawEight = zoneRows(BOOT_V9, "programarea").find((z) => z.key === "GAA")!.metrics;
      const undeduped = Object.entries(rawEight)
        .filter(([k]) => /_ecoregion_rescaled$/.test(k))
        .map(([k, score]) => ({ key: componentLabel(k), score }));
      expect(undeduped).toHaveLength(8);
      expect(() => computeFlowerGeometry(undeduped)).toThrow(/both resolve to category/);
    });
  });
});

describe("defaultFlowerComponents", () => {
  it("reads boot.flower_default[zoneAllKey]", () => {
    expect(defaultFlowerComponents(BOOT_V7, "FULL")!.components).toEqual([
      { key: "bird", score: 45.6671707107685 },
      { key: "coral", score: 10.4494142116047 },
      { key: "fish", score: 15.9570514927416 },
      { key: "invertebrate", score: 14.7345085163167 },
      { key: "mammal", score: 41.668393775248 },
      { key: "other", score: 15.1784428369187 },
      { key: "turtle", score: 38.8176408891894 },
      { key: "primprod", score: 10.3787489146688 },
    ]);
  });

  it("v1 (no flower_default published at all): null, never an empty flower masquerading as data", () => {
    expect(defaultFlowerComponents(BOOT_V1_PLANAREA, "USA")).toBeNull();
  });

  // the exact live shape (curl'd from v9/app/boot.json, orchestrator-verified 2026-09-22):
  // flower_default.AK has 8 rows, "primary producer" and "primprod" both present.
  describe("v9's flower_default.AK (real 8-key collision)", () => {
    const flower = defaultFlowerComponents(BOOT_V9, "AK")!;

    it("de-duplicates to exactly 7 components, dropping the bare primprod twin", () => {
      expect(flower.components).toHaveLength(7);
      expect(flower.components.map((c) => c.key)).toEqual([
        "bird",
        "coral",
        "fish",
        "invertebrate",
        "mammal",
        "primary producer",
        "turtle",
      ]);
      expect(flower.droppedLabels).toEqual(["primprod"]);
    });

    it("computeFlowerGeometry draws 7 petals with centre = round(mean of those 7)", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(7);
      const mean =
        flower.components.reduce((sum, c) => sum + (c.score ?? 0), 0) / flower.components.length;
      expect(Math.round(g.centerValue!)).toBe(Math.round(mean));
      expect(Math.round(g.centerValue!)).toBe(22); // (31.58+16.73+18.97+22.84+27.91+15.51+18.39)/7 = 21.705...
    });

    it("SEEDED FAULT (manual gate, not committed): the raw un-deduplicated 8 rows still throw", () => {
      const raw = (BOOT_V9.flower_default.AK as { component: string; score: number }[]).map(
        (r) => ({ key: r.component, score: r.score }),
      );
      expect(raw).toHaveLength(8);
      expect(() => computeFlowerGeometry(raw)).toThrow(/both resolve to category/);
    });
  });
});

describe("dedupeFlowerComponents", () => {
  it("keeps the `preferred` candidate on a category collision, in original input order", () => {
    const result = dedupeFlowerComponents([
      { key: "primary producer", score: 15.5, preferred: true },
      { key: "primprod", score: 5.6, preferred: false },
    ]);
    expect(result.components).toEqual([{ key: "primary producer", score: 15.5 }]);
    expect(result.droppedLabels).toEqual(["primprod"]);
  });

  it("never drops a component whose category is unrecognized (several nodata labels is ordinary data)", () => {
    const result = dedupeFlowerComponents([
      { key: "unknown-a", score: 1, preferred: false },
      { key: "unknown-b", score: 2, preferred: false },
    ]);
    expect(result.components).toHaveLength(2);
    expect(result.droppedLabels).toEqual([]);
  });

  it("passes through a normal, collision-free set unchanged", () => {
    const result = dedupeFlowerComponents([
      { key: "bird", score: 10, preferred: true },
      { key: "fish", score: 20, preferred: false },
    ]);
    expect(result.components).toEqual([
      { key: "bird", score: 10 },
      { key: "fish", score: 20 },
    ]);
    expect(result.droppedLabels).toEqual([]);
  });
});

describe("cellFlowerComponents", () => {
  it("drops component=all and passes val through as score", () => {
    const rows = [
      { metric_key: "extrisk_bird_ecoregion_rescaled", val: 10, component: "bird" },
      { metric_key: "extrisk_all_ecoregion_rescaled", val: 99, component: "all" },
      { metric_key: "extrisk_fish_ecoregion_rescaled", val: null, component: "fish" },
    ];
    const result = cellFlowerComponents(rows);
    expect(result.components).toEqual([
      { key: "bird", score: 10 },
      { key: "fish", score: null },
    ]);
    expect(result.droppedLabels).toEqual([]);
  });

  it("v8/v9 cell click: de-duplicates the extrisk_primary_producer/primprod pair the same way", () => {
    const rows = [
      { metric_key: "extrisk_bird_ecoregion_rescaled", val: 40, component: "bird" },
      {
        metric_key: "extrisk_primary_producer_ecoregion_rescaled",
        val: 17.5,
        component: "primary producer",
      },
      { metric_key: "primprod_ecoregion_rescaled", val: 10.8, component: "primprod" },
    ];
    const result = cellFlowerComponents(rows);
    expect(result.components).toEqual([
      { key: "bird", score: 40 },
      { key: "primary producer", score: 17.5 },
    ]);
    expect(result.droppedLabels).toEqual(["primprod"]);
  });
});

// UI-4 (round-3 review): `flowerTitle` now routes through the SAME `formatSubject()` the map
// popup and species table header use -- "Cell {id} · {lat}° N, {lon}° W" (not the old "Cell ID:
// {id} (x: …, y: …)"), and "All US waters" (not "Full study area") when nothing is selected.
describe("flowerTitle", () => {
  it("cell: the shared subject line, 3 dp", () => {
    expect(flowerTitle({ kind: "cell", cellId: 42, lon: -90.12345, lat: 27.6789 })).toBe(
      "Cell 42 · 27.679° N, 90.123° W",
    );
  });

  it("zone: its own name", () => {
    expect(flowerTitle({ kind: "zone", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern",
    );
  });

  it("nothing selected: All US waters", () => {
    expect(flowerTitle(null)).toBe("All US waters");
  });
});

// D3(b) (Opus 5.5 eyes-on, 2026-09-24): "the Flower and Table panels with no scored selection say
// 'Click a scored cell on the map to see its flower / species' — and a GENUINE query failure keeps
// a distinct message that names the failure, so the two states are never confused (assert both)."
describe("flowerEmptyText (D3(b) — assert both states, and that they are distinct)", () => {
  it("no scored selection: the hint, never blaming the data", () => {
    expect(flowerEmptyText()).toBe("Click a scored cell on the map to see its flower.");
    expect(flowerEmptyText(null)).toBe("Click a scored cell on the map to see its flower.");
    // the exact fault this replaces — the old wording implied the RELEASE was missing data.
    expect(flowerEmptyText()).not.toContain("is published");
    expect(flowerEmptyText()).not.toContain("in this release");
  });

  it("a genuine query failure: a DISTINCT message that names the failure", () => {
    const text = flowerEmptyText("engine disconnected");
    expect(text).toContain("engine disconnected");
    expect(text).not.toBe(flowerEmptyText()); // never confusable with the "nothing selected" hint
  });

  it("the two states share no substring longer than incidental words (assert both, never conflated)", () => {
    const hint = flowerEmptyText();
    const error = flowerEmptyText("timeout");
    expect(error.startsWith("The flower could not be loaded:")).toBe(true);
    expect(hint.startsWith("Click a scored cell")).toBe(true);
  });
});

// atlas-4 fix round 2 (owner-reported defect, 2026-09-24): "Flower plot, nothing selected" on live
// v7 listed eight components under centre 24 but drew only ~3-4 visible petals -- 5 of the 8
// (Coral, Fish, Invertebrate, Other, Primary producer, each <= 24) were real, correctly-colored
// shapes silently covered by the hub disc drawn on top of them (see flowerGeometry.ts's header for
// the full root cause). This was never a color/category MAPPING gap -- every real category already
// resolved to a defined `--cat-*` token -- but the property below (every real component gets a
// defined, non-"no data" color AND a petal whose annular band actually clears the hub) is exactly
// what a mapping gap WOULD have broken, so it is asserted directly against the real fixtures rather
// than assumed from "the path string is non-empty" (which the pre-fix pie-slice geometry also
// satisfied for every one of the 5 invisible petals).
describe("atlas-4 fix round 2: every real component resolves to a defined color and a real petal", () => {
  function assertRealPetals(components: { key: string; score: number | null }[], n: number) {
    const g = computeFlowerGeometry(components);
    expect(g.petals).toHaveLength(n);
    for (const p of g.petals) {
      expect(p.category.color, `${p.key} has no defined --cat-* color token`).toMatch(
        /^--cat-[a-z]+$/,
      );
      expect(p.category.color, `${p.key} fell back to the "no data" token`).not.toBe(
        NO_DATA_CATEGORY.color,
      );
      // a real, present score always produces a band whose outer edge clears the shared hub --
      // the property the pre-fix "pie slice under a hub disc" geometry violated for any score at
      // or below the hub's own radius (24 of the default 100-unit outerRadius).
      expect(p.radius, `${p.key}'s petal never clears the hub (innerRadius)`).toBeGreaterThan(
        p.innerRadius,
      );
    }
  }

  it("v7's real flower_default.FULL (8 components, Other included)", () => {
    const flower = defaultFlowerComponents(BOOT_V7, "FULL")!;
    expect(flower.components).toHaveLength(8);
    assertRealPetals(flower.components, 8);
  });

  it("v9's real flower_default.AK, de-duplicated to 7 (the primprod/primary producer collision)", () => {
    const flower = defaultFlowerComponents(BOOT_V9, "AK")!;
    expect(flower.components).toHaveLength(7);
    assertRealPetals(flower.components, 7);
  });

  // manual seeded-fault proof (CLAUDE.md: "a check that cannot fail is not a check"), mirroring the
  // committed `tests/faults/flower-petal-colour-dropped.patch` (wired into `npm run test:faults`,
  // PW_PORT 4393): temporarily deleting categories.ts's `other: "other"` SYNONYMS row makes
  // `categoryFor("other")` return `NO_DATA_CATEGORY` and turns the v7 test above red on its
  // "fell back to the 'no data' token" assertion -- verified by hand while writing this fix,
  // reverted before committing (the patch file is the permanent, applied proof).
  it("categoryFor('other') resolves to the real category today (the fault this guards against)", () => {
    expect(categoryFor("other").color).toBe("--cat-other");
    expect(categoryFor("other").color).not.toBe(NO_DATA_CATEGORY.color);
  });
});

// owner review item 9 (Ben, live 0.10.62): "In v1 I am seeing flower plot with component 'No
// data', which should not exist." RED-FIRST: fails on the pre-fix tree (a petal literally labelled
// "No data" for the real, scored `extrisk_reptile_ecoregion_rescaled` component -- see
// BOOT_V1_PLANAREA's own header, `tests/lens/scores/fixtures.ts`, for where the real v1 metrics
// this exercises came from).
describe("owner review item 9: v1's real reptile component never renders as 'No data'", () => {
  it("every one of v1's real zone components resolves to a real petal with its OWN label, never the literal 'No data'", () => {
    const rows = zoneRows(BOOT_V1_PLANAREA, "ecoregion");
    const flower = zoneFlowerComponents(rows, "CAC")!;
    expect(flower).not.toBeNull();
    // 8 real _ecoregion_rescaled keys minus the dropped "all" total = 8 components (bird, coral,
    // fish, invertebrate, mammal, other, reptile, primprod).
    expect(flower.components).toHaveLength(8);
    expect(flower.droppedLabels).toEqual([]);

    const geometry = computeFlowerGeometry(flower.components);
    expect(geometry.petals).toHaveLength(8);
    for (const p of geometry.petals) {
      expect(p.category.label, `petal "${p.key}" must never read literally "No data"`).not.toBe(
        "No data",
      );
    }

    // the reptile component specifically: a real, sentence-cased name (categoryLabel()'s own
    // rule, matching every other surface -- ResultsPanel/SpeciesTable/ZonesTable), not the
    // "not reportable" grey bucket's own hardcoded text.
    const reptile = geometry.petals.find((p) => p.key === "reptile")!;
    expect(reptile).toBeDefined();
    expect(reptile.category.label).toBe("Reptile");
    expect(reptile.score).toBeCloseTo(15.8720487921304, 6);
  });
});
