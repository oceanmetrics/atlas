// The collection-overlays hook (src/lib/catalog/overlays.ts): a collection's `atlas:overlays` (its own vector
// layers: sightings, tracklines, survey hexagons) and an Item's `atlas:overlay_filter`. One synthetic
// collection per rule.
import { describe, expect, it } from "vitest";
import { hookSpec, hooksOf, unknownHooks } from "../../src/lib/catalog/hooks";
import {
  OVERLAY_FALLBACK_COLOR,
  OVERLAYS_HOOK,
  parseOverlays,
} from "../../src/lib/catalog/overlays";
import {
  overlayFilterOf,
  overlayFilterState,
  toggledCov,
  visibleOverlayIds,
} from "../../src/lib/catalog/overlayState";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";

const URL_BASE = "https://data.test/atlas-restricted/x/sefsc_gomx/collection.json";
const PM = "application/vnd.pmtiles";

const ASSETS = {
  sightings_vessel: { href: "./overlays/sightings_vessel.pmtiles", type: PM },
  effort_vessel: { href: "./overlays/effort_vessel.pmtiles", type: PM },
  hexagons: {
    href: "https://cdn.test/hex40.pmtiles",
    type: PM,
    "pmtiles:layers": ["hex40"],
  },
  values: { href: "./values.parquet", type: "application/vnd.apache.parquet" },
};

const SIGHTINGS = {
  id: "sightings_vessel",
  title: "Vessel sightings, 2003–2024",
  asset: "sightings_vessel",
  source_layer: "sightings_vessel",
  geometry: "point",
  color: "#c51b7d",
  default: true,
  label_field: "vernacularName",
  fields: ["sightid", "survey", "group.size"],
  field_labels: { "group.size": "Group size" },
  filter_field: "models",
};
const EFFORT = {
  id: "effort_vessel",
  title: "Vessel effort",
  asset: "effort_vessel",
  source_layer: "effort_vessel",
  geometry: "line",
  color: "#4d4d4d",
  default: true,
};
const HEXAGONS = {
  id: "hexagons",
  title: "Model hexagons (40 km²)",
  asset: "hexagons",
  geometry: "polygon",
  color: "rgb(120, 120, 120)",
};

function collection(overlays: unknown, extra: Record<string, unknown> = {}): StacCollection {
  return {
    type: "Collection",
    stac_version: "1.1.0",
    id: "sefsc_gomx",
    description: "synthetic",
    license: "CC-BY-4.0",
    links: [],
    assets: ASSETS,
    "atlas:url": URL_BASE,
    [OVERLAYS_HOOK]: overlays,
    ...extra,
  } as unknown as StacCollection;
}

const item = (filter?: unknown): StacItem =>
  ({
    type: "Feature",
    id: "rices_whale_01_density",
    properties: filter === undefined ? {} : { "atlas:overlay_filter": filter },
    assets: {},
    links: [],
  }) as unknown as StacItem;

describe("parseOverlays: the atlas:overlays hook", () => {
  it("parses a valid list, in its own order, resolving each asset against the collection.json", () => {
    const specs = parseOverlays(collection([SIGHTINGS, EFFORT, HEXAGONS]))!;
    expect(specs.map((s) => s.id)).toEqual(["sightings_vessel", "effort_vessel", "hexagons"]);
    expect(specs[0]).toEqual({
      id: "sightings_vessel",
      title: "Vessel sightings, 2003–2024",
      asset: "sightings_vessel",
      url: "https://data.test/atlas-restricted/x/sefsc_gomx/overlays/sightings_vessel.pmtiles",
      sourceLayer: "sightings_vessel",
      geometry: "point",
      color: "#c51b7d",
      default: true,
      labelField: "vernacularName",
      fields: ["sightid", "survey", "group.size"],
      fieldLabels: { "group.size": "Group size" },
      filterField: "models",
    });
    // an absolute href stays absolute; a missing source_layer is the asset's own pmtiles layer
    expect(specs[2].url).toBe("https://cdn.test/hex40.pmtiles");
    expect(specs[2].sourceLayer).toBe("hex40");
    // missing `default` is false; missing optional fields are null / empty
    expect(specs[2].default).toBe(false);
    expect(specs[2]).toMatchObject({
      labelField: null,
      fields: null,
      fieldLabels: {},
      filterField: null,
    });
  });

  it("is registered as a hook, so hookSpec/hooksOf see it and unknownHooks does not report it", () => {
    const c = collection([SIGHTINGS]);
    expect(hookSpec(c, "atlas:overlays")?.[0].id).toBe("sightings_vessel");
    expect(hooksOf(c)).toContain("atlas:overlays");
    expect(unknownHooks(c)).toEqual([]);
  });

  it("drops an entry whose asset the collection does not list (or that is not a PMTiles)", () => {
    const missing = { ...EFFORT, id: "effort_aerial", asset: "effort_aerial" };
    const parquet = { ...EFFORT, id: "wrong_type", asset: "values" };
    const specs = parseOverlays(collection([SIGHTINGS, missing, parquet]))!;
    expect(specs.map((s) => s.id)).toEqual(["sightings_vessel"]);
  });

  it("drops an entry with an unknown geometry", () => {
    const bad = { ...EFFORT, id: "effort_x", geometry: "multilinestring" };
    expect(parseOverlays(collection([bad, EFFORT]))!.map((s) => s.id)).toEqual(["effort_vessel"]);
  });

  it("ignores unknown keys", () => {
    const extra = { ...EFFORT, "atlas:future": { x: 1 }, minzoom: 4, legend: "dashed" };
    expect(parseOverlays(collection([extra]))![0]).toEqual(parseOverlays(collection([EFFORT]))![0]);
  });

  it("is null for a non-array, an empty list, or a list with nothing usable", () => {
    expect(parseOverlays(collection({ sightings: SIGHTINGS }))).toBeNull();
    expect(parseOverlays(collection("sightings_vessel"))).toBeNull();
    expect(parseOverlays(collection([]))).toBeNull();
    expect(parseOverlays(collection([{ ...EFFORT, asset: "nope" }, 42, null]))).toBeNull();
    expect(parseOverlays(collection(undefined))).toBeNull();
    expect(parseOverlays(null)).toBeNull();
    expect(hooksOf(collection([]))).not.toContain("atlas:overlays");
  });

  it("an id must be a URL token, once: a duplicate or a comma-bearing id is dropped", () => {
    const dup = { ...EFFORT, title: "second" };
    const comma = { ...EFFORT, id: "a,b" };
    const specs = parseOverlays(collection([EFFORT, dup, comma]))!;
    expect(specs).toHaveLength(1);
    expect(specs[0].title).toBe("Vessel effort");
  });

  it("a colour MapLibre may not parse falls back (a bad colour would reject the whole style)", () => {
    const bad = parseOverlays(collection([{ ...EFFORT, color: "url(javascript:x)" }]))!;
    expect(bad[0].color).toBe(OVERLAY_FALLBACK_COLOR);
    const none = parseOverlays(collection([{ ...EFFORT, color: undefined }]))!;
    expect(none[0].color).toBe(OVERLAY_FALLBACK_COLOR);
    for (const ok of ["#abc", "#aabbcc", "#aabbcc80", "rgba(1, 2, 3, 0.5)", "hsl(120 50% 40%)"]) {
      expect(parseOverlays(collection([{ ...EFFORT, color: ok }]))![0].color).toBe(ok);
    }
  });

  it("a missing title is the id; non-string fields are left out", () => {
    const s = parseOverlays(
      collection([
        { ...EFFORT, title: "", fields: ["a", 3, "", "b"], field_labels: { a: 1, b: "B" } },
      ]),
    )![0];
    expect(s.title).toBe("effort_vessel");
    expect(s.fields).toEqual(["a", "b"]);
    expect(s.fieldLabels).toEqual({ b: "B" });
  });
});

