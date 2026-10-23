import { describe, expect, it } from "vitest";
import {
  defaultLayerKey,
  ecoregionZoneUnitFromManifest,
  flowerMaxComponentScore,
  layerByKey,
  layerGroups,
  metricKeyLabel,
  metricLabelsFromManifest,
  primaryUnitLabel,
  primaryUnitNote,
  primaryUnitType,
  unitOptions,
  zoneAllKey,
  zoneBboxFromBoot,
  zoneCacheKey,
  zoneKnownBounds,
  zoneRows,
} from "../../../src/lens/scores/boot";
import { BOOT_V1_PLANAREA, BOOT_V7 } from "./fixtures";

describe("primaryUnitType / primaryUnitLabel (D17: exactly one boot.units row)", () => {
  it("v7: programarea", () => {
    expect(primaryUnitType(BOOT_V7)).toBe("programarea");
    expect(primaryUnitLabel(BOOT_V7)).toBe("Program areas");
  });

  it("v1: planarea", () => {
    expect(primaryUnitType(BOOT_V1_PLANAREA)).toBe("planarea");
  });

  it("no units published: null, never a throw", () => {
    expect(primaryUnitType({})).toBeNull();
    expect(primaryUnitType(null)).toBeNull();
  });
});

describe("unitOptions", () => {
  it("cell first, then the release's one unit", () => {
    expect(unitOptions(BOOT_V7)).toEqual([
      { value: "cell", label: "Raster cells" },
      { value: "programarea", label: "Program areas" },
    ]);
  });

  it("cell only when no unit is published", () => {
    expect(unitOptions({})).toEqual([{ value: "cell", label: "Raster cells" }]);
  });

  // R3 (Ben, live-review 2026-09-25): "drop clunky '(0.05°)'" -- a permanent regression fixture,
  // not just an incidental string match above.
  it("R3: the resolution note is gone from the label", () => {
    expect(unitOptions(BOOT_V7)[0].label).toBe("Raster cells");
    expect(unitOptions(BOOT_V7)[0].label).not.toContain("0.05");
  });
});

describe("primaryUnitNote", () => {
  it("v1 predates Program Areas: the note names the release and the label", () => {
    expect(primaryUnitNote(BOOT_V1_PLANAREA, "v1")).toBe(
      "v1 predates the BOEM Program Areas — it reports on Planning areas.",
    );
  });

  it("v7 already reports on programarea: no note", () => {
    expect(primaryUnitNote(BOOT_V7, "v7")).toBeNull();
  });

  it("no unit published: no note (nothing to caveat)", () => {
    expect(primaryUnitNote({}, "v0")).toBeNull();
  });
});

describe("layerGroups / defaultLayerKey", () => {
  it("groups composite, component, raw — each sorted by order", () => {
    const groups = layerGroups(BOOT_V7);
    expect(groups.map((g) => g.category)).toEqual(["composite", "component", "raw"]);
    const component = groups.find((g) => g.category === "component")!;
    expect(component.layers.map((l) => l.metric_key)).toEqual([
      "extrisk_bird_ecoregion_rescaled",
      "extrisk_other_ecoregion_rescaled",
    ]);
  });

  it("the default layer is the composite row, never boot.layers[0] (which is order 1 = raw)", () => {
    expect(defaultLayerKey(BOOT_V7)).toBe(
      "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
    );
  });

  it("no composite row: null, never a guess", () => {
    expect(
      defaultLayerKey({ layers: [{ metric_key: "x", category: "raw", order: 1 }] }),
    ).toBeNull();
  });
});

describe("layerByKey", () => {
  it("finds a real key", () => {
    expect(layerByKey(BOOT_V7, "primprod")?.category).toBe("raw");
  });

  it("unknown/undefined key: null, never a throw (an unknown ?lyr= must fall back)", () => {
    expect(layerByKey(BOOT_V7, "not-a-real-key")).toBeNull();
    expect(layerByKey(BOOT_V7, undefined)).toBeNull();
    expect(layerByKey(BOOT_V7, null)).toBeNull();
  });
});

