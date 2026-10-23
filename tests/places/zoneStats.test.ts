import { describe, expect, it } from "vitest";
import {
  allZoneStats,
  paLabel,
  summarizeZoneStats,
  zoneCellsAvailable,
  zoneBboxFromFeatures,
  zoneCenterFromBoot,
  zoneComponentScores,
  zoneDisplayName,
  zoneNCellsFor,
  zoneStatFromBoot,
  zoneStatsFor,
  zoneBboxesByKeyFromFeatures,
  ZONE_CELLS_UNAVAILABLE_REASON,
} from "../../src/places/zoneStats";
import { PROGRAM_AREA_NAMES } from "../../src/lib/zones/programAreaNames";

const BOOT = {
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "St. George Basin",
        area_km2: 16850,
        pct_covered: 100,
        composite: 33.9,
        label_pt: [188.5, 56.6],
      },
      { key: "WGA", name: "Western Gulf of Alaska", area_km2: 22000, composite: 21.1 },
    ],
  },
};

describe("zoneStatFromBoot", () => {
  it("reads a row's numbers, tolerant of a `coverage` alias and a `score` alias", () => {
    expect(zoneStatFromBoot(BOOT, "programarea", "GAA")).toEqual({
      key: "GAA",
      name: "St. George Basin",
      areaKm2: 16850,
      coveragePct: 100,
      composite: 33.9,
    });
  });

  it("returns null for a key the release doesn't publish", () => {
    expect(zoneStatFromBoot(BOOT, "programarea", "ZZZ")).toBeNull();
  });

  it("returns null for an absent unit or a boot with no zones at all", () => {
    expect(zoneStatFromBoot(BOOT, "ecoregion", "GAA")).toBeNull();
    expect(zoneStatFromBoot(null, "programarea", "GAA")).toBeNull();
    expect(zoneStatFromBoot({}, "programarea", "GAA")).toBeNull();
  });
});

describe("zoneStatsFor", () => {
  it("keeps every key in order, even one with no boot row (name falls back to the key, numbers null)", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "ZZZ"]);
    expect(stats).toEqual([
      { key: "GAA", name: "St. George Basin", areaKm2: 16850, coveragePct: 100, composite: 33.9 },
      {
        key: "ZZZ",
        name: "ZZZ",
        areaKm2: null,
        coveragePct: null,
        composite: null,
        status: "unpublished",
      },
    ]);
  });
});

describe("summarizeZoneStats", () => {
  it("sums area, means composite/coverage over the KNOWN values only", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "WGA"]);
    expect(summarizeZoneStats(stats)).toEqual({
      areaKm2: 16850 + 22000,
      coveragePct: 100, // WGA has none -- the mean is over GAA alone
      composite: (33.9 + 21.1) / 2,
    });
  });

  // P8 item 2: a composite-less summary is a permanent fact about the release ("unpublished"),
  // never silently indistinguishable from "not analysed yet" -- `Places.svelte`'s zone-row branch
  // reads this `status` to pick the honest chip.
  it("status is 'unpublished' when nothing is known", () => {
    expect(
      summarizeZoneStats([
        { key: "x", name: "x", areaKm2: null, coveragePct: null, composite: null },
      ]),
    ).toEqual({ areaKm2: null, coveragePct: null, composite: null, status: "unpublished" });
  });
});

