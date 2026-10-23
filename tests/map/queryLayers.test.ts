import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";
import { queryLayerFeatures, type LayerQueryMap } from "../../src/lib/map/queryLayers";
import { renderedZoneOutline } from "../../src/places/zoneOutline";
import { zoneKeyProperty } from "../../src/lib/map/layers/zones";

const F = (key: string): Feature => ({
  type: "Feature",
  properties: { k: key },
  geometry: { type: "Point", coordinates: [0, 0] },
});

function fakeMap(over: Partial<LayerQueryMap> = {}): LayerQueryMap {
  return {
    queryRenderedFeatures: () => [],
    getLayer: () => ({ source: "programarea_src", sourceLayer: "programarea" }),
    getLayoutProperty: () => undefined,
    getZoom: () => 2.2,
    querySourceFeatures: () => [F("GAA")],
    ...over,
  };
}

describe("queryLayerFeatures", () => {
  it("returns the rendered features untouched when the renderer answers", () => {
    const map = fakeMap({
      queryRenderedFeatures: () => [F("a")],
      querySourceFeatures: () => {
        throw new Error("must not be asked");
      },
    });
    expect(queryLayerFeatures(map, ["programarea_ln"])).toHaveLength(1);
  });

  // regression: zone-layer-renders-with-left-dock. On the globe the viewport query is [] for
  // many camera centres (the left dock's fit centre is one) while the lines are painted.
  it("zone-layer-renders-with-left-dock: falls back to the loaded tiles when the viewport query is empty", () => {
    const seen: unknown[] = [];
    const map = fakeMap({
      querySourceFeatures: (src, opts) => {
        seen.push([src, opts]);
        return [F("GAA"), F("MDA")];
      },
    });
    expect(queryLayerFeatures(map, ["programarea_ln"])).toHaveLength(2);
    expect(seen).toEqual([["programarea_src", { sourceLayer: "programarea" }]]);
  });

  it("never resurrects an absent layer", () => {
    expect(queryLayerFeatures(fakeMap({ getLayer: () => undefined }), ["x"])).toEqual([]);
  });

  it("never resurrects a hidden layer", () => {
    const map = fakeMap({ getLayoutProperty: () => "none" });
    expect(queryLayerFeatures(map, ["programarea_ln"])).toEqual([]);
  });

  it("respects the layer's zoom range", () => {
    const base = { source: "s", sourceLayer: "l" };
    expect(
      queryLayerFeatures(fakeMap({ getLayer: () => ({ ...base, minzoom: 5 }) }), ["a"]),
    ).toEqual([]);
    expect(
      queryLayerFeatures(fakeMap({ getLayer: () => ({ ...base, maxzoom: 2 }) }), ["a"]),
    ).toEqual([]);
  });

  it("an unloaded source is a quiet empty, not a throw", () => {
    const map = fakeMap({
      querySourceFeatures: () => {
        throw new Error("no tile manager");
      },
    });
    expect(queryLayerFeatures(map, ["a"])).toEqual([]);
  });
});

describe("renderedZoneOutline on the globe", () => {
  it("zone-layer-renders-with-left-dock: still outlines a picked zone when the viewport query is empty", () => {
    const prop = zoneKeyProperty("programarea");
    const gaa = {
      type: "Feature" as const,
      properties: { [prop]: "GAA" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };
    const map = fakeMap({ querySourceFeatures: () => [gaa] });
    expect(renderedZoneOutline(map, "programarea", ["GAA"]).features).toHaveLength(1);
  });
});
