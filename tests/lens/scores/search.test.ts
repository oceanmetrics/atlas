// Q1 (atlas-8 P-round, 2026-09-24): red-first unit tests for the Scores lens' top-bar search --
// the pure matcher (`matchZones`) and coordinate parser (`parseCoordinateQuery`) behind
// `ScoresSearch.svelte`. Wiring (the `sel`/camera/popup writes) is covered by
// `e2e/scores.search.spec.ts`, the same split `state.svelte.ts`'s own `handleMapClick` already has
// (no unit test for the wiring itself, only for the pure logic it calls).
import { describe, expect, it } from "vitest";
import {
  defaultRegions,
  defaultZones,
  formatCoordLabel,
  matchRegions,
  matchZones,
  parseCoordinateQuery,
  scoresSearch,
  scoresSearchDefault,
} from "../../../src/lens/scores/search";
import { BOOT_V1_PLANAREA, BOOT_V7 } from "./fixtures";

/** BOOT_V7 with a `study_areas` fixture, real, that carries more than the one `FULL` row --
 * W6's own "Regions move into the Search bar" fields. */
const BOOT_V7_REGIONS = {
  ...BOOT_V7,
  study_areas: [
    { key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 },
    { key: "AK", label: "Alaska", lon: -164.654, lat: 63.327, zoom: 2.35 },
    { key: "AT", label: "Atlantic", lon: -67.627, lat: 29.862, zoom: 2.71 },
    { key: "GA", label: "Gulf of America", lon: -89.089, lat: 26.251, zoom: 3.74 },
    { key: "PA", label: "Pacific", lon: -171.57, lat: 28.541, zoom: 1.7 },
  ],
};