// P8 item 2 (P7 handback + Opus docs review finding #27): the ORIGINAL fixture above (flat
// `composite`/`pct_covered` fields) is not what a real release publishes -- every Program-Area row
// was reading undefined fields and showing "not analysed yet" forever. This fixture is copied from
// the REAL live v7 `boot.json` (`s3://oceanmetrics.io-public/marine-atlas/v7/app/boot.json`,
// `zones.programarea[0]` and `[1]`, and the one `layers` row with `category: "composite"`), values
// verbatim.
const REAL_V7_BOOT = {
  layers: [
    { metric_key: "primprod", category: "raw" },
    { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component" },
    {
      metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
      label:
        "Combined score of extinction risk per species category and primary productivity, equally weighted",
      category: "composite",
    },
  ],
  zones: {
    programarea: [
      {
        key: "ALA",
        n_cells: 45790,
        area_km2: 875225.027218056,
        n_taxa: 2503,
        metrics: {
          extrisk_bird: 89.085250176649,
          extrisk_bird_ecoregion_rescaled: 42.3898340211856,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 28.2800625961801,
        },
        coverage: null,
      },
      {
        key: "ALB",
        n_cells: 10272,
        area_km2: 167874.54763979,
        n_taxa: 1222,
        metrics: {
          extrisk_bird: 47.1228117341986,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 12.2811149697871,
        },
        coverage: null,
      },
    ],
  },
};

describe("zoneStatFromBoot on the REAL v7 boot.json shape (P8 item 2)", () => {
  it("reads the composite NESTED under metrics[compositeMetricKey], not a flat `composite` field", () => {
    expect(zoneStatFromBoot(REAL_V7_BOOT, "programarea", "ALA")).toEqual({
      key: "ALA",
      name: "ALA", // v7 publishes no `name` on the row -- bare key (docs review finding #23)
      areaKm2: 875225.027218056,
      coveragePct: null, // `coverage: null` published explicitly -- "not published", read as null
      composite: 28.2800625961801,
    });
  });

  it("a second zone reads its OWN composite, not the first's", () => {
    expect(zoneStatFromBoot(REAL_V7_BOOT, "programarea", "ALB")?.composite).toBe(12.2811149697871);
  });

  it("status is 'unpublished' -- never 'not analysed yet' -- when metrics carries no composite key at all", () => {
    const noComposite = {
      layers: REAL_V7_BOOT.layers,
      zones: {
        programarea: [{ key: "ZZZ", area_km2: 1, metrics: { extrisk_bird: 1 }, coverage: null }],
      },
    };
    expect(zoneStatFromBoot(noComposite, "programarea", "ZZZ")).toEqual({
      key: "ZZZ",
      name: "ZZZ",
      areaKm2: 1,
      coveragePct: null,
      composite: null,
      status: "unpublished",
    });
  });

  it("a Program-Area row shows its composite AND coverage when both are actually present", () => {
    const withCoverage = {
      layers: REAL_V7_BOOT.layers,
      zones: {
        programarea: [
          {
            key: "GEO",
            area_km2: 100,
            pct_covered: 42.1,
            metrics: {
              score_extriskspcat_primprod_ecoregionrescaled_equalweights: 27.2,
            },
          },
        ],
      },
    };
    expect(zoneStatFromBoot(withCoverage, "programarea", "GEO")).toEqual({
      key: "GEO",
      name: "GEO",
      areaKm2: 100,
      coveragePct: 42.1,
      composite: 27.2,
    });
  });
});

describe("zoneDisplayName", () => {
  // P3 fix (owner-reported, 2026-09-24): "Program area selection should list full names and
  // parenthetical acronyms" -- every resolved zone name now carries its acronym in parens
  // (`paLabel`), never the bare name alone. Seeded fault: dropping the `paLabel` call here turns
  // this back into "St. George Basin, Western Gulf of Alaska" -- red.
  it("joins resolved 'Name (KEY)' labels with ', '", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["GAA", "WGA"]);
    expect(zoneDisplayName(stats)).toBe("St. George Basin (GAA), Western Gulf of Alaska (WGA)");
  });

  it("a zone with no boot row falls back to the bare key, not 'ZZZ (ZZZ)'", () => {
    const stats = zoneStatsFor(BOOT, "programarea", ["ZZZ"]);
    expect(zoneDisplayName(stats)).toBe("ZZZ");
  });
});

describe("paLabel (P3: 'Aleutian Arc (ALA)' style labels everywhere a Program Area is shown)", () => {
  it("formats 'Name (KEY)' when a name is published", () => {
    expect(paLabel("ALA", "Aleutian Arc")).toBe("Aleutian Arc (ALA)");
  });

  it("falls back to the bare key when neither the bundle nor PROGRAM_AREA_NAMES has a name", () => {
    // V1 fix: "ALA" now resolves through the app-side table (see the dedicated describe block
    // below), so this uses "ZZZ" -- a key that is genuinely nowhere -- to keep testing the
    // true last-resort branch.
    expect(paLabel("ZZZ", undefined)).toBe("ZZZ");
    expect(paLabel("ZZZ", null)).toBe("ZZZ");
    expect(paLabel("ZZZ", "")).toBe("ZZZ");
  });

  it("falls back to the bare key rather than 'ZZZ (ZZZ)' when name already equals the key", () => {
    expect(paLabel("ZZZ", "ZZZ")).toBe("ZZZ");
  });
});