describe("zoneAllKey", () => {
  it("prefers FULL when present among subregion keys", () => {
    expect(zoneAllKey(BOOT_V7)).toBe("FULL");
  });

  it("falls back to USA when FULL is absent (v1's subregion keys)", () => {
    expect(zoneAllKey(BOOT_V1_PLANAREA)).toBe("USA");
  });

  it("falls back to the literal USA when there is no subregion unit at all", () => {
    expect(zoneAllKey({})).toBe("USA");
  });
});

describe("zoneRows", () => {
  it("reads every zone of a unit with its metrics", () => {
    const rows = zoneRows(BOOT_V7, "programarea");
    expect(rows.map((r) => r.key)).toEqual(["GAA", "GEO"]);
    expect(rows[0].metrics.extrisk_bird_ecoregion_rescaled).toBeCloseTo(59.09);
  });

  it("an unpublished unit: [], never a throw", () => {
    expect(zoneRows(BOOT_V7, "ecoregion")).toEqual([]);
  });
});

// R3 orchestrator audit item 2: the standalone ecoregion outline, read from the release's
// MANIFEST (never `boot.units[]`, which D17 keeps at exactly one row) -- verified live against
// v7's real manifest.json (`zones[]` carries a `zone_set_key: "ecoregion_2025-06"` row).
describe("ecoregionZoneUnitFromManifest", () => {
  const MANIFEST_WITH_ECOREGION = {
    zones: [
      {
        tbl: "ply_ecoregions_2025",
        fld: "ecoregion_key",
        n: 12,
        zone_set_key: "ecoregion_2025-06",
        pmtiles: "https://s3.example/marine-atlas/zones/ecoregion_2025-06/zones.pmtiles",
      },
      {
        tbl: "ply_programareas_2026_v7",
        fld: "programarea_key",
        n: 20,
        zone_set_key: "programarea_2026-01",
        pmtiles: "https://s3.example/marine-atlas/zones/programarea_2026-01/zones.pmtiles",
      },
    ],
  };

  it("finds the ecoregion row among several, and it is outline-only + always visible", () => {
    expect(ecoregionZoneUnitFromManifest(MANIFEST_WITH_ECOREGION)).toEqual({
      unit: "ecoregion",
      pmtiles: "https://s3.example/marine-atlas/zones/ecoregion_2025-06/zones.pmtiles",
      sourceLayer: "ecoregion",
      lineVisible: true,
    });
  });

  it("no fill, no labels, no highlightKey -- never a second choropleth-selectable unit (D17)", () => {
    const unit = ecoregionZoneUnitFromManifest(MANIFEST_WITH_ECOREGION)!;
    expect(unit.fill).toBeUndefined();
    expect(unit.labels).toBeUndefined();
    expect(unit.highlightKey).toBeUndefined();
  });

  it("null when the manifest has no zones array, no ecoregion row, or has not loaded yet", () => {
    expect(ecoregionZoneUnitFromManifest(null)).toBeNull();
    expect(ecoregionZoneUnitFromManifest(undefined)).toBeNull();
    expect(ecoregionZoneUnitFromManifest({})).toBeNull();
    expect(
      ecoregionZoneUnitFromManifest({
        zones: [MANIFEST_WITH_ECOREGION.zones[1]], // programarea only
      }),
    ).toBeNull();
  });

  it("a malformed ecoregion row (missing pmtiles) is skipped, never thrown", () => {
    expect(() =>
      ecoregionZoneUnitFromManifest({ zones: [{ fld: "ecoregion_key" }] }),
    ).not.toThrow();
    expect(ecoregionZoneUnitFromManifest({ zones: [{ fld: "ecoregion_key" }] })).toBeNull();
  });
});