describe("matchZones", () => {
  it("exact key match (case-insensitive)", () => {
    expect(matchZones(BOOT_V7, "GAA")).toEqual([
      { kind: "zone", unit: "programarea", key: "GAA", label: "Gulf of America, Eastern (GAA)" },
    ]);
    expect(matchZones(BOOT_V7, "gaa")).toEqual(matchZones(BOOT_V7, "GAA"));
  });

  it("name substring match", () => {
    const m = matchZones(BOOT_V7, "gulf");
    expect(m.map((r) => (r.kind === "zone" ? r.key : null))).toContain("GAA");
  });

  it("an exact key match ranks ABOVE a substring name match containing the same text", () => {
    // "AK" is a subregion key; its own NAME is "Alaska" -- querying "AK" must not let some OTHER
    // zone's name-substring match (none here, but the ranking rule is what's under test) outrank
    // the exact key hit itself.
    const m = matchZones(BOOT_V7, "AK");
    expect(m[0]).toEqual({ kind: "zone", unit: "subregion", key: "AK", label: "Alaska (AK)" });
  });

  it("matches the release's other published zone archives too (subregion here) -- 'if the bundle has them'", () => {
    const m = matchZones(BOOT_V7, "alaska");
    expect(m).toEqual([{ kind: "zone", unit: "subregion", key: "AK", label: "Alaska (AK)" }]);
  });

  it("a key with no published name falls back to the bare key (paLabel's own rule)", () => {
    // BOOT_V1_PLANAREA's own `zones` carries no `planarea`/`programarea` rows at all -- only a
    // `subregion: [{key:"USA", name:"All US waters"}]` row survives the override.
    const m = matchZones(BOOT_V1_PLANAREA, "usa");
    expect(m).toEqual([
      { kind: "zone", unit: "subregion", key: "USA", label: "All US waters (USA)" },
    ]);
  });

  // V1 fix (Opus eyes-on review, 2026-09-24): a real release publishes no `name` on its
  // `zones.programarea` rows at all -- `matchZones` must still surface the full name (via the
  // app-side PROGRAM_AREA_NAMES table, zoneStats.ts#paLabel), unit-scoped so a subregion row
  // sharing the SAME key never borrows it.
  it("resolves the app-side PROGRAM_AREA_NAMES fallback for an unnamed programarea row", () => {
    const boot = {
      zones: {
        programarea: [{ key: "ALA", metrics: {} }], // no `name` -- the real v7 shape
        subregion: [{ key: "ALA", metrics: {} }], // same key, different unit -- must NOT resolve
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    const m = matchZones(boot, "ala");
    expect(m).toEqual([
      { kind: "zone", unit: "programarea", key: "ALA", label: "Aleutian Arc (ALA)" },
      { kind: "zone", unit: "subregion", key: "ALA", label: "ALA" },
    ]);
  });

  // V6 fix (owner-reported, 2026-09-24): the V1 fix above only proved the OPTION LABEL resolves
  // the PROGRAM_AREA_NAMES fallback -- its query ("ala") is itself an exact KEY match, so it never
  // exercised matching against the fallback NAME text. On the real release (no published
  // `zones.programarea[*].name`), typing the full name Ben sees in the dropdown ("Aleutian",
  // "Gulf of Alaska") found "No matches"; only the bare acronym worked. `matchRank` must rank
  // against the SAME resolved label `paLabel` shows, not the bundle's raw (absent) `name`.
  it("matches the app-side fallback NAME text itself, not just the bare key", () => {
    const boot = {
      zones: {
        programarea: [
          { key: "ALA", metrics: {} }, // no `name` -- the real v7/v9 shape
          { key: "GOA", metrics: {} },
        ],
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(matchZones(boot, "Aleutian")).toEqual([
      { kind: "zone", unit: "programarea", key: "ALA", label: "Aleutian Arc (ALA)" },
    ]);
    // case-insensitive, and matches on the fallback's full multi-word name.
    expect(matchZones(boot, "gulf of alaska")).toEqual([
      { kind: "zone", unit: "programarea", key: "GOA", label: "Gulf of Alaska (GOA)" },
    ]);
  });

  it("a published name is preferred over the fallback for MATCHING too, not just the label", () => {
    const boot = {
      zones: { programarea: [{ key: "ALA", name: "Custom Published Name", metrics: {} }] },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    // the fallback text no longer applies once a real name is published for this row...
    expect(matchZones(boot, "aleutian")).toEqual([]);
    // ...and the published name itself matches.
    expect(matchZones(boot, "custom published")).toEqual([
      { kind: "zone", unit: "programarea", key: "ALA", label: "Custom Published Name (ALA)" },
    ]);
  });

  it("subregion/ecoregion units never borrow the Program Area fallback name for a same-spelled key", () => {
    const boot = {
      zones: {
        programarea: [{ key: "GOA", metrics: {} }],
        subregion: [{ key: "GOA", metrics: {} }], // same key, no name -- must NOT match "gulf..."
        ecoregion: [{ key: "GOA", metrics: {} }], // same key, no name -- must NOT match "gulf..."
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    const m = matchZones(boot, "gulf of alaska");
    expect(m).toEqual([
      { kind: "zone", unit: "programarea", key: "GOA", label: "Gulf of Alaska (GOA)" },
    ]);
  });

  it("an unpublished unit / no match: [], never a throw", () => {
    expect(matchZones(BOOT_V7, "nonexistent-place")).toEqual([]);
    expect(matchZones(null, "GAA")).toEqual([]);
    expect(matchZones({}, "GAA")).toEqual([]);
  });

  it("a blank query matches nothing, never 'everything'", () => {
    expect(matchZones(BOOT_V7, "")).toEqual([]);
    expect(matchZones(BOOT_V7, "   ")).toEqual([]);
  });

  it("caps at `limit` (default 8)", () => {
    const boot = {
      zones: {
        programarea: Array.from({ length: 12 }, (_, i) => ({
          key: `Z${i}`,
          name: `Zone ${i}`,
          metrics: {},
        })),
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(matchZones(boot, "zone")).toHaveLength(8);
    expect(matchZones(boot, "zone", 3)).toHaveLength(3);
  });
});

describe("parseCoordinateQuery", () => {
  it("default order: 'lon, lat'", () => {
    expect(parseCoordinateQuery("-140, 57")).toEqual({ lon: -140, lat: 57, swapped: false });
  });

  it("comma-less, whitespace-separated", () => {
    expect(parseCoordinateQuery("-140   57")).toEqual({ lon: -140, lat: 57, swapped: false });
  });

  it("inferred 'lat, lon' when the default reading's latitude is out of range", () => {
    // read as lon=57, lat=-140 the default way -- lat -140 is invalid, so this falls back to
    // lon=-140, lat=57 (the same point as "-140, 57" above, just typed the other way round).
    expect(parseCoordinateQuery("57, -140")).toEqual({ lon: -140, lat: 57, swapped: true });
  });

  it("an ambiguous pair (valid either way) keeps the 'lon, lat' default, no swap", () => {
    expect(parseCoordinateQuery("40, 50")).toEqual({ lon: 40, lat: 50, swapped: false });
  });

  it("explicit lat/lon labels win outright, in either order", () => {
    expect(parseCoordinateQuery("lat 57, lon -140")).toEqual({ lon: -140, lat: 57, swapped: true });
    expect(parseCoordinateQuery("lon: -140 lat: 57")).toEqual({
      lon: -140,
      lat: 57,
      swapped: true,
    });
    expect(parseCoordinateQuery("latitude=57, longitude=-140")).toEqual({
      lon: -140,
      lat: 57,
      swapped: true,
    });
  });

  it("out of range under BOTH readings: null", () => {
    expect(parseCoordinateQuery("200, 200")).toBeNull();
  });

  it("not exactly two numbers: null", () => {
    expect(parseCoordinateQuery("-124.5, 40.0, -123.0")).toBeNull();
    expect(parseCoordinateQuery("-140")).toBeNull();
  });

  it("not numeric: null", () => {
    expect(parseCoordinateQuery("Aleutian Arc")).toBeNull();
    expect(parseCoordinateQuery("abc, 57")).toBeNull();
  });

  it("empty/whitespace: null", () => {
    expect(parseCoordinateQuery("")).toBeNull();
    expect(parseCoordinateQuery("   ")).toBeNull();
  });

  it("decimals parse", () => {
    expect(parseCoordinateQuery("-140.25, 57.5")).toEqual({
      lon: -140.25,
      lat: 57.5,
      swapped: false,
    });
  });
});

// W6 (Ben, 2026-09-25): "Regions move into the Search bar" -- the Layers pane's own "Zoom to
// region" select is removed; `studyAreasFromBoot(boot)` rows are now searched/listed here instead.
describe("matchRegions", () => {
  it("exact key match (case-insensitive)", () => {
    expect(matchRegions(BOOT_V7_REGIONS, "AK")).toEqual([
      { kind: "region", key: "AK", label: "Alaska" },
    ]);
    expect(matchRegions(BOOT_V7_REGIONS, "ak")).toEqual(matchRegions(BOOT_V7_REGIONS, "AK"));
  });

  it("label substring match", () => {
    expect(matchRegions(BOOT_V7_REGIONS, "gulf")).toEqual([
      { kind: "region", key: "GA", label: "Gulf of America" },
    ]);
  });

  it("an unpublished region / no match: [], never a throw", () => {
    expect(matchRegions(BOOT_V7_REGIONS, "nonexistent")).toEqual([]);
    expect(matchRegions(null, "AK")).toEqual([]);
  });

  it("a blank query matches nothing, never 'everything' -- same rule matchZones follows", () => {
    expect(matchRegions(BOOT_V7_REGIONS, "")).toEqual([]);
    expect(matchRegions(BOOT_V7_REGIONS, "   ")).toEqual([]);
  });

  it("caps at `limit`", () => {
    expect(matchRegions(BOOT_V7_REGIONS, "a", 2)).toHaveLength(2);
  });
});

describe("defaultRegions / defaultZones (the blank-query 'open on focus' listing)", () => {
  it("defaultRegions lists every published study area, unranked, in boot order", () => {
    expect(defaultRegions(BOOT_V7_REGIONS)).toEqual([
      { kind: "region", key: "FULL", label: "All US waters" },
      { kind: "region", key: "AK", label: "Alaska" },
      { kind: "region", key: "AT", label: "Atlantic" },
      { kind: "region", key: "GA", label: "Gulf of America" },
      { kind: "region", key: "PA", label: "Pacific" },
    ]);
  });

  it("defaultRegions caps at `limit`", () => {
    expect(defaultRegions(BOOT_V7_REGIONS, 2)).toHaveLength(2);
  });

  it("defaultZones lists every published Program Area, sorted by its resolved label", () => {
    const boot = {
      zones: {
        programarea: [
          { key: "WGA", name: "Western Gulf of Alaska", metrics: {} },
          { key: "GAA", name: "St. George Basin", metrics: {} },
        ],
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(defaultZones(boot)).toEqual([
      { kind: "zone", unit: "programarea", key: "GAA", label: "St. George Basin (GAA)" },
      { kind: "zone", unit: "programarea", key: "WGA", label: "Western Gulf of Alaska (WGA)" },
    ]);
  });

  it("defaultZones is [] for a release with no selectable unit", () => {
    expect(defaultZones({})).toEqual([]);
  });

  it("scoresSearchDefault combines regions first, then zones", () => {
    const boot = {
      ...BOOT_V7_REGIONS,
      zones: { ...BOOT_V7_REGIONS.zones, programarea: [{ key: "GAA", metrics: {} }] },
    };
    const results = scoresSearchDefault(boot);
    expect(results[0]).toEqual({ kind: "region", key: "FULL", label: "All US waters" });
    expect(results.some((r) => r.kind === "zone" && r.key === "GAA")).toBe(true);
    expect(results.findIndex((r) => r.kind === "region")).toBeLessThan(
      results.findIndex((r) => r.kind === "zone"),
    );
  });
});

describe("formatCoordLabel", () => {
  it("default order reads 'lon, lat'", () => {
    expect(formatCoordLabel({ lon: -140, lat: 57, swapped: false })).toBe(
      "Fly to lon -140.00, lat 57.00",
    );
  });

  it("swapped order says so", () => {
    expect(formatCoordLabel({ lon: -140, lat: 57, swapped: true })).toBe(
      "Fly to lat 57.00, lon -140.00",
    );
  });
});

describe("scoresSearch", () => {
  it("a coordinate parses first, ahead of any zone text match", () => {
    const results = scoresSearch(BOOT_V7, "-140, 57");
    expect(results[0]).toEqual({
      kind: "coord",
      lon: -140,
      lat: 57,
      label: "Fly to lon -140.00, lat 57.00",
    });
  });

  it("falls through to zone matches when the text is not a coordinate", () => {
    const results = scoresSearch(BOOT_V7, "GAA");
    expect(results).toEqual([
      { kind: "zone", unit: "programarea", key: "GAA", label: "Gulf of America, Eastern (GAA)" },
    ]);
  });

  it("caps the COMBINED list at `limit`", () => {
    const boot = {
      zones: {
        programarea: Array.from({ length: 12 }, (_, i) => ({
          key: `Z${i}`,
          name: `Zone ${i}`,
          metrics: {},
        })),
      },
      units: [{ fld: "programarea_key", pmtiles: "x", source_layer: "programarea" }],
    };
    expect(scoresSearch(boot, "zone", 5)).toHaveLength(5);
  });

  // W6: a region match now falls in ahead of a zone match, behind a coordinate.
  it("a region match sorts ahead of a zone match", () => {
    const boot = {
      ...BOOT_V7_REGIONS,
      zones: {
        ...BOOT_V7_REGIONS.zones,
        programarea: [{ key: "GAA", name: "Gulf Area", metrics: {} }],
      },
    };
    const results = scoresSearch(boot, "gulf");
    expect(results[0]).toEqual({ kind: "region", key: "GA", label: "Gulf of America" });
    expect(results).toContainEqual({
      kind: "zone",
      unit: "programarea",
      key: "GAA",
      label: "Gulf Area (GAA)",
    });
    expect(results.findIndex((r) => r.kind === "region")).toBeLessThan(
      results.findIndex((r) => r.kind === "zone"),
    );
  });
});