// V1 fix (Opus eyes-on review, 2026-09-24): "Program Area picker and labels are acronym-only" --
// the P3 formatting above never actually fired live, because NO published app bundle (v6-v9)
// carries a `name` on its `zones.programarea` rows (REAL_V7_BOOT above IS that shape: `name` is
// absent on every row). `PROGRAM_AREA_NAMES` (scripts/gen-program-area-names.mjs, generated from
// the canonical Program-Area geometry) is the app-side fallback `paLabel` now consults.
describe("paLabel PROGRAM_AREA_NAMES fallback (V1 fix)", () => {
  it(
    "every key in the v7 fixture boot.json's programarea list resolves to a non-key label -- " +
      "the exact bug Ben saw live (a real bundle publishes no `name` at all)",
    () => {
      for (const row of REAL_V7_BOOT.zones.programarea) {
        const label = paLabel(row.key, undefined);
        expect(label).not.toBe(row.key);
        expect(label).toBe(`${PROGRAM_AREA_NAMES[row.key]} (${row.key})`);
      }
    },
  );

  it("resolves every one of the 20 published Program Areas, not just the two in the fixture", () => {
    for (const [key, name] of Object.entries(PROGRAM_AREA_NAMES)) {
      expect(paLabel(key, undefined)).toBe(`${name} (${key})`);
    }
  });

  it("precedence: a bundle-published name wins over the table", () => {
    expect(paLabel("GEO", "Bundle's Own Name")).toBe("Bundle's Own Name (GEO)");
  });

  it("precedence: the table wins over the bare key when the bundle publishes none", () => {
    expect(paLabel("GEO", undefined)).toBe("St. George Basin (GEO)");
    expect(paLabel("GEO", null)).toBe("St. George Basin (GEO)");
    expect(paLabel("GEO", "")).toBe("St. George Basin (GEO)");
  });

  it("precedence: the bare key is the last resort when neither publishes a name", () => {
    expect(paLabel("ZZZ", undefined)).toBe("ZZZ");
  });

  it("'(KEY)' suffix format: always the acronym in parens after a single space", () => {
    expect(paLabel("GEO", undefined)).toMatch(/^St\. George Basin \(GEO\)$/);
  });

  it("unit scoping: the table is skipped for a non-programarea unit, even on a colliding key", () => {
    // "GEO" collides with a real Program Area key -- an ecoregion/subregion match must never
    // borrow its name.
    expect(paLabel("GEO", undefined, "ecoregion")).toBe("GEO");
    expect(paLabel("GEO", undefined, "subregion")).toBe("GEO");
  });

  it("unit scoping: omitting `unit` (every in-app-only Program Area call site) still resolves it", () => {
    expect(paLabel("GEO", undefined, undefined)).toBe("St. George Basin (GEO)");
    expect(paLabel("GEO", undefined, "programarea")).toBe("St. George Basin (GEO)");
  });
});

// zoneDisplayName is the function Places.svelte/ResultsPanel.svelte actually call for the list
// row / results panel title -- proving the fallback flows all the way through, not just paLabel
// in isolation.
describe("zoneDisplayName over a REAL_V7_BOOT-shaped release (no published `name`, V1 fix)", () => {
  it("shows the full name, not the bare key, for a real release's Program Area rows", () => {
    const stats = zoneStatsFor(REAL_V7_BOOT, "programarea", ["ALA", "ALB"]);
    expect(zoneDisplayName(stats)).toBe("Aleutian Arc (ALA), Aleutian Basin (ALB)");
  });
});

describe("allZoneStats (P3, orchestrator-directed 2026-09-24: the Places panel's 'Add a Program Area' chooser)", () => {
  // boot's OWN publish order is deliberately NOT alphabetical, so this proves the sort, not a
  // coincidence of the fixture's order.
  const UNSORTED_BOOT = {
    zones: {
      programarea: [
        { key: "WGA", name: "Western Gulf of Alaska", area_km2: 22000, composite: 21.1 },
        { key: "GAA", name: "St. George Basin", area_km2: 16850, composite: 33.9 },
        { key: "ZZZ", area_km2: 1 }, // no boot `name` -- falls back to the bare key
      ],
    },
  };

  it("returns every published zone, sorted by its resolved paLabel text (not boot's publish order)", () => {
    const stats = allZoneStats(UNSORTED_BOOT, "programarea");
    expect(stats.map((s) => paLabel(s.key, s.name))).toEqual([
      "St. George Basin (GAA)",
      "Western Gulf of Alaska (WGA)",
      "ZZZ",
    ]);
  });

  it("is [] for a unit the release does not publish, never a throw", () => {
    expect(allZoneStats(UNSORTED_BOOT, "ecoregion")).toEqual([]);
    expect(allZoneStats(null, "programarea")).toEqual([]);
    expect(allZoneStats({}, "programarea")).toEqual([]);
  });
});