// R3 orchestrator audit item 3: `boot.layers[].label` carries the LONG description (verified live
// on v7: `primprod`'s is a full paragraph), while the ported Shiny app's SHORT names ("fish: ext.
// risk, ecorgn") come from the manifest's `metrics[]` array instead.
describe("metricLabelsFromManifest", () => {
  const MANIFEST_WITH_METRICS = {
    metrics: [
      {
        metric_key: "extrisk_bird",
        subregion_key: "GA",
        label: "bird: ext. risk",
        description: "Extinction risk for bird",
      },
      {
        metric_key: "extrisk_bird",
        subregion_key: "FULL",
        label: "bird: ext. risk",
        description: "Extinction risk for bird",
      },
      { metric_key: "primprod", subregion_key: "FULL", label: "primary productivity" },
    ],
  };

  it("dedupes to one short label per metric_key (first occurrence wins)", () => {
    expect(metricLabelsFromManifest(MANIFEST_WITH_METRICS)).toEqual({
      extrisk_bird: "bird: ext. risk",
      primprod: "primary productivity",
    });
  });

  it("{} when the manifest has no metrics array or has not loaded yet", () => {
    expect(metricLabelsFromManifest(null)).toEqual({});
    expect(metricLabelsFromManifest({})).toEqual({});
  });

  it("a row missing metric_key or label is skipped, never thrown", () => {
    expect(() =>
      metricLabelsFromManifest({ metrics: [{ label: "no key" }, { metric_key: "no_label" }] }),
    ).not.toThrow();
    expect(
      metricLabelsFromManifest({ metrics: [{ label: "no key" }, { metric_key: "no_label" }] }),
    ).toEqual({});
  });
});

// P round deliverable 2 (Ben, live-review 2026-09-24); coordinator follow-up (2026-09-25): the
// flower panel's reference-ring value comes from the release MANIFEST's `metrics[]` (one row per
// `metric_key`×`subregion_key`), never `boot.layers[]` -- boot.json's `by_subregion` exists only on
// the COMPOSITE row on every real release, so the first version of this function could never return
// a real number. Verified live against v7's own manifest.json (2026-09-25, `curl
// .../v7/manifest.json`): every `*_ecoregion_rescaled` row at `subregion_key: "FULL"` --
// `extrisk_{bird,coral,fish,invertebrate,mammal,other,turtle}_ecoregion_rescaled` and
// `primprod_ecoregion_rescaled`, the flower's own 8 -- carries `rescale_max: 100`; the COMPOSITE row
// (`score_extriskspcat_primprod_ecoregionrescaled_equalweights`, which the `_ecoregion_rescaled$`
// filter does NOT match -- "ecoregionrescaled" is one word there, no underscore) carries
// `rescale_max: 93`, the same "0-93" the map's own score legend shows.
function metricRow(
  metricKey: string,
  rescaleMax: number,
  subregionKey = "FULL",
): { metric_key: string; subregion_key: string; rescale_min: number; rescale_max: number } {
  return {
    metric_key: metricKey,
    subregion_key: subregionKey,
    rescale_min: 0,
    rescale_max: rescaleMax,
  };
}

/** the release's real 8 `*_ecoregion_rescaled` metric_keys, verified live against v7's manifest. */
const REAL_COMPONENT_KEYS = [
  "extrisk_bird_ecoregion_rescaled",
  "extrisk_coral_ecoregion_rescaled",
  "extrisk_fish_ecoregion_rescaled",
  "extrisk_invertebrate_ecoregion_rescaled",
  "extrisk_mammal_ecoregion_rescaled",
  "extrisk_other_ecoregion_rescaled",
  "extrisk_turtle_ecoregion_rescaled",
  "primprod_ecoregion_rescaled",
];

