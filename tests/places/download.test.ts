import { describe, expect, it } from "vitest";
import { placesToGeoJson } from "../../src/places/download";
import type { GeomPlace, Place, UploadPlace, ZonePlace } from "../../src/lib/geo/placeCodec";
import type { AreaGeometry } from "../../src/lib/geo/types";

const GEOM: GeomPlace = {
  kind: "geom",
  name: "My Draw",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  },
};
const ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA", "WGA"] };
const UPLOAD: UploadPlace = { kind: "upload", name: "Too Big", digest: "deadbeef" };

describe("placesToGeoJson: the DECODED geometries actually analysed (Deliverable 1)", () => {
  it("a geom place carries its real geometry, unmodified", () => {
    const fc = placesToGeoJson([GEOM]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry).toEqual(GEOM.geometry);
    expect(fc.features[0].properties).toEqual({ kind: "geom", name: "My Draw" });
  });

  it("a legacy zone place (an older link) exports its keys with `geometry: null` (RFC 7946) and a note, never a silent drop", () => {
    const fc = placesToGeoJson([ZONE]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({
      kind: "zone",
      set: "pa",
      keys: ["GAA", "WGA"],
      name: "GAA, WGA",
      note: expect.stringContaining("no longer published"),
    });
  });

  it("an upload place (too large for the link) is a null-geometry stub naming the digest", () => {
    const fc = placesToGeoJson([UPLOAD]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({
      kind: "upload",
      name: "Too Big",
      digest: "deadbeef",
    });
  });

  it("one Feature per place, in order", () => {
    const places: Place[] = [GEOM, ZONE, UPLOAD];
    expect(placesToGeoJson(places).features).toHaveLength(3);
  });

  it("an empty list is an empty FeatureCollection", () => {
    expect(placesToGeoJson([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("placesToGeoJson: gazetteer (p.) places", () => {
  const SQUARE: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [-91, 26],
        [-89, 26],
        [-89, 28],
        [-91, 28],
        [-91, 26],
      ],
    ],
  };

  it("embeds the fetched geometry when the session has it, naming the place_id", () => {
    const fc = placesToGeoJson([{ kind: "gaz", id: "NMS:fknms", name: "Florida Keys" }], (id) =>
      id === "NMS:fknms" ? SQUARE : null,
    );
    expect(fc.features[0].geometry).toEqual(SQUARE);
    expect(fc.features[0].properties).toEqual({
      kind: "gaz",
      place_id: "NMS:fknms",
      name: "Florida Keys",
    });
  });

  it("leaves geometry null (never drops the place) when the geometry has not been fetched", () => {
    const fc = placesToGeoJson([{ kind: "gaz", id: "NMS:fknms", name: "" }]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties?.name).toBe("NMS:fknms"); // the id names it when no name
  });
});