describe("zoneCenterFromBoot", () => {
  it("is the mean of the picked keys' label points (zoneLabelsFromBoot's own -180..180 rewrap)", () => {
    // label_pt is cached 0-360 (map/layers/zones.ts); 188.5 comes back as 188.5 - 360 = -171.5.
    expect(zoneCenterFromBoot(BOOT, "programarea", ["GAA"])).toEqual({ lon: -171.5, lat: 56.6 });
  });

  it("is null when the unit has no labels at all", () => {
    expect(zoneCenterFromBoot(BOOT, "ecoregion", ["GAA"])).toBeNull();
  });

  it("is null when none of the picked keys has a label point", () => {
    expect(zoneCenterFromBoot(BOOT, "programarea", ["WGA"])).toBeNull();
  });
});

// owner review item 1 (live 0.10.62): "entering a Program Area in the search bar should zoom to
// it" -- RED-FIRST, this covers the real fallback `zoneBoundsFromMap` (state.svelte.ts) leans on
// when (as every published release does today) `zoneCenterFromBoot` above has nothing.
describe("zoneBboxFromFeatures", () => {
  it("is the combined bbox of a single Polygon feature (a MapLibre querySourceFeatures result)", () => {
    const features = [
      {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-170, 20],
              [-168, 20],
              [-168, 22],
              [-170, 22],
              [-170, 20],
            ],
          ],
        },
      },
    ];
    expect(zoneBboxFromFeatures(features)).toEqual([
      [-170, 20],
      [-168, 22],
    ]);
  });

  it("unions a MultiPolygon feature's rings", () => {
    const features = [
      {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [-170, 20],
                [-169, 20],
                [-169, 21],
                [-170, 21],
                [-170, 20],
              ],
            ],
            [
              [
                [-160, 30],
                [-159, 30],
                [-159, 31],
                [-160, 31],
                [-160, 30],
              ],
            ],
          ],
        },
      },
    ];
    expect(zoneBboxFromFeatures(features)).toEqual([
      [-170, 20],
      [-159, 31],
    ]);
  });

  it("is null when the query found no feature (tile not loaded, or an unpublished key)", () => {
    expect(zoneBboxFromFeatures([])).toBeNull();
  });

  it("ignores a non-polygon geometry rather than throwing", () => {
    expect(
      zoneBboxFromFeatures([{ geometry: { type: "Point", coordinates: [-170, 20] } }]),
    ).toBeNull();
  });
});

// W6 fix (Ben's live-site report, 2026-09-25): "a second Program-Area search pick does not zoom" --
// `zoneBoundsFromMap` used to query FILTERED to one key, which only ever answers from tiles loaded
// for the CURRENT viewport; after the first pick's own flyToBounds zoomed in tight, a second zone's
// tile was never requested and the query came back empty forever after. This groups an UNFILTERED
// query's features by key in one pass, so a caller can cache every zone visible in the same batch.
describe("zoneBboxesByKeyFromFeatures", () => {
  const gaa = {
    properties: { programarea_key: "GAA" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-158, 26],
          [-156, 26],
          [-156, 28],
          [-158, 28],
          [-158, 26],
        ],
      ],
    },
  };
  const ala = {
    properties: { programarea_key: "ALA" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-170, 20],
          [-168, 20],
          [-168, 22],
          [-170, 22],
          [-170, 20],
        ],
      ],
    },
  };

  it("groups an unfiltered feature list into one bbox per key", () => {
    const byKey = zoneBboxesByKeyFromFeatures([gaa, ala], "programarea_key");
    expect(byKey.get("GAA")).toEqual([
      [-158, 26],
      [-156, 28],
    ]);
    expect(byKey.get("ALA")).toEqual([
      [-170, 20],
      [-168, 22],
    ]);
    expect(byKey.size).toBe(2);
  });

  it("unions multiple features that share the same key", () => {
    const gaaWestLobe = {
      properties: { programarea_key: "GAA" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-160, 25],
            [-159, 25],
            [-159, 26],
            [-160, 26],
            [-160, 25],
          ],
        ],
      },
    };
    const byKey = zoneBboxesByKeyFromFeatures([gaa, gaaWestLobe], "programarea_key");
    expect(byKey.get("GAA")).toEqual([
      [-160, 25],
      [-156, 28],
    ]);
  });

  it("a feature with no key property, or an empty feature list, is dropped rather than throwing", () => {
    expect(
      zoneBboxesByKeyFromFeatures([{ properties: {}, geometry: gaa.geometry }], "programarea_key")
        .size,
    ).toBe(0);
    expect(zoneBboxesByKeyFromFeatures([], "programarea_key").size).toBe(0);
  });
});