describe("flowerMaxComponentScore", () => {
  it("v7's REAL live shape: all 8 components rescale to 100 (ecoregion-rescaling reaches 100 somewhere for each), never confused with the composite's own lower 93", () => {
    const metrics = [
      ...REAL_COMPONENT_KEYS.map((k) => metricRow(k, 100)),
      metricRow("score_extriskspcat_primprod_ecoregionrescaled_equalweights", 93),
    ];
    expect(flowerMaxComponentScore({ metrics })).toBe(100);
  });

  it("a release whose component metrics publish DIFFERENT maxima: the greatest one wins, not the first/last row", () => {
    const metrics = [
      metricRow("extrisk_bird_ecoregion_rescaled", 80),
      metricRow("extrisk_coral_ecoregion_rescaled", 65),
      metricRow("extrisk_fish_ecoregion_rescaled", 93.456), // the winner
      metricRow("extrisk_invertebrate_ecoregion_rescaled", 70),
      metricRow("extrisk_mammal_ecoregion_rescaled", 88),
      metricRow("extrisk_other_ecoregion_rescaled", 55),
      metricRow("extrisk_turtle_ecoregion_rescaled", 60),
      metricRow("primprod_ecoregion_rescaled", 40),
    ];
    expect(flowerMaxComponentScore({ metrics })).toBe(93.456);
  });

  it("only reads subregion_key FULL -- a higher max at a different subregion never wins", () => {
    const metrics = [
      metricRow("extrisk_bird_ecoregion_rescaled", 60, "FULL"),
      metricRow("extrisk_bird_ecoregion_rescaled", 999, "GA"), // a real per-subregion row, ignored
      metricRow("extrisk_coral_ecoregion_rescaled", 70, "FULL"),
    ];
    expect(flowerMaxComponentScore({ metrics })).toBe(70);
  });

  it("ignores a non-component row (composite/raw) even at FULL, and 'all' (dropped the same way flower.ts#fromMetrics drops it)", () => {
    const metrics = [
      metricRow("extrisk_bird_ecoregion_rescaled", 40),
      metricRow("score_extriskspcat_primprod_ecoregionrescaled_equalweights", 93), // composite
      metricRow("primprod", 999), // raw, not _ecoregion_rescaled
      metricRow("extrisk_all_ecoregion_rescaled", 999), // componentLabel(...) === "all"
    ];
    expect(flowerMaxComponentScore({ metrics })).toBe(40);
  });

  it("no metrics array published (has not loaded yet, or a pre-metrics release): null, never a guess", () => {
    expect(flowerMaxComponentScore({})).toBeNull();
    expect(flowerMaxComponentScore(null)).toBeNull();
    expect(flowerMaxComponentScore(undefined)).toBeNull();
  });

  it("a metrics array with no matching row (only raw/composite published): null", () => {
    expect(
      flowerMaxComponentScore({
        metrics: [metricRow("score_extriskspcat_primprod_ecoregionrescaled_equalweights", 93)],
      }),
    ).toBeNull();
  });
});

// R3-B1 (round-3 plan): the ONE title-casing fallback for a bare metric_key -- the Layer <select>
// (LayersPanel.svelte), the legend title (mapInputs.ts), and LegendChip.svelte's chip text (which
// reads the SAME legend.title) all fall back to this when a release publishes no label at all.
describe("metricKeyLabel (R3-B1: title-case a bare metric_key)", () => {
  it("'score' -> 'Score' -- the reported bug", () => {
    expect(metricKeyLabel("score")).toBe("Score");
  });

  it("underscores become spaces, only the first letter capitalizes (sentence case, not Title Case)", () => {
    expect(metricKeyLabel("some_metric_key")).toBe("Some metric key");
  });

  it("already-capitalized/mixed-case input is not re-cased past the first letter", () => {
    expect(metricKeyLabel("primProd")).toBe("PrimProd");
  });

  it("whitespace is trimmed; an empty/blank key returns as-is (no crash on [0])", () => {
    expect(metricKeyLabel("  score  ")).toBe("Score");
    expect(metricKeyLabel("")).toBe("");
    expect(metricKeyLabel("   ")).toBe("");
  });

  // Fix round (orchestrator, 2026-09-25): a curated label that is ITSELF just the bare key is a
  // second way the raw string reaches the UI -- a release publishing `manifest.metrics: [{
  // metric_key: "score", label: "score" }]` used to defeat every caller's own `metricLabels[key]
  // ?? ... ?? metricKeyLabel(key)` chain on the FIRST `??` (a truthy "score" string), never
  // reaching this function at all.
  describe("a `label` argument: title-cases when absent OR identical to the key (case-insensitive)", () => {
    it("no label at all: same as before, title-cases the key", () => {
      expect(metricKeyLabel("score")).toBe("Score");
      expect(metricKeyLabel("score", undefined)).toBe("Score");
      expect(metricKeyLabel("score", null)).toBe("Score");
    });

    // R3-W7 follow-up (Ben, 2026-09-25): a real, different label still wins verbatim -- but its
    // FIRST character is now sentence-cased too (a v7 manifest published a real, non-degenerate
    // "score" label that stayed lowercase forever because it differed from its key).
    it("a REAL, different label wins, sentence-cased -- the common case", () => {
      expect(metricKeyLabel("primprod", "prim prod, 2014-2023 avg (mg C/m^2/day)")).toBe(
        "Prim prod, 2014-2023 avg (mg C/m^2/day)",
      );
    });

    it("R3-W7: a real label that is itself lowercase gets sentence-cased", () => {
      expect(metricKeyLabel("composite_score", "score")).toBe("Score");
    });

    it("the reported bug: a curated label equal to the key (same case) is NOT treated as real", () => {
      expect(metricKeyLabel("score", "score")).toBe("Score");
    });

    it("case-insensitive: 'Score'/'SCORE' as the label are equally degenerate", () => {
      expect(metricKeyLabel("score", "Score")).toBe("Score");
      expect(metricKeyLabel("score", "SCORE")).toBe("Score");
    });

    it("a blank/whitespace-only label is treated the same as absent", () => {
      expect(metricKeyLabel("score", "")).toBe("Score");
      expect(metricKeyLabel("score", "   ")).toBe("Score");
    });

    it("whitespace around an otherwise-real label does not make it 'identical to the key'", () => {
      expect(metricKeyLabel("score", "  Overall score  ")).toBe("Overall score");
    });
  });
});

