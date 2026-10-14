import { describe, expect, it } from "vitest";
import {
  addToPlacesLabel,
  canAddToPlaces,
  overlayFeatureAt,
  overlayFeatureInfo,
  overlayHoverText,
} from "../../src/places/overlayInteraction";

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
  it("asks only about layers that are in the style, over a small box around the point", () => {
    const calls: unknown[] = [];
    const map = {
      getLayer: (id: string) => (id === "ov-a-fill" ? {} : undefined),
      queryRenderedFeatures: (box: unknown, o: { layers: string[] }) => {
        calls.push([box, o.layers]);
        return [feature];
      },
    };
    const info = overlayFeatureAt(map, { x: 10, y: 20 }, ["ov-a-fill", "ov-gone-fill"], 3);
    expect(info).toMatchObject({ name: "A", placeId: "A:1", isArea: true });
    expect(calls).toEqual([
      [
        [
          [7, 17],
          [13, 23],
        ],
        ["ov-a-fill"],
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
