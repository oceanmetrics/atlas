// A collection's own vector overlays on the map (src/lib/map/layers/collectionOverlays.ts + style.ts): one
// style spec per geometry, the draw order (the collection's FIRST entry on top, every overlay above the Item
// and below the place layers and the selection highlight), and the "Only features matching the selected
// layer" filter, evaluated with MapLibre's own expression engine (`@maplibre/maplibre-gl-style-spec`,
// maplibre-gl's own dependency), so the test is about what the map will actually keep.
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import type { CollectionOverlaySpec } from "../../src/lib/catalog/overlays";
import { COLLECTION_OVERLAY_HALO } from "../../src/lib/map/colors";
import {
  COV_FILL_OPACITY,
  collectionOverlayStyle,
  covHitLayerId,
  covHitLayerIds,
  covLayerId,
  covSourceId,
  overlayLayersOf,
  overlayTokenFilter,
} from "../../src/lib/map/layers/collectionOverlays";
import { defaultLayerStackEntries } from "../../src/lib/map/layerStack";
import { composeStyle } from "../../src/lib/map/style";
import type { FilterSpecification } from "maplibre-gl";
import type { LayerSpecification } from "../../src/lib/map/types";

const spec = (over: Partial<CollectionOverlaySpec>): CollectionOverlaySpec => ({
  id: "x",
  title: "X",
  asset: "x",
  url: "https://data.test/c/x.pmtiles",
  sourceLayer: "x",
  geometry: "point",
  color: "#c51b7d",
  default: false,
  labelField: null,
  fields: null,
  fieldLabels: {},
  filterField: null,
  ...over,
});

const SIGHTINGS = spec({
  id: "sightings_vessel",
  asset: "sightings_vessel",
  sourceLayer: "sightings_vessel",
  geometry: "point",
  filterField: "models",
});
const EFFORT = spec({
  id: "effort_vessel",
  asset: "effort_vessel",
  sourceLayer: "effort_vessel",
  geometry: "line",
  color: "#4d4d4d",
  filterField: "models",
});
const HEXAGONS = spec({
  id: "hexagons",
  asset: "hexagons",
  sourceLayer: "hex40",
  geometry: "polygon",
  color: "rgb(120, 120, 120)",
});
const ALL = [SIGHTINGS, EFFORT, HEXAGONS];
const ALL_IDS = ALL.map((s) => s.id);

const paintOf = (l: LayerSpecification) =>
  "paint" in l ? (l.paint as Record<string, unknown>) : {};

