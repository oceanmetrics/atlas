// The "Place layers" overlays: their style objects, how composeStyle folds them in (sources, roles,
// draw order, the group's visibility and opacity) and that no input means no trace of them.
import { describe, expect, it } from "vitest";
import {
  OVERLAY_FILL_OPACITY,
  overlayHitLayerIds,
  overlayLayers,
  overlaySource,
} from "../../src/lib/map/layers/overlays";
import { composeStyle } from "../../src/lib/map/style";
import {
  DEFAULT_LAYER_STACK,
  LAYER_GROUP_IN_PANEL,
  LAYER_GROUP_LABEL,
  defaultLayerStackEntries,
} from "../../src/lib/map/layerStack";
import type { PlaceOverlaySpec } from "../../src/lib/map/types";

const POLY: PlaceOverlaySpec = {
  slug: "noaa_sanctuaries",
  title: "Sanctuaries",
  pmtiles: "https://s3.test/gazetteer/noaa_sanctuaries/places.pmtiles",
  sourceLayer: "noaa_sanctuaries",
  kind: "polygon",
  fillColor: "orange",
  lineColor: "brown",
  lineWidth: 2,
  attribution: "ONMS. Processed by Ocean Metrics.",
};
const LINE: PlaceOverlaySpec = {
  ...POLY,
  slug: "calcofi_lines",
  sourceLayer: "calcofi_lines",
  kind: "line",
};
const POINT: PlaceOverlaySpec = {
  ...POLY,
  slug: "calcofi_stations",
  sourceLayer: "calcofi_stations",
  kind: "point",
};
const EMPTY_BASEMAP = { sources: {}, layers: [] };
const compose = (extra: object = {}) =>
  composeStyle({ theme: "paper", basemapStyle: EMPTY_BASEMAP, ...extra });
const ids = (s: ReturnType<typeof compose>) => s.layers.map((l) => l.id);

describe("overlay style objects", () => {
  it("the source is a pmtiles:// vector source carrying the credit", () => {
    expect(overlaySource(POLY)).toEqual({
      type: "vector",
      url: `pmtiles://${POLY.pmtiles}`,
      attribution: POLY.attribution,
    });
    expect(overlaySource({ ...POLY, attribution: "" })).not.toHaveProperty("attribution");
  });
  it("a polygon is a faint fill under a line; a line is a line; a point is a circle", () => {
    const poly = overlayLayers(POLY);
    expect(poly.map((l) => l.layer.type)).toEqual(["fill", "line"]);
    expect(poly[0].layer.paint).toMatchObject({
      "fill-color": "orange",
      "fill-opacity": OVERLAY_FILL_OPACITY,
    });
    expect(OVERLAY_FILL_OPACITY).toBeLessThan(0.25); // faint: fainter than the picker's fill
    expect(poly[1].layer.paint).toMatchObject({ "line-color": "brown", "line-width": 2 });
    expect(overlayLayers(LINE).map((l) => l.layer.type)).toEqual(["line"]);
    expect(overlayLayers(POINT).map((l) => l.layer.type)).toEqual(["circle"]);
  });
  it("hit layers: the fill of a polygon, the line of a line, the circle of a point", () => {
    expect(overlayHitLayerIds([POLY, LINE, POINT])).toEqual([
      "ov-noaa_sanctuaries-fill",
      "ov-calcofi_lines-line",
      "ov-calcofi_stations-circle",
    ]);
  });
});

describe("composeStyle with place overlays", () => {
  it("each overlay adds one source and its layers on the archive's source-layer", () => {
    const style = compose({ placeOverlays: [POLY, LINE] });
    expect(Object.keys(style.sources).sort()).toEqual(["ov-calcofi_lines", "ov-noaa_sanctuaries"]);
    const fill = style.layers.find((l) => l.id === "ov-noaa_sanctuaries-fill") as {
      "source-layer": string;
    };
    expect(fill["source-layer"]).toBe("noaa_sanctuaries");
  });
  it("no overlays, no trace (every existing style is unchanged)", () => {
    const style = compose();
    expect(Object.keys(style.sources).filter((k) => k.startsWith("ov-"))).toEqual([]);
    expect(ids(style).some((i) => i.startsWith("ov-"))).toBe(false);
  });
  it("draws over the data and under the picker and the selection; every fill under every line", () => {
    const style = compose({
      placeOverlays: [POLY, { ...POLY, slug: "b", sourceLayer: "b" }],
      hex: {
        pmtiles: "https://x/hex.pmtiles",
        sourceLayer: "hex",
        idField: "FID",
        colors: ["black", "white"],
        domain: [0, 1],
      },
      gazetteer: {
        slug: "places",
        pmtiles: "https://x/p.pmtiles",
        sourceLayer: "places",
        attribution: "",
      },
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    const order = ids(style);
    const at = (id: string) => order.indexOf(id);
    expect(at("hex-fill")).toBeLessThan(at("ov-noaa_sanctuaries-fill"));
    expect(at("ov-noaa_sanctuaries-line")).toBeLessThan(at("gazetteer-fill"));
    expect(at("gazetteer-line")).toBeLessThan(at("selection-fill"));
    expect(Math.max(at("ov-noaa_sanctuaries-fill"), at("ov-b-fill"))).toBeLessThan(
      Math.min(at("ov-noaa_sanctuaries-line"), at("ov-b-line")),
    );
  });
  it("the 'Place layers' stack row hides and dims the overlays together", () => {
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-overlays" ? { ...e, visible: false } : e,
    );
    const hidden = compose({ placeOverlays: [POLY], layerStack: stack });
    for (const id of ["ov-noaa_sanctuaries-fill", "ov-noaa_sanctuaries-line"]) {
      expect(
        (hidden.layers.find((l) => l.id === id) as { layout?: { visibility?: string } }).layout
          ?.visibility,
      ).toBe("none");
    }
    const dimmed = compose({
      placeOverlays: [POLY],
      layerStack: defaultLayerStackEntries().map((e) =>
        e.id === "data-overlays" ? { ...e, opacity: 0.5 } : e,
      ),
    });
    expect(
      (
        dimmed.layers.find((l) => l.id === "ov-noaa_sanctuaries-line") as {
          paint: Record<string, unknown>;
        }
      ).paint["line-opacity"],
    ).toBe(0.5);
  });
});

describe("the 'Place layers' stack group", () => {
  it("sits between the data and the selection in the default stack, is listed in the panel, and is not named 'Places'", () => {
    const i = DEFAULT_LAYER_STACK.indexOf("data-overlays");
    expect(DEFAULT_LAYER_STACK[i - 1]).toBe("data-raster");
    expect(DEFAULT_LAYER_STACK[i + 1]).toBe("data-places");
    expect(LAYER_GROUP_IN_PANEL["data-overlays"]).toBe(true);
    // the rail's tool button is named "Places"; a row label containing it breaks that locator
    expect(LAYER_GROUP_LABEL["data-overlays"]).not.toMatch(/places/i);
  });
});
