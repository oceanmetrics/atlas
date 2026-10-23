import { describe, expect, it } from "vitest";
import {
  EMPTY_FEATURE_COLLECTION,
  renderedZoneOutline,
  type RenderedFeatureLike,
} from "../../src/places/zoneOutline";
import { zoneFillId, zoneKeyProperty, zoneLineId } from "../../src/lib/map/layers/zones";

const UNIT = "programarea";
const KEY_PROP = zoneKeyProperty(UNIT);

function feature(_layerId: string, key: string, coords: number[][]): RenderedFeatureLike {
  return {
    properties: { [KEY_PROP]: key },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

describe("renderedZoneOutline", () => {
  it("returns nothing (without querying) when no keys are picked", () => {
    let queried = false;
    const map = {
      queryRenderedFeatures() {
        queried = true;
        return [];
      },
    };
    expect(renderedZoneOutline(map, UNIT, [])).toEqual(EMPTY_FEATURE_COLLECTION);
    expect(queried).toBe(false);
  });

  it("keeps only features whose key is in the picked set", () => {
    const gaa = feature(zoneFillId(UNIT), "GAA", [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    const wga = feature(zoneFillId(UNIT), "WGA", [
      [2, 2],
      [2, 3],
      [3, 3],
      [3, 2],
      [2, 2],
    ]);
    const map = { queryRenderedFeatures: () => [gaa, wga] };
    const fc = renderedZoneOutline(map, UNIT, ["GAA"]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.[KEY_PROP]).toBe("GAA");
  });

  it("deduplicates the SAME feature reported by both the fill and the line layer", () => {
    const gaaFill = feature(zoneFillId(UNIT), "GAA", [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    const gaaLine = feature(zoneLineId(UNIT), "GAA", [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    const map = { queryRenderedFeatures: () => [gaaFill, gaaLine] };
    const fc = renderedZoneOutline(map, UNIT, ["GAA"]);
    expect(fc.features).toHaveLength(1);
  });

  it("keeps two DIFFERENT tile-clipped pieces of the same key as separate features", () => {
    const piece1 = feature(zoneFillId(UNIT), "GAA", [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    const piece2 = feature(zoneFillId(UNIT), "GAA", [
      [5, 5],
      [5, 6],
      [6, 6],
      [6, 5],
      [5, 5],
    ]);
    const map = { queryRenderedFeatures: () => [piece1, piece2] };
    const fc = renderedZoneOutline(map, UNIT, ["GAA"]);
    expect(fc.features).toHaveLength(2);
  });

  it("ignores a feature with no geometry and one whose key property is missing/wrong type", () => {
    const noGeom: RenderedFeatureLike = { properties: { [KEY_PROP]: "GAA" } };
    const badKey: RenderedFeatureLike = {
      properties: { [KEY_PROP]: { nested: true } },
      geometry: { type: "Point", coordinates: [0, 0] },
    };
    const map = { queryRenderedFeatures: () => [noGeom, badKey] };
    expect(renderedZoneOutline(map, UNIT, ["GAA"]).features).toHaveLength(0);
  });
});