// R3-B14/C3: `boot.zones[unit][*].bbox` — the published `[west, south, east, north]` a Program-Area
// search pick can fly to WITHOUT a loaded map tile. `zoneRows` parses it, `zoneBboxFromBoot`
// resolves it for one zone and re-expresses it into the antimeridian-safe `CameraBoundsInput` shape
// (`east` may exceed 180, never re-wrapped) — the shape `state.svelte.ts#selectZone` flies to.
describe("zoneRows: bbox parsing", () => {
  it("a valid bbox parses through onto the row", () => {
    const boot = {
      zones: { programarea: [{ key: "GAA", name: "Gulf of America", bbox: [-98, 18, -80, 31] }] },
    };
    expect(zoneRows(boot, "programarea")[0]?.bbox).toEqual([-98, 18, -80, 31]);
  });

  it.each([
    ["wrong length", [1, 2, 3]],
    ["a non-numeric element", [1, 2, 3, "4"]],
    ["a non-finite element", [1, 2, 3, Infinity]],
    ["west out of range", [-190, 18, -80, 31]],
    ["east out of range", [-98, 18, 190, 31]],
    ["south out of range", [-98, -95, -80, 31]],
    ["north out of range", [-98, 18, -80, 95]],
    ["south > north", [-98, 31, -80, 18]],
    ["not an array", "not-an-array"],
  ])("an invalid bbox (%s) is dropped, not thrown: %j", (_label, bad) => {
    const boot = { zones: { programarea: [{ key: "GAA", name: "x", bbox: bad }] } };
    expect(zoneRows(boot, "programarea")[0]?.bbox).toBeUndefined();
  });

  it("no bbox key at all -- undefined, never a default [0,0,0,0]", () => {
    expect(zoneRows(BOOT_V7, "programarea")[0]?.bbox).toBeUndefined();
  });
});

describe("zoneBboxFromBoot", () => {
  it("a published bbox resolves to CameraBoundsInput ([[w,s],[e,n]])", () => {
    const boot = {
      zones: { programarea: [{ key: "GAA", name: "Gulf of America", bbox: [-98, 18, -80, 31] }] },
    };
    expect(zoneBboxFromBoot(boot, "programarea", "GAA")).toEqual([
      [-98, 18],
      [-80, 31],
    ]);
  });

  it("a dateline-crossing zone (west > east) re-expresses east past 180, never wrapped", () => {
    // the Aleutian Arc, spanning the antimeridian: west 172E, east 172W -- published west > east.
    const boot = {
      zones: { subregion: [{ key: "ALA", name: "Aleutian Arc", bbox: [172, 51, -172, 55] }] },
    };
    expect(zoneBboxFromBoot(boot, "subregion", "ALA")).toEqual([
      [172, 51],
      [188, 55], // -172 + 360
    ]);
  });

  it("no bbox published for this release (the shape every real release publishes today): null", () => {
    expect(zoneBboxFromBoot(BOOT_V7, "programarea", "GAA")).toBeNull();
  });

  it("an unknown key: null, never a throw", () => {
    const boot = {
      zones: { programarea: [{ key: "GAA", name: "x", bbox: [-98, 18, -80, 31] }] },
    };
    expect(zoneBboxFromBoot(boot, "programarea", "NOPE")).toBeNull();
  });

  it("no boot loaded yet: null", () => {
    expect(zoneBboxFromBoot(null, "programarea", "GAA")).toBeNull();
    expect(zoneBboxFromBoot({}, "programarea", "GAA")).toBeNull();
  });
});

