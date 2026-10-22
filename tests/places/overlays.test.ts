import { describe, expect, it } from "vitest";
import {
  groupOverlays,
  kindOf,
  listedOverlays,
  overlayCreditLine,
  overlayCreditsFor,
  overlayLayerOf,
  overlayLayersFrom,
  overlaySpecs,
  themeOf,
} from "../../src/places/overlays";
import type { TiledLayer } from "../../src/lib/gazetteer/manifest";

const row = (over: Partial<TiledLayer> & { slug: string }): TiledLayer =>
  ({
    title: over.slug,
    collection: over.slug,
    pmtiles: `https://s3.test/gazetteer/${over.slug}/places.pmtiles`,
    source_layer: over.slug,
    geom_type: "MultiPolygon",
    n: 3,
    updated: null,
    version: "1.0.0",
    paint: {
      fill: { "fill-color": "#e08a1e", "fill-opacity": 0.45 },
      line: { "line-color": "#a85f00", "line-width": 2 },
    },
    authority: "X",
    place_type: "lease",
    bbox: null,
    attribution: `Credit for ${over.slug}. Processed by Ocean Metrics.`,
    attribution_html: "",
    license: "CC-PDDC",
    license_url: null,
    citation: "",
    access: "public",
    ...over,
  }) as TiledLayer;

const MANIFEST: TiledLayer[] = [
  row({
    slug: "noaa_sanctuaries",
    title: "NOAA national marine sanctuaries",
    place_type: "protected_area",
  }),
  row({ slug: "boem_wind_leases", title: "BOEM offshore wind leases", place_type: "lease" }),
  row({ slug: "boem_ocs_planning", title: "BOEM OCS planning areas", place_type: "planning_area" }),
  row({ slug: "mpa_inventory", title: "MPA inventory", place_type: "mpa" }),
  row({
    slug: "calcofi_stations",
    title: "CalCOFI stations",
    geom_type: "Point",
    place_type: "station",
    paint: {},
    attribution: "",
  }),
  row({
    slug: "calcofi_lines",
    title: "CalCOFI lines",
    geom_type: "LineString",
    place_type: "transect",
    paint: { line: { "line-color": "#0b6e99" } },
  }),
  row({ slug: "mystery", title: "Alpha mystery", place_type: null }),
  Object.assign(
    row({
      slug: "boem_wind_planning_rescinded",
      title: "BOEM wind planning areas",
      place_type: "planning_area",
    }),
    {
      status_label: "rescinded 2025-07-30",
    },
  ),
];
const LAYERS = overlayLayersFrom(MANIFEST);