// Q3 (P round, item 1): the zone results panel's own model -- coverage note ("N cells")/component
// table -- read straight off REAL_V7_BOOT above, the same "real v7 boot.json shape" fixture the
// composite/coverage tests already pin (n_cells/metrics/`coverage: null`).
describe("zoneNCellsFor (Q3 item 1: the results panel's coverage note)", () => {
  it("reads one zone's published n_cells", () => {
    expect(zoneNCellsFor(REAL_V7_BOOT, "programarea", ["ALA"])).toBe(45790);
    expect(zoneNCellsFor(REAL_V7_BOOT, "programarea", ["ALB"])).toBe(10272);
  });

  it("sums n_cells over several keys (a multi-pick zone place)", () => {
    expect(zoneNCellsFor(REAL_V7_BOOT, "programarea", ["ALA", "ALB"])).toBe(45790 + 10272);
  });

  it("is null for a key the release doesn't publish, or a boot with no zones at all", () => {
    expect(zoneNCellsFor(REAL_V7_BOOT, "programarea", ["ZZZ"])).toBeNull();
    expect(zoneNCellsFor(null, "programarea", ["ALA"])).toBeNull();
  });

  it("skips an unknown key but still sums the known ones", () => {
    expect(zoneNCellsFor(REAL_V7_BOOT, "programarea", ["ALA", "ZZZ"])).toBe(45790);
  });
});

describe("zoneComponentScores (Q3 item 1: the results panel's component table)", () => {
  it("keeps every published component metric_key, labelled the SAME way the flower would", () => {
    expect(zoneComponentScores(REAL_V7_BOOT, "programarea", "ALA")).toEqual([
      { metric_key: "extrisk_bird_ecoregion_rescaled", component: "bird", score: 42.3898340211856 },
    ]);
  });

  it("a second zone reads its OWN metrics, not the first's", () => {
    expect(zoneComponentScores(REAL_V7_BOOT, "programarea", "ALB")).toEqual([]); // ALB's fixture
    // row carries no `extrisk_bird_ecoregion_rescaled` key -- the released, unrescaled `extrisk_bird`
    // does not match `componentMetricKeys()`'s own `_ecoregion_rescaled$` pattern, so this is
    // correctly empty, not a bug in the fixture.
  });

  it("[] for an unknown zone/key or a boot with no zones at all (never a throw)", () => {
    expect(zoneComponentScores(REAL_V7_BOOT, "programarea", "ZZZ")).toEqual([]);
    expect(zoneComponentScores(null, "programarea", "ALA")).toEqual([]);
    expect(zoneComponentScores({}, "programarea", "ALA")).toEqual([]);
  });

  // seeded fault (places-zone-components-collapsed): a component reader that ONLY ever looked at
  // the release's composite metric_key (instead of every `componentMetricKeys()` entry) would
  // return [] here too, indistinguishable from "no component data published" -- this fixture has
  // a real component, so a regression to that shape goes red.
  it("does not collapse to [] when a real component metric IS published", () => {
    expect(zoneComponentScores(REAL_V7_BOOT, "programarea", "ALA").length).toBeGreaterThan(0);
  });
});

describe("zoneCellsAvailable / ZONE_CELLS_UNAVAILABLE_REASON (Q3 item 1: 'Show analysis cells' for a zone)", () => {
  it("is false today -- no zone_cell data path exists yet -- for any boot", () => {
    expect(zoneCellsAvailable(REAL_V7_BOOT)).toBe(false);
    expect(zoneCellsAvailable(null)).toBe(false);
    expect(zoneCellsAvailable({})).toBe(false);
  });

  it("the reason names Program Areas, not a generic refusal", () => {
    expect(ZONE_CELLS_UNAVAILABLE_REASON).toMatch(/Program Area/);
    expect(ZONE_CELLS_UNAVAILABLE_REASON.length).toBeGreaterThan(20);
  });
});