// R3-CI regression (CI run 36158947685, webkit 3/3: "Enter flies the camera into the Aleutian
// Arc's own polygon bbox"). Root cause: `state.svelte.ts#selectZone` resolved a zone's fly-to
// bounds with exactly ONE synchronous attempt, at the instant Enter is pressed — a published
// `zoneBboxFromBoot`, else a `zoneBoundsCache` hit from an earlier live, unfiltered
// `querySourceFeatures` query. On a release that publishes no bbox (every release today) AND a
// cache that is still empty (nothing has queried the zones PMTiles source yet THIS page load),
// that single attempt misses — not because the zone has no geometry, but because MapLibre's
// `querySourceFeatures` only answers from tiles that have ALREADY finished both their network
// fetch and their worker-side vector-tile parse (the identical race `report/reportMap.ts#waitForIdle`
// already exists to close for `queryRenderedFeatures`), and nothing forced that parse to finish
// before this ran. `selectZone` used to fall straight to its announce-only branch on that miss,
// permanently — no retry. The fix retries the SAME resolution once more after the map's next
// "idle" (state.svelte.ts's own `retryZoneFlyAfterIdle`); `zoneKnownBounds` is the pure piece of
// that resolution (published bbox, else cache) both the first attempt and the retry call, so this
// test proves the property the retry depends on: repeating the SAME call, once the cache has since
// been populated (standing in for "the live query the retry re-runs found the tile"), now resolves
// where the first attempt — deliberately given an empty cache, exactly what a genuine tile-load
// race looks like — did not.
describe("zoneCacheKey / zoneKnownBounds (R3-CI: selectZone's idle-retry resolution)", () => {
  it("zoneCacheKey is `unit:key`, matching state.svelte.ts's own zoneBoundsCache format", () => {
    expect(zoneCacheKey("programarea", "ALA")).toBe("programarea:ALA");
  });

  it(
    "an empty cache and no published bbox: null -- the exact miss the FIRST selectZone attempt " +
      "can hit while the zones tile is still loading/parsing",
    () => {
      expect(zoneKnownBounds(BOOT_V7, "programarea", "ALA", new Map())).toBeNull();
    },
  );

  it(
    "a later cache hit resolves -- what the retry-after-idle finds once the live tile query " +
      "the first attempt missed has since populated the cache",
    () => {
      const cache = new Map([
        [
          "programarea:ALA",
          [
            [-170, 20],
            [-168, 22],
          ] as [[number, number], [number, number]],
        ],
      ]);
      expect(zoneKnownBounds(BOOT_V7, "programarea", "ALA", cache)).toEqual([
        [-170, 20],
        [-168, 22],
      ]);
    },
  );

  it(
    "a published bbox wins over the cache even when both are present (R3-B14/C3's own rule, " +
      "restated here so the retry path never accidentally reverses it)",
    () => {
      const boot = {
        zones: { programarea: [{ key: "ALA", name: "Aleutian Arc", bbox: [40, 40, 42, 42] }] },
      };
      const cache = new Map([
        [
          "programarea:ALA",
          [
            [-170, 20],
            [-168, 22],
          ] as [[number, number], [number, number]],
        ],
      ]);
      expect(zoneKnownBounds(boot, "programarea", "ALA", cache)).toEqual([
        [40, 40],
        [42, 42],
      ]);
    },
  );

  it("an unknown key and an unrelated cache entry: null, never a throw", () => {
    const cache = new Map([
      [
        "programarea:GAA",
        [
          [-158, 26],
          [-156, 28],
        ] as [[number, number], [number, number]],
      ],
    ]);
    expect(zoneKnownBounds(BOOT_V7, "programarea", "NOPE", cache)).toBeNull();
  });
});