describe("overlay layers from the manifest", () => {
  it("geometry kind: polygons, lines and points (Multi* included)", () => {
    expect(kindOf("MultiPolygon")).toBe("polygon");
    expect(kindOf("LineString")).toBe("line");
    expect(kindOf("MultiLineString")).toBe("line");
    expect(kindOf("Point")).toBe("point");
    expect(kindOf(null)).toBe("polygon");
  });
  it("colours come from the published paint; a layer with none falls back, never undefined", () => {
    const wind = overlayLayerOf(MANIFEST[1]);
    expect(wind).toMatchObject({ fillColor: "#e08a1e", lineColor: "#a85f00", lineWidth: 2 });
    const lines = overlayLayerOf(MANIFEST[5]);
    expect(lines.lineColor).toBe("#0b6e99");
    expect(lines.fillColor).toBe("#0b6e99"); // no fill paint: the line colour
    const pts = overlayLayerOf(MANIFEST[4]);
    expect(pts.lineColor).toMatch(/^#/);
    expect(pts.lineWidth).toBe(1);
  });
  it("a layer with a status reads 'title (status)'", () => {
    expect(LAYERS.find((l) => l.slug === "boem_wind_planning_rescinded")!.label).toBe(
      "BOEM wind planning areas (rescinded 2025-07-30)",
    );
  });
});

describe("grouping: by theme when the manifest has place types, else alphabetical", () => {
  it("themes follow place_type; each group is alphabetical; empty themes are left out", () => {
    expect(themeOf("protected_area")).toBe("protection");
    expect(themeOf("planning_area")).toBe("energy");
    expect(themeOf("nonsense")).toBe("other");
    expect(themeOf(null)).toBe("other");
    const g = groupOverlays(LAYERS);
    expect(g.map((x) => x.theme)).toEqual(["protection", "energy", "monitoring", "other"]);
    expect(g[1].layers.map((l) => l.slug)).toEqual([
      "boem_ocs_planning", // BOEM OCS planning areas
      "boem_wind_leases", // BOEM offshore wind leases
      "boem_wind_planning_rescinded", // BOEM wind planning areas (rescinded ...)
    ]);
    expect(g[0].layers.map((l) => l.slug)).toEqual(["mpa_inventory", "noaa_sanctuaries"]);
  });
  it("no place_type anywhere: one flat alphabetical group with no heading", () => {
    const flat = overlayLayersFrom(MANIFEST.map((m) => ({ ...m, place_type: null })));
    const g = groupOverlays(flat);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("");
    expect(g[0].layers.map((l) => l.label)).toEqual(
      [...g[0].layers.map((l) => l.label)].sort((a, b) => a.localeCompare(b)),
    );
  });
  it("an empty manifest has no groups", () => {
    expect(groupOverlays([])).toEqual([]);
  });
});

describe("access (client 0.5.1): an unlisted collection is hidden from the list, not from a link", () => {
  const withHidden = overlayLayersFrom([
    ...MANIFEST,
    row({ slug: "restricted_zones", title: "Restricted zones", access: "unlisted" }),
  ]);
  it("`listed` follows `access`; a row from an older manifest (no `access`) is listed", () => {
    expect(withHidden.find((l) => l.slug === "restricted_zones")!.listed).toBe(false);
    expect(withHidden.find((l) => l.slug === "boem_wind_leases")!.listed).toBe(true);
    const old = { ...MANIFEST[0] } as Partial<(typeof MANIFEST)[0]>;
    delete old.access;
    expect(overlayLayerOf(old as (typeof MANIFEST)[0]).listed).toBe(true);
  });
  it("the list leaves it out until a link turns it on; the map draws it from the link", () => {
    expect(listedOverlays(withHidden, []).map((l) => l.slug)).not.toContain("restricted_zones");
    expect(listedOverlays(withHidden, ["restricted_zones"]).map((l) => l.slug)).toContain(
      "restricted_zones",
    );
    expect(overlaySpecs(withHidden, ["restricted_zones"]).map((s) => s.slug)).toEqual([
      "restricted_zones",
    ]);
  });
});

describe("specs for the map: only the layers that are ON and listed", () => {
  it("unknown slugs are skipped, order follows `on`, duplicates once", () => {
    const specs = overlaySpecs(LAYERS, [
      "boem_wind_leases",
      "retired_layer",
      "noaa_sanctuaries",
      "boem_wind_leases",
    ]);
    expect(specs.map((s) => s.slug)).toEqual(["boem_wind_leases", "noaa_sanctuaries"]);
    expect(specs[0]).toMatchObject({
      kind: "polygon",
      sourceLayer: "boem_wind_leases",
      pmtiles: "https://s3.test/gazetteer/boem_wind_leases/places.pmtiles",
    });
  });
  it("none on: no specs", () => {
    expect(overlaySpecs(LAYERS, [])).toEqual([]);
  });
});

describe("attribution aggregation", () => {
  it("one credit per overlay that is ON and carries a credit, in `on` order", () => {
    const c = overlayCreditsFor(LAYERS, [
      "calcofi_stations",
      "noaa_sanctuaries",
      "boem_wind_leases",
    ]);
    expect(c.map((x) => x.slug)).toEqual(["noaa_sanctuaries", "boem_wind_leases"]); // stations has no credit
    expect(c[0].license).toBe("CC-PDDC");
  });
  it("the line deduplicates and says 'Processed by Ocean Metrics.' once", () => {
    const line = overlayCreditLine(
      overlayCreditsFor(LAYERS, ["noaa_sanctuaries", "boem_wind_leases"]),
    );
    expect(line).toBe(
      "Credit for noaa_sanctuaries; Credit for boem_wind_leases. Processed by Ocean Metrics.",
    );
    // two overlays with the SAME credit text name it once
    const dup = overlayLayersFrom([
      row({ slug: "a", attribution: "Same source. Processed by Ocean Metrics." }),
      row({ slug: "b", attribution: "Same source. Processed by Ocean Metrics." }),
    ]);
    expect(overlayCreditLine(overlayCreditsFor(dup, ["a", "b"]))).toBe(
      "Same source. Processed by Ocean Metrics.",
    );
  });
  it("overlays off contribute nothing", () => {
    expect(overlayCreditsFor(LAYERS, [])).toEqual([]);
    expect(overlayCreditLine([])).toBe("");
  });
});
