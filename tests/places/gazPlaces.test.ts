// the `p.` place kind in the Places model, the picker's hit-test, the GeoJSON download, the map
// outline, and the report's resolution step -- one small fixture per rule.
import { describe, expect, it } from "vitest";
import {
  addGazPlace,
  allGeomPlacesOutline,
  duplicatePlaceAt,
  gazIdsOf,
  hashFromPlaces,
  MAX_PLACES,
  placesFromHash,
  renamePlaceAt,
} from "../../src/places/model";
import { gazPickAtPoint, installGazPick } from "../../src/places/gazPick";
import { placesToGeoJson } from "../../src/places/download";
import type { Place } from "../../src/lib/geo/placeCodec";
import type { AreaGeometry } from "../../src/lib/geo/types";

const SQUARE: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-120, 33],
      [-119, 33],
      [-119, 34],
      [-120, 34],
      [-120, 33],
    ],
  ],
};
const GAZ: Place = { kind: "gaz", id: "NMS:CINMS", name: "Channel Islands" };

describe("addGazPlace / model rules for a gazetteer place", () => {
  it("appends a gaz place and the hash carries only the reference", () => {
    const r = addGazPlace([], "BOEM:OCS-P 0562", "OCS-P 0562");
    expect(r.ok).toBe(true);
    expect(hashFromPlaces(r.places)).toBe("p.BOEM%3AOCS-P%200562.OCS-P%200562");
    expect(placesFromHash(hashFromPlaces(r.places))).toEqual(r.places);
  });
  it("refuses a feature with no place_id, a duplicate, and a 21st place", () => {
    expect(addGazPlace([], "", "x").ok).toBe(false);
    expect(addGazPlace([GAZ], "NMS:CINMS", "again")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("already in your places"),
    });
    const full = Array.from({ length: MAX_PLACES }, (_, i) => ({
      kind: "gaz" as const,
      id: `X:${i}`,
      name: "",
    }));
    expect(addGazPlace(full, "X:new", "n").ok).toBe(false);
  });
  it("gazIdsOf lists each gazetteer id once, in order", () => {
    const places: Place[] = [
      GAZ,
      { kind: "zone", set: "pa", keys: ["GAA"] },
      { kind: "gaz", id: "A:1", name: "" },
      GAZ,
    ];
    expect(gazIdsOf(places)).toEqual(["NMS:CINMS", "A:1"]);
  });
  it("can be renamed (its name is in the token) but not duplicated", () => {
    expect(renamePlaceAt([GAZ], 0, "Islands").places[0]).toEqual({ ...GAZ, name: "Islands" });
    expect(duplicatePlaceAt([GAZ], 0).ok).toBe(false);
  });
});

describe("allGeomPlacesOutline draws resolved gazetteer places", () => {
  const hash = hashFromPlaces([GAZ, { kind: "gaz", id: "A:1", name: "" }]);
  it("a resolved gaz place is outlined; one still loading draws nothing (yet)", () => {
    const fc = allGeomPlacesOutline(hash, (id) => (id === "NMS:CINMS" ? SQUARE : undefined));
    expect(fc?.features).toHaveLength(1);
  });
  it("with no resolver (or nothing resolved) there is nothing to draw", () => {
    expect(allGeomPlacesOutline(hash)).toBeNull();
    expect(allGeomPlacesOutline(hash, () => undefined)).toBeNull();
  });
});

describe("gazPickAtPoint / installGazPick", () => {
  const feature = (props: Record<string, unknown> | null) => ({ properties: props });
  it("reads place_id and name off the first feature that has a place_id, queried on the gazetteer fill", () => {
    let layers: string[] = [];
    const map = {
      queryRenderedFeatures: (_p: unknown, o: { layers: string[] }) => {
        layers = o.layers;
        return [
          feature(null),
          feature({ name: "no id" }),
          feature({ place_id: "NMS:CINMS", name: "CI" }),
        ];
      },
    };
    expect(gazPickAtPoint(map, { x: 1, y: 2 })).toEqual({ id: "NMS:CINMS", name: "CI" });
    expect(layers).toEqual(["gazetteer-fill"]);
  });
  it("no feature, or a style that does not have the layer yet, is a miss rather than a throw", () => {
    expect(gazPickAtPoint({ queryRenderedFeatures: () => [] }, { x: 0, y: 0 })).toBeNull();
    expect(
      gazPickAtPoint(
        {
          queryRenderedFeatures: () => {
            throw new Error("Unknown layer");
          },
        },
        { x: 0, y: 0 },
      ),
    ).toBeNull();
  });
  it("a click reports the pick (or a miss) and uninstall removes the listener", () => {
    const listeners = new Set<(e: unknown) => void>();
    let hit = true;
    const map = {
      queryRenderedFeatures: () => (hit ? [feature({ place_id: "A:1", name: "" })] : []),
      on: (_t: string, l: (e: unknown) => void) => listeners.add(l),
      off: (_t: string, l: (e: unknown) => void) => listeners.delete(l),
    };
    const picks: string[] = [];
    let misses = 0;
    const h = installGazPick(
      map,
      (p) => picks.push(p.id),
      () => misses++,
    );
    for (const l of listeners) l({ point: { x: 1, y: 1 } });
    hit = false;
    for (const l of listeners) l({ point: { x: 1, y: 1 } });
    expect(picks).toEqual(["A:1"]);
    expect(misses).toBe(1);
    h.uninstall();
    expect(listeners.size).toBe(0);
  });
});

describe("placesToGeoJson for a gazetteer place", () => {
  it("carries the place_id, and the geometry when the session fetched it", () => {
    const fc = placesToGeoJson([GAZ], () => SQUARE);
    expect(fc.features[0]).toEqual({
      type: "Feature",
      geometry: SQUARE,
      properties: { kind: "gaz", place_id: "NMS:CINMS", name: "Channel Islands" },
    });
  });
  it("geometry is null (but still identified) when it was not fetched", () => {
    const fc = placesToGeoJson([GAZ]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({ place_id: "NMS:CINMS" });
  });
});
