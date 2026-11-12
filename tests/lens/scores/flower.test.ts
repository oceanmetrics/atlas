import { describe, expect, it } from "vitest";
import { zoneRows } from "../../../src/lens/scores/boot";
import {
  cellFlowerComponents,
  componentLabel,
  dedupeFlowerComponents,
  defaultFlowerComponents,
  ecoregionComponentName,
  ecoregionMetricKey,
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

  // v9's GAA zone publishes BOTH `extrisk_primary_producer_ecoregion_rescaled` (the Flora species
  // category) and `primprod_ecoregion_rescaled` (productivity, an environmental component). Both
  // are equal-weight inputs of the composite. atlas 0.9.12-0.6.0 folded them onto one category and
  // dropped productivity; 0.6.1 draws all 8.
  describe("v9's GAA zone (Flora and productivity both present)", () => {
    const flower = zoneFlowerComponents(zoneRows(BOOT_V9, "programarea"), "GAA")!;

    it("keeps all 8 components, Flora and productivity each its own", () => {
      expect(flower.components).toHaveLength(8);
      expect(flower.components.map((c) => c.key)).toContain("primary producer");
      expect(flower.components.map((c) => c.key)).toContain("primprod");
      expect(flower.droppedLabels).toEqual([]);
    });

    it("computeFlowerGeometry draws 8 petals with centre = round(mean of all 8)", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(8);
      const mean =
        flower.components.reduce((sum, c) => sum + (c.score ?? 0), 0) / flower.components.length;
      expect(Math.round(g.centerValue!)).toBe(Math.round(mean));
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
  describe("v9's flower_default.AK (Flora and productivity both present)", () => {
    const flower = defaultFlowerComponents(BOOT_V9, "AK")!;

    it("keeps all 8 components in the published order", () => {
      expect(flower.components.map((c) => c.key)).toEqual([
        "bird",
        "coral",
        "fish",
        "invertebrate",
        "mammal",
        "primary producer",
        "turtle",
        "primprod",
      ]);
      expect(flower.droppedLabels).toEqual([]);
    });

    it("computeFlowerGeometry draws 8 petals with centre = round(mean of all 8)", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(8);
      // (31.58+16.73+18.97+22.84+27.91+15.51+18.39+5.64)/8 = 19.697...
      expect(Math.round(g.centerValue!)).toBe(20);
    });
  });

  // REGRESSION (atlas 0.6.1, owner-reported 2026-11-12): v11's All US waters drew 7 petals with
  // "Primary production" 12.4 (actually Flora) and a Mean of 21; productivity (9.21) was dropped.
  // The published composite (score_extriskspcat_primprod_ecoregionrescaled_equalweights, USA) is
  // 19.1767 = the mean of these 8 rows. The exact live v11 flower_default.USA, curl'd 2026-11-12.
  describe("v11 flower_default.USA: productivity is not dropped (the 0.6.1 regression)", () => {
    const V11_USA = [
      { component: "bird", score: 25.6280399429547 },
      { component: "coral", score: 10.1486516349469 },
      { component: "fish", score: 17.2610465605113 },
      { component: "invertebrate", score: 14.7572484746423 },
      { component: "mammal", score: 33.2234728914032 },
      { component: "primary producer", score: 12.3796504990308 },
      { component: "turtle", score: 30.8054423603537 },
      { component: "primprod", score: 9.21030895993716 },
    ];
    const flower = defaultFlowerComponents({ flower_default: { USA: V11_USA } }, "USA")!;

    it("draws 8 petals, productivity 9.21 among them", () => {
      expect(flower.components).toHaveLength(8);
      expect(flower.droppedLabels).toEqual([]);
      expect(flower.components.find((c) => c.key === "primprod")?.score).toBeCloseTo(9.2103, 4);
      const g = computeFlowerGeometry(flower.components);
      expect(g.petals).toHaveLength(8);
    });

    it("Flora and productivity draw with different labels and colours", () => {
      const g = computeFlowerGeometry(flower.components);
      const fl = g.petals.find((p) => p.key === "primary producer")!;
      const pp = g.petals.find((p) => p.key === "primprod")!;
      expect(fl.category.label).not.toBe(pp.category.label);
      expect(fl.category.color).not.toBe(pp.category.color);
    });

    it("the centre is the published composite, 19.18 (rounds to 19, not 21)", () => {
      const g = computeFlowerGeometry(flower.components);
      expect(g.centerValue!).toBeCloseTo(19.1767, 3);
      expect(Math.round(g.centerValue!)).toBe(19);
    });
  });
});

describe("dedupeFlowerComponents", () => {
  it("keeps the `preferred` candidate on a category collision, in original input order", () => {
    // two spellings of ONE category (flora) still collide
    const result = dedupeFlowerComponents([
      { key: "primary producer", score: 15.5, preferred: true },
      { key: "primary_producer", score: 5.6, preferred: false },
    ]);
    expect(result.components).toEqual([{ key: "primary producer", score: 15.5 }]);
    expect(result.droppedLabels).toEqual(["primary_producer"]);
  });

  it("never treats Flora and productivity as a collision (the 0.6.1 regression)", () => {
    const result = dedupeFlowerComponents([
      { key: "primary producer", score: 15.5, preferred: true },
      { key: "primprod", score: 5.6, preferred: false },
    ]);
    expect(result.components).toEqual([
      { key: "primary producer", score: 15.5 },
      { key: "primprod", score: 5.6 },
    ]);
    expect(result.droppedLabels).toEqual([]);
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

  it("v8+ cell click: keeps both extrisk_primary_producer and primprod", () => {
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
      { key: "primprod", score: 10.8 },
    ]);
    expect(result.droppedLabels).toEqual([]);
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

  it("v9's real flower_default.AK: all 8, Flora and productivity each a real petal", () => {
    const flower = defaultFlowerComponents(BOOT_V9, "AK")!;
    expect(flower.components).toHaveLength(8);
    assertRealPetals(flower.components, 8);
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

// atlas 0.6.1: the ecoregion flower names its components by the release's own wording
describe("ecoregion component names from the manifest", () => {
  it("maps a flower_default component back to its metric key", () => {
    expect(ecoregionMetricKey("primary producer")).toBe(
      "extrisk_primary_producer_ecoregion_rescaled",
    );
    expect(ecoregionMetricKey("primprod")).toBe("primprod_ecoregion_rescaled");
    expect(ecoregionMetricKey("bird")).toBe("extrisk_bird_ecoregion_rescaled");
  });

  it("takes the name before ':' or ' (' when it is a capitalised name", () => {
    const labels = {
      extrisk_primary_producer_ecoregion_rescaled: "Flora: extinction risk (ecoregion-rescaled)",
      primprod_ecoregion_rescaled: "Productivity (ecoregion-rescaled)",
      extrisk_bird_ecoregion_rescaled: "Seabirds: extinction risk (ecoregion-rescaled)",
    };
    expect(ecoregionComponentName("extrisk_primary_producer_ecoregion_rescaled", labels)).toBe(
      "Flora",
    );
    expect(ecoregionComponentName("primprod_ecoregion_rescaled", labels)).toBe("Productivity");
    expect(ecoregionComponentName("extrisk_bird_ecoregion_rescaled", labels)).toBe("Seabirds");
  });

  it("rejects a key-fragment label (v7-v10 curation) and a missing one", () => {
    const labels = {
      extrisk_bird_ecoregion_rescaled: "bird: ext. risk, ecorgn",
      primprod_ecoregion_rescaled: "prim prod, ecorgn",
      extrisk_fish_ecoregion_rescaled: "Fish, ecoregion",
    };
    expect(ecoregionComponentName("extrisk_bird_ecoregion_rescaled", labels)).toBeUndefined();
    expect(ecoregionComponentName("primprod_ecoregion_rescaled", labels)).toBeUndefined();
    expect(ecoregionComponentName("extrisk_fish_ecoregion_rescaled", labels)).toBeUndefined();
    expect(ecoregionComponentName("extrisk_coral_ecoregion_rescaled", labels)).toBeUndefined();
    expect(ecoregionComponentName("extrisk_coral_ecoregion_rescaled", undefined)).toBeUndefined();
  });

  it("defaultFlowerComponents labels Flora and Productivity from a v11-style manifest", () => {
    const boot = {
      flower_default: {
        USA: [
          { component: "primary producer", score: 12.38 },
          { component: "primprod", score: 9.21 },
          { component: "bird", score: 25.63 },
        ],
      },
    };
    const labels = {
      extrisk_primary_producer_ecoregion_rescaled: "Flora: extinction risk (ecoregion-rescaled)",
      primprod_ecoregion_rescaled: "Productivity (ecoregion-rescaled)",
      extrisk_bird_ecoregion_rescaled: "bird: ext. risk, ecorgn",
    };
    const flower = defaultFlowerComponents(boot, "USA", labels)!;
    expect(flower.components).toEqual([
      { key: "primary producer", score: 12.38, label: "Flora" },
      { key: "primprod", score: 9.21, label: "Productivity" },
      { key: "bird", score: 25.63 },
    ]);
    const g = computeFlowerGeometry(flower.components);
    expect(g.petals.map((p) => p.category.label)).toEqual(["Flora", "Productivity", "Bird"]);
  });

  it("zone and cell flowers read the same names", () => {
    const labels = { primprod_ecoregion_rescaled: "Productivity (ecoregion-rescaled)" };
    const zone = zoneFlowerComponents(
      [{ key: "Z", n_taxa: 1, metrics: { primprod_ecoregion_rescaled: 5 } }] as never,
      "Z",
      undefined,
      labels,
    )!;
    expect(zone.components).toEqual([{ key: "primprod", score: 5, label: "Productivity" }]);
    const cell = cellFlowerComponents(
      [{ metric_key: "primprod_ecoregion_rescaled", val: 5, component: "primprod" }],
      undefined,
      labels,
    );
    expect(cell.components).toEqual([{ key: "primprod", score: 5, label: "Productivity" }]);
  });
});