describe("overlayFilterOf: an Item's atlas:overlay_filter", () => {
  it("reads {field, token}", () => {
    expect(overlayFilterOf(item({ field: "models", token: "rices_whale" }))).toEqual({
      field: "models",
      token: "rices_whale",
    });
  });
  it("is null when absent, partial, or the token holds the delimiter", () => {
    expect(overlayFilterOf(item())).toBeNull();
    expect(overlayFilterOf(item({ field: "models" }))).toBeNull();
    expect(overlayFilterOf(item({ field: "models", token: "a|b" }))).toBeNull();
    expect(overlayFilterOf(item("rices_whale"))).toBeNull();
    expect(overlayFilterOf(null)).toBeNull();
  });
});

describe("visibleOverlayIds / toggledCov: which overlays are on (`cov=`)", () => {
  const specs = parseOverlays(collection([SIGHTINGS, EFFORT, HEXAGONS]))!;

  it("absent = the defaults; empty = none; a list = those, unknown ids ignored", () => {
    expect(visibleOverlayIds(specs, undefined)).toEqual(["sightings_vessel", "effort_vessel"]);
    expect(visibleOverlayIds(specs, [])).toEqual([]);
    expect(visibleOverlayIds(specs, ["hexagons", "gone_layer"])).toEqual(["hexagons"]);
  });
  it("is always in the collection's own order (the draw order), whatever order the URL says", () => {
    expect(visibleOverlayIds(specs, ["hexagons", "sightings_vessel"])).toEqual([
      "sightings_vessel",
      "hexagons",
    ]);
  });
  it("a toggle writes the full set; landing back on the defaults is absent again", () => {
    const on = toggledCov(specs, undefined, "hexagons", true);
    expect(on).toEqual(["sightings_vessel", "effort_vessel", "hexagons"]);
    expect(toggledCov(specs, on, "hexagons", false)).toBeUndefined();
    const none = toggledCov(
      specs,
      toggledCov(specs, undefined, "effort_vessel", false),
      "sightings_vessel",
      false,
    );
    expect(none).toEqual([]);
  });
});

describe("overlayFilterState: the 'Only features matching the selected layer' checkbox", () => {
  const specs = parseOverlays(collection([SIGHTINGS, EFFORT]))!;
  const rices = item({ field: "models", token: "rices_whale" });

  it("offered, enabled and applied only when the Item names a filter an overlay matches and covf is on", () => {
    expect(overlayFilterState(specs, rices, false)).toEqual({
      offered: true,
      enabled: true,
      reason: null,
      active: null,
    });
    expect(overlayFilterState(specs, rices, true).active).toEqual({
      field: "models",
      token: "rices_whale",
    });
  });
  it("an Item without atlas:overlay_filter disables it, with a reason, and applies nothing", () => {
    const st = overlayFilterState(specs, item(), true);
    expect(st.enabled).toBe(false);
    expect(st.reason).toMatch(/names no matching features/);
    expect(st.active).toBeNull();
  });
  it("a filter on a field no overlay declares is disabled too", () => {
    const st = overlayFilterState(specs, item({ field: "species", token: "x" }), true);
    expect(st).toMatchObject({ offered: true, enabled: false, active: null });
    expect(st.reason).toMatch(/species/);
  });
  it("is not offered when no overlay declares a filter_field", () => {
    const plain = parseOverlays(collection([EFFORT]))!;
    expect(overlayFilterState(plain, rices, true)).toEqual({
      offered: false,
      enabled: false,
      reason: null,
      active: null,
    });
  });
});