describe("style specs per geometry", () => {
  it("a point is a circle in its colour with a white ring, ~4-5 px", () => {
    const [circle] = overlayLayersOf(SIGHTINGS);
    expect(circle).toMatchObject({
      id: "cov-sightings_vessel-circle",
      type: "circle",
      source: "cov-src-sightings_vessel",
      "source-layer": "sightings_vessel",
    });
    const p = paintOf(circle);
    expect(p["circle-color"]).toBe("#c51b7d");
    expect(p["circle-stroke-color"]).toBe(COLLECTION_OVERLAY_HALO);
    expect(p["circle-radius"]).toBeGreaterThanOrEqual(4);
    expect(p["circle-radius"]).toBeLessThanOrEqual(5);
  });
  it("a line is its colour at ~1.5 px", () => {
    const layers = overlayLayersOf(EFFORT);
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe("line");
    expect(paintOf(layers[0])).toMatchObject({ "line-color": "#4d4d4d", "line-width": 1.5 });
  });
  it("a polygon is a very faint fill (which takes the click) under an outline in its colour", () => {
    const [fill, outline] = overlayLayersOf(HEXAGONS);
    expect(fill).toMatchObject({ id: "cov-hexagons-fill", type: "fill", "source-layer": "hex40" });
    expect(paintOf(fill)["fill-opacity"]).toBe(COV_FILL_OPACITY);
    expect(COV_FILL_OPACITY).toBeLessThanOrEqual(0.1);
    expect(outline).toMatchObject({ id: "cov-hexagons-outline", type: "line" });
    expect(paintOf(outline)["line-color"]).toBe("rgb(120, 120, 120)");
    expect(covHitLayerId(HEXAGONS)).toBe("cov-hexagons-fill");
    expect(covHitLayerId(SIGHTINGS)).toBe("cov-sightings_vessel-circle");
    expect(covHitLayerId(EFFORT)).toBe("cov-effort_vessel-line");
  });
  it("one source per ASSET: two overlays that are layers of one archive share it", () => {
    const a = spec({ id: "a", asset: "shared", sourceLayer: "a" });
    const b = spec({ id: "b", asset: "shared", sourceLayer: "b", geometry: "line" });
    const parts = collectionOverlayStyle([a, b], ["a", "b"])!;
    expect(Object.keys(parts.sources)).toEqual([covSourceId("shared")]);
    expect(parts.sources[covSourceId("shared")]).toEqual({
      type: "vector",
      url: "pmtiles://https://data.test/c/x.pmtiles",
    });
  });
  it("only the overlays that are on are composed; none on is null", () => {
    expect(collectionOverlayStyle(ALL, [])).toBeNull();
    const parts = collectionOverlayStyle(ALL, ["effort_vessel"])!;
    expect(parts.layers.map((l) => l.layer.id)).toEqual(["cov-effort_vessel-line"]);
  });
  it("the composed style is valid MapLibre style JSON", () => {
    const style = composeStyle({
      theme: "navy",
      basemap: null,
      collectionOverlays: collectionOverlayStyle(ALL, ALL_IDS, {
        field: "models",
        token: "rices_whale",
      }),
    });
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe("draw order: the collection's first entry on top; all between the Item and the places", () => {
  const hex = {
    pmtiles: "https://data.test/c/hex.pmtiles",
    sourceLayer: "hex",
    idField: "FID",
    colors: ["#000000", "#ffffff"],
    domain: [0, 1] as [number, number],
  };
  const style = composeStyle({
    theme: "navy",
    basemap: null,
    hex,
    raster: { id: "collection_raster", tiles: ["https://t.test/{z}/{x}/{y}.png"], opacity: 0.8 },
    collectionOverlays: collectionOverlayStyle(ALL, ALL_IDS),
    placeOverlays: [
      {
        slug: "noaa_sanctuaries",
        title: "Sanctuaries",
        pmtiles: "https://g.test/s.pmtiles",
        sourceLayer: "s",
        kind: "polygon",
        fillColor: "#e08a1e",
        lineColor: "#a85f00",
        lineWidth: 1,
        attribution: "",
      },
    ],
    selection: { features: { type: "FeatureCollection", features: [] } },
    highlight: { lngLat: [-90, 27], cell: null },
  });
  const ids = style.layers.map((l) => l.id);
  const at = (id: string) => {
    const i = ids.indexOf(id);
    expect(i, id).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("first entry on top: sightings over effort over hexagons (a polygon's outline over its fill)", () => {
    expect(at(covLayerId("hexagons", "fill"))).toBeLessThan(at(covLayerId("hexagons", "outline")));
    expect(at(covLayerId("hexagons", "outline"))).toBeLessThan(
      at(covLayerId("effort_vessel", "line")),
    );
    expect(at(covLayerId("effort_vessel", "line"))).toBeLessThan(
      at(covLayerId("sightings_vessel", "circle")),
    );
  });
  it("every overlay layer is above the Item (hex, raster) and below the place layers and selection", () => {
    const cov = ids.filter((id) => id.startsWith("cov-"));
    expect(cov).toHaveLength(4);
    const lowest = Math.min(...cov.map(at));
    const highest = Math.max(...cov.map(at));
    expect(at("hex-fill")).toBeLessThan(lowest);
    expect(at("hex-selected")).toBeLessThan(lowest);
    expect(at("collection_raster")).toBeLessThan(lowest);
    expect(highest).toBeLessThan(at("ov-noaa_sanctuaries-fill"));
    expect(highest).toBeLessThan(at("selection-fill"));
    expect(highest).toBeLessThan(at("cell-highlight-ring-halo"));
  });
  it("the array order is the draw order whatever the order the ids are listed in", () => {
    const reversed = collectionOverlayStyle(ALL, [...ALL_IDS].reverse())!;
    expect(reversed.layers.map((l) => l.layer.id)).toEqual(
      collectionOverlayStyle(ALL, ALL_IDS)!.layers.map((l) => l.layer.id),
    );
    expect(covHitLayerIds(ALL, [...ALL_IDS].reverse())).toEqual([
      "cov-sightings_vessel-circle",
      "cov-effort_vessel-line",
      "cov-hexagons-fill",
    ]);
  });
  it("they are the lens's data: hiding the Data row hides them too", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, visible: false } : e,
    );
    const hidden = composeStyle({
      theme: "navy",
      basemap: null,
      layerStack: stack,
      collectionOverlays: collectionOverlayStyle(ALL, ALL_IDS),
    });
    for (const l of hidden.layers.filter((x) => x.id.startsWith("cov-")))
      expect((l as { layout?: { visibility?: string } }).layout?.visibility).toBe("none");
  });
});

describe("the 'Only features matching the selected layer' filter", () => {
  const keep = (filter: FilterSpecification, properties: Record<string, unknown>) =>
    featureFilter(filter, "layers[0].filter").filter(
      { zoom: 6 } as never,
      {
        type: 1,
        properties,
      } as never,
    );
  const rices = overlayTokenFilter("models", "rices_whale");

  it("keeps a feature whose |-delimited property holds the token", () => {
    expect(keep(rices, { models: "|rices_whale|" })).toBe(true);
    expect(keep(rices, { models: "|bottlenose_dolphin|rices_whale|" })).toBe(true);
    const spotted = overlayTokenFilter("models", "pantropical_spotted_dolphin");
    expect(keep(spotted, { models: "|pantropical_spotted_dolphin|stenella_spp|" })).toBe(true);
  });
  it("no partial-token false positive: |rice| never matches |rices_whale|", () => {
    expect(keep(overlayTokenFilter("models", "rice"), { models: "|rices_whale|" })).toBe(false);
    expect(keep(overlayTokenFilter("models", "whale"), { models: "|rices_whale|" })).toBe(false);
    expect(keep(overlayTokenFilter("models", "stenella"), { models: "|stenella_spp|" })).toBe(
      false,
    );
  });
  it("a feature without the property, or with a non-string one, is not kept", () => {
    expect(keep(rices, {})).toBe(false);
    expect(keep(rices, { models: 42 })).toBe(false);
    expect(keep(rices, { models: "" })).toBe(false);
  });
  it("applies to the overlays whose filter_field matches, never to the others", () => {
    const parts = collectionOverlayStyle(ALL, ALL_IDS, { field: "models", token: "rices_whale" })!;
    const filterOf = (id: string) =>
      (parts.layers.find((l) => l.layer.id === id)!.layer as { filter?: unknown }).filter;
    expect(filterOf("cov-sightings_vessel-circle")).toEqual(rices);
    expect(filterOf("cov-effort_vessel-line")).toEqual(rices);
    expect(filterOf("cov-hexagons-fill")).toBeUndefined();
    expect(filterOf("cov-hexagons-outline")).toBeUndefined();
    // a filter on another field touches nothing; no filter is no filter at all
    const other = collectionOverlayStyle(ALL, ALL_IDS, { field: "species", token: "x" })!;
    expect(other.layers.every((l) => !("filter" in l.layer))).toBe(true);
    const none = collectionOverlayStyle(ALL, ALL_IDS, null)!;
    expect(none.layers.every((l) => !("filter" in l.layer))).toBe(true);
  });
});
