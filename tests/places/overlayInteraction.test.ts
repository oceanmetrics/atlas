import { describe, expect, it } from "vitest";
import {
  addToPlacesLabel,
  canAddToPlaces,
  overlayFeatureAt,
  overlayFeatureInfo,
  overlayHoverText,
} from "../../src/places/overlayInteraction";
import { maplibreLikeQuery } from "../map/maplibreQuery";

describe("what an overlay feature says", () => {
  it("name and status make the hover line; no status, just the name", () => {
    const rescinded = overlayFeatureInfo(
      { place_id: "BOEM:X 1", name: "Humboldt", status: "rescinded" },
      "MultiPolygon",
    );
    expect(overlayHoverText(rescinded)).toBe("Humboldt (rescinded)");
    expect(overlayHoverText(overlayFeatureInfo({ name: "Morro Bay" }))).toBe("Morro Bay");
  });
  it("a feature with no name falls back to its place_id, then to a plain label", () => {
    expect(overlayFeatureInfo({ place_id: "A:1" }).name).toBe("A:1");
    expect(overlayFeatureInfo({}).name).toBe("Unnamed feature");
    expect(overlayFeatureInfo(null).name).toBe("Unnamed feature");
  });
  it("the popup offers 'Add <name> to Places' only for an AREA that has a place_id", () => {
    const area = overlayFeatureInfo(
      { place_id: "NMS:CINMS", name: "Channel Islands" },
      "MultiPolygon",
    );
    expect(canAddToPlaces(area)).toBe(true);
    expect(addToPlacesLabel(area.name)).toBe("Add Channel Islands to Places");
    expect(canAddToPlaces(overlayFeatureInfo({ name: "No id" }, "Polygon"))).toBe(false);
    expect(
      canAddToPlaces(overlayFeatureInfo({ place_id: "L:1", name: "Line" }, "LineString")),
    ).toBe(false);
    expect(canAddToPlaces(overlayFeatureInfo({ place_id: "P:1", name: "Pt" }, "Point"))).toBe(
      false,
    );
  });
});

describe("overlayFeatureAt: only layers that exist, with a little slack", () => {
  const feature = { properties: { place_id: "A:1", name: "A" }, geometry: { type: "Polygon" } };
  it("asks only about layers that are in the style, at the exact point first", () => {
    const calls: unknown[] = [];
    const map = {
      getLayer: (id: string) => (id === "ov-a-fill" ? {} : undefined),
      queryRenderedFeatures: (geometry: unknown, o: { layers: string[] }) => {
        calls.push([geometry, o.layers]);
        return [feature];
      },
    };
    const info = overlayFeatureAt(map, { x: 10, y: 20 }, ["ov-a-fill", "ov-gone-fill"], 3);
    expect(info).toMatchObject({ name: "A", placeId: "A:1", isArea: true });
    // the point as an array (a plain {x, y} is the whole viewport to MapLibre, regression 0.7.0 below)
    expect(calls).toEqual([[[10, 20], ["ov-a-fill"]]]);
  });
  it("nothing at the point: a small box around it catches a 1-px line", () => {
    const calls: unknown[] = [];
    const map = {
      getLayer: () => ({}),
      queryRenderedFeatures: (geometry: unknown) => {
        calls.push(geometry);
        // a box ([[x0, y0], [x1, y1]]) catches the line; the bare point misses it
        return Array.isArray((geometry as unknown[])[0]) ? [feature] : [];
      },
    };
    expect(overlayFeatureAt(map, { x: 10, y: 20 }, ["ov-a-line"], 3)).toMatchObject({ name: "A" });
    expect(calls).toEqual([
      [10, 20],
      [
        [7, 17],
        [13, 23],
      ],
    ]);
  });
  it("no overlay layer in the style: nothing to ask, nothing found", () => {
    const map = { getLayer: () => undefined, queryRenderedFeatures: () => [feature] };
    expect(overlayFeatureAt(map, { x: 1, y: 1 }, ["ov-a-fill"])).toBeNull();
    expect(overlayFeatureAt(map, { x: 1, y: 1 }, [])).toBeNull();
  });
  it("a query that throws (a click racing a style swap) is a miss, not an error", () => {
    const map = {
      getLayer: () => ({}),
      queryRenderedFeatures: () => {
        throw new Error("style is not done loading");
      },
    };
    expect(overlayFeatureAt(map, { x: 1, y: 1 }, ["ov-a-fill"])).toBeNull();
  });
  it("no feature under the point is a miss", () => {
    const map = { getLayer: () => ({}), queryRenderedFeatures: () => [] };
    expect(overlayFeatureAt(map, { x: 1, y: 1 }, ["ov-a-fill"])).toBeNull();
  });
});

// Regression 0.7.0: the hit test passed the point as a plain `{x, y}`, which MapLibre does not take as a
// query geometry (only a `Point` instance or an array is one): it queried the WHOLE viewport, so as soon as
// any feature of a place layer was in view, every hover and click "hit" it -- a hover over empty sea named a
// far-away sanctuary, the hex hover stayed quiet everywhere, a raster click opened the place's card.
describe("regression 0.7.0: a hover or click hits only the feature UNDER the pointer", () => {
  const map = {
    getLayer: () => ({}),
    queryRenderedFeatures: maplibreLikeQuery([
      { layer: "ov-a-fill", rect: [100, 100, 200, 200], properties: { name: "Sanctuary" } },
    ]),
  };
  it("a point inside the polygon hits it", () => {
    expect(overlayFeatureAt(map, { x: 150, y: 150 }, ["ov-a-fill"])).toMatchObject({
      name: "Sanctuary",
    });
  });
  it("a point far from it, the polygon still in view, hits nothing", () => {
    expect(overlayFeatureAt(map, { x: 400, y: 400 }, ["ov-a-fill"])).toBeNull();
    expect(overlayFeatureAt(map, { x: 10, y: 150 }, ["ov-a-fill"], 3)).toBeNull();
  });
  it("the slack box still catches a point just beside it", () => {
    expect(overlayFeatureAt(map, { x: 202, y: 150 }, ["ov-a-fill"], 3)).toMatchObject({
      name: "Sanctuary",
    });
  });
});
