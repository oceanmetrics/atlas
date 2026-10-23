// "Download places" with a release's zone places (places/zoneDownload.ts, the Report tool's Places
// flow): moved from MarineSensitivity/atlas 0.10.93's tests/places/download.test.ts, which exercised
// the same builder before the zone part moved beside the generic one (places/download.ts,
// tests/places/download.test.ts).
import { describe, expect, it } from "vitest";
import { zonePlacesToGeoJson as placesToGeoJson } from "../../src/places/zoneDownload";
import type { GeomPlace, Place, UploadPlace, ZonePlace } from "../../src/lib/geo/placeCodec";

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

  it("a zone place with no boot/polygons context still degrades to `geometry: null` (RFC 7946), with an explanatory note rather than a silent drop", () => {
    const fc = placesToGeoJson([ZONE]);
    expect(fc.features[0].geometry).toBeNull();
    expect(fc.features[0].properties).toMatchObject({
      kind: "zone",
      set: "pa",
      keys: ["GAA", "WGA"],
      note: expect.stringContaining("no polygon tile loaded"),
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

// owner review item 2 (Ben, live 0.10.62): "Download places returns a places.geojson with
// `geometry: null` and `name: GAA`, ie only acronym and not full program name." RED-FIRST: every
// test below fails on the pre-fix `placesToGeoJson(places)` (a one-argument function that always
// wrote `fallbackZoneLabel` and `geometry: null` for a zone place, no matter what).
describe("placesToGeoJson: zone places resolve the FULL name + REAL geometry (owner review item 2)", () => {
  const BOOT = {
    zones: {
      programarea: [{ key: "GAA", name: "Gulf of America", label_pt: [-90, 27] }],
    },
  };
  const SQUARE = {
    type: "Polygon" as const,
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
  const ONE_ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA"] };

  it("resolves the release's own full 'Name (KEY)' label -- never the bare acronym", () => {
    const fc = placesToGeoJson([ONE_ZONE], BOOT);
    expect(fc.features[0].properties?.name).toBe("Gulf of America (GAA)");
  });

  it("embeds the REAL polygon queried live off the map's own PMTiles source -- never null when one is found", () => {
    const polygons = {
      queryZonePolygons: (unit: string, keys: readonly string[]) => {
        expect(unit).toBe("programarea");
        expect(keys).toEqual(["GAA"]);
        return [{ geometry: SQUARE }];
      },
    };
    const fc = placesToGeoJson([ONE_ZONE], BOOT, polygons);
    expect(fc.features[0].geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [SQUARE.coordinates],
    });
    expect(fc.features[0].properties).not.toHaveProperty("geometry_source");
    expect(fc.features[0].properties?.name).toBe("Gulf of America (GAA)");
  });

  it("falls back to a bbox polygon around the zone's label point when the query finds nothing, marked geometry_source: bbox", () => {
    const polygons = { queryZonePolygons: () => [] };
    const fc = placesToGeoJson([ONE_ZONE], BOOT, polygons);
    expect(fc.features[0].geometry).not.toBeNull();
    expect(fc.features[0].geometry?.type).toBe("Polygon");
    expect(fc.features[0].properties?.geometry_source).toBe("bbox");
    // a small box around the published label point (-90, 27), never the whole world.
    const coords = (fc.features[0].geometry as { coordinates: number[][][] }).coordinates[0];
    for (const [lon, lat] of coords) {
      expect(lon).toBeGreaterThanOrEqual(-91);
      expect(lon).toBeLessThanOrEqual(-89);
      expect(lat).toBeGreaterThanOrEqual(26);
      expect(lat).toBeLessThanOrEqual(28);
    }
  });

  it("a multi-key zone place unions every key's rendered polygon into one MultiPolygon", () => {
    const TWO_ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA", "WGA"] };
    const other = {
      type: "Polygon" as const,
      coordinates: [
        [
          [10, 10],
          [11, 10],
          [11, 11],
          [10, 11],
          [10, 10],
        ],
      ],
    };
    const polygons = {
      queryZonePolygons: () => [{ geometry: SQUARE }, { geometry: other }],
    };
    const fc = placesToGeoJson([TWO_ZONE], BOOT, polygons);
    expect(fc.features[0].geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [SQUARE.coordinates, other.coordinates],
    });
  });
});
