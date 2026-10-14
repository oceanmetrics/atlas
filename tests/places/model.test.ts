import { describe, expect, it } from "vitest";
import {
  addPlace,
  addZonePlace,
  allGeomPlacesOutline,
  duplicatePlaceAt,
  fallbackZoneLabel,
  featureCollectionOf,
  hashFromPlaces,
  isGeomOrUpload,
  MAX_PLACES,
  placesFromHash,
  removePlaceAt,
  renamePlaceAt,
  reportHash,
  selectedGeomPlaceGeometry,
  selectedPlaceIndex,
  unitForZoneSet,
  zoneSetForUnit,
} from "../../src/places/model";
import { densifyGeometry } from "../../src/places/densify";
import type { GeomPlace, Place, ZonePlace } from "../../src/lib/geo/placeCodec";
import { parseSel } from "../../src/lib/state/codec";

const SQUARE: GeomPlace = {
  kind: "geom",
  name: "Square",
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
const ZONE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA"] };

describe("placesFromHash / hashFromPlaces", () => {
  it("round-trips a zone place through the hash", () => {
    const hash = hashFromPlaces([ZONE]);
    expect(hash).toBeDefined();
    expect(placesFromHash(hash)).toEqual([ZONE]);
  });

  it("an empty list clears the hash key (undefined, not '')", () => {
    expect(hashFromPlaces([])).toBeUndefined();
  });

  it("an absent hash decodes to zero places", () => {
    expect(placesFromHash(undefined)).toEqual([]);
  });

  it("an unreadable token is dropped, never thrown (decodePlaces' own contract)", () => {
    expect(placesFromHash("not.a.valid.token~z.pa.GAA")).toEqual([ZONE]);
  });
});

describe("addPlace: the 20-place cap (Deliverable 1)", () => {
  it("appends under the cap", () => {
    const r = addPlace([], ZONE);
    expect(r.ok).toBe(true);
    expect(r.places).toEqual([ZONE]);
  });

  it("refuses the 21st place, leaving the list unchanged", () => {
    const full: Place[] = Array.from({ length: MAX_PLACES }, () => ZONE);
    const r = addPlace(full, ZONE);
    expect(r.ok).toBe(false);
    expect(r.places).toHaveLength(MAX_PLACES);
    expect(r.reason).toMatch(/20/);
  });
});

describe("removePlaceAt", () => {
  it("removes exactly the index given, leaving the rest in order", () => {
    const list = [ZONE, SQUARE, { ...ZONE, keys: ["WGA"] }];
    expect(removePlaceAt(list, 1)).toEqual([ZONE, { ...ZONE, keys: ["WGA"] }]);
  });
});

describe("renamePlaceAt", () => {
  it("renames a geom place, clamped to 60 chars", () => {
    const r = renamePlaceAt([SQUARE], 0, "a".repeat(90));
    expect(r.ok).toBe(true);
    expect((r.places[0] as GeomPlace).name.length).toBeLessThanOrEqual(60);
  });

  it("refuses an empty name", () => {
    const r = renamePlaceAt([SQUARE], 0, "   ");
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([SQUARE]);
  });

  it("refuses to rename a zone place (no name field in the codec) and leaves it unchanged", () => {
    const r = renamePlaceAt([ZONE], 0, "My Areas");
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([ZONE]);
  });

  it("refuses an out-of-range index", () => {
    const r = renamePlaceAt([SQUARE], 5, "x");
    expect(r.ok).toBe(false);
  });
});

describe("duplicatePlaceAt", () => {
  it("appends a copy of a geom place with ' copy' suffixed", () => {
    const r = duplicatePlaceAt([SQUARE], 0);
    expect(r.ok).toBe(true);
    expect(r.places).toHaveLength(2);
    expect((r.places[1] as GeomPlace).name).toBe("Square copy");
    expect((r.places[1] as GeomPlace).geometry).toEqual(SQUARE.geometry);
  });

  it("refuses to duplicate a zone place", () => {
    const r = duplicatePlaceAt([ZONE], 0);
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([ZONE]);
  });

  it("respects the 20-place cap", () => {
    const full: Place[] = Array.from({ length: MAX_PLACES }, () => SQUARE);
    const r = duplicatePlaceAt(full, 0);
    expect(r.ok).toBe(false);
  });
});

describe("addZonePlace: the pick-mode / zones-table hook", () => {
  it("adds one new zone place carrying every picked key, deduplicated", () => {
    const r = addZonePlace([], "pa", ["GAA", "WGA", "GAA"]);
    expect(r.ok).toBe(true);
    expect(r.places).toEqual([{ kind: "zone", set: "pa", keys: ["GAA", "WGA"] }]);
  });

  it("refuses an empty pick", () => {
    const r = addZonePlace([], "pa", []);
    expect(r.ok).toBe(false);
  });
});

describe("isGeomOrUpload", () => {
  it("is true for geom and upload, false for zone", () => {
    expect(isGeomOrUpload(SQUARE)).toBe(true);
    expect(isGeomOrUpload({ kind: "upload", name: "x", digest: "0".repeat(8) })).toBe(true);
    expect(isGeomOrUpload(ZONE)).toBe(false);
  });
});

describe("fallbackZoneLabel", () => {
  it("joins the keys with ', '", () => {
    expect(fallbackZoneLabel({ kind: "zone", set: "pa", keys: ["GAA", "WGA"] })).toBe("GAA, WGA");
  });
});

describe("zoneSetForUnit / unitForZoneSet: the codec <-> boot.units mapping, inverse of each other", () => {
  it("maps every unit this app knows about", () => {
    expect(zoneSetForUnit("programarea")).toBe("pa");
    expect(zoneSetForUnit("planarea")).toBe("pl");
    expect(zoneSetForUnit("ecoregion")).toBe("er");
    expect(zoneSetForUnit("subregion")).toBe("sr");
    expect(zoneSetForUnit("nonsense")).toBeNull();
  });

  it("round-trips: unitForZoneSet(zoneSetForUnit(u)) === u for every known unit", () => {
    for (const u of ["programarea", "planarea", "ecoregion", "subregion"]) {
      const set = zoneSetForUnit(u);
      expect(set).not.toBeNull();
      expect(unitForZoneSet(set!)).toBe(u);
    }
  });
});

// 0.10.21 Places same-class fix (e2e/places.deeplink-outline.spec.ts): `selectedPlaceIndex`/
// `selectedGeomPlaceGeometry` are what `placesMap.svelte.ts`'s baseline outline-restore effect
// calls, so they must be right independent of any svelte reactivity -- see that file's header for
// why this restore no longer lives ONLY inside `Places.svelte`.
describe("selectedPlaceIndex", () => {
  it("parses the one token shape a row selection ever writes", () => {
    expect(selectedPlaceIndex("place:0")).toBe(0);
    expect(selectedPlaceIndex("place:12")).toBe(12);
  });

  it("is null for undefined, a different token kind, or a malformed one", () => {
    expect(selectedPlaceIndex(undefined)).toBeNull();
    expect(selectedPlaceIndex("zone:programarea:GAA")).toBeNull();
    expect(selectedPlaceIndex("place:")).toBeNull();
    expect(selectedPlaceIndex("place:-1")).toBeNull();
    expect(selectedPlaceIndex("place:1a")).toBeNull();
  });
});

describe("featureCollectionOf", () => {
  it("wraps a geometry as the one-feature FeatureCollection the selection layer expects", () => {
    expect(featureCollectionOf(SQUARE.geometry)).toEqual({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: SQUARE.geometry, properties: {} }],
    });
  });
});

describe("selectedGeomPlaceGeometry", () => {
  const hash = hashFromPlaces([ZONE, SQUARE]);

  it("resolves a selected geom place's own geometry", () => {
    expect(selectedGeomPlaceGeometry(hash, "place:1")).toEqual(SQUARE.geometry);
  });

  it("is null for a selected ZONE place -- its highlight is drawn elsewhere", () => {
    expect(selectedGeomPlaceGeometry(hash, "place:0")).toBeNull();
  });

  it("is null with nothing selected, an out-of-range index, or no places at all", () => {
    expect(selectedGeomPlaceGeometry(hash, undefined)).toBeNull();
    expect(selectedGeomPlaceGeometry(hash, "place:9")).toBeNull();
    expect(selectedGeomPlaceGeometry(undefined, "place:0")).toBeNull();
  });
});

// P7 ("drawn places vanish from the map after the second draw"): `placesMap.svelte.ts`'s baseline
// used to call `selectedGeomPlaceGeometry` -- ONE place -- so drawing a second place silently
// dropped the outline of the one drawn just before it (the new place auto-selects itself,
// `Places.svelte#writePlaces`). `allGeomPlacesOutline` is the fix: every geom place, always.
describe("allGeomPlacesOutline", () => {
  const TRIANGLE: GeomPlace = {
    kind: "geom",
    name: "Triangle",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [2, 2],
          [3, 2],
          [2, 3],
          [2, 2],
        ],
      ],
    },
  };

  it("draws EVERY geom place in the list -- not just the selected/last one", () => {
    const hash = hashFromPlaces([ZONE, SQUARE, TRIANGLE]);
    const result = allGeomPlacesOutline(hash);
    expect(result?.features.map((f) => f.geometry)).toEqual([
      densifyGeometry(SQUARE.geometry),
      densifyGeometry(TRIANGLE.geometry),
    ]);
  });

  it("P7 regression: a SECOND drawn place does not drop the first one's outline", () => {
    const first = allGeomPlacesOutline(hashFromPlaces([SQUARE]));
    const both = allGeomPlacesOutline(hashFromPlaces([SQUARE, TRIANGLE]));
    expect(first?.features).toHaveLength(1);
    expect(both?.features).toHaveLength(2); // NOT 1 -- SQUARE must still be there
    expect(both?.features[0].geometry).toEqual(densifyGeometry(SQUARE.geometry));
  });

  it("skips zone places -- their highlight is drawn elsewhere, and uploads carry no geometry", () => {
    expect(allGeomPlacesOutline(hashFromPlaces([ZONE]))).toBeNull();
  });

  it("is null with no places at all", () => {
    expect(allGeomPlacesOutline(undefined)).toBeNull();
    expect(allGeomPlacesOutline("")).toBeNull();
  });
});

// B2: Places footer "Report" dropped every place whose name contains a space (docs/usability.md
// finding B2 -- the assessment saw "Done -- 1 place" out of three: only the space-free name
// survived). `reportHash` is the one encoder both the footer's "Report" (`onReport`) and each
// row's "Open in report" link (`reportHref`) build the `#pl=`/`#t=` hash through; this proves it
// round-trips through report.html's OWN parser (`parseSel`, lib/state/codec.ts), not a hand-rolled
// stand-in.
describe("reportHash", () => {
  const drawn: GeomPlace = { kind: "geom", name: "Drawn place 1", geometry: SQUARE.geometry };
  const coords: GeomPlace = { kind: "geom", name: "Coordinates entry", geometry: SQUARE.geometry };
  const upload: GeomPlace = { kind: "geom", name: "upload-test", geometry: SQUARE.geometry };
  const three: Place[] = [drawn, coords, upload];

  it("round-trips all three places -- including names with spaces -- through report.html's parser", () => {
    const pl = hashFromPlaces(three);
    const hash = reportHash(pl, undefined);
    const decoded = parseSel({ search: "", hash });
    const places = placesFromHash(decoded.pl);
    expect(places).toHaveLength(3);
    expect(places.map((p) => (p as GeomPlace).name)).toEqual([
      "Drawn place 1",
      "Coordinates entry",
      "upload-test",
    ]);
  });

  it("carries an optional per-row `sel` token without disturbing `pl`", () => {
    const pl = hashFromPlaces(three);
    const hash = reportHash(pl, undefined, "place:0");
    expect(hash).toContain("sel=place%3A0");
    const decoded = parseSel({ search: "", hash });
    expect(placesFromHash(decoded.pl)).toHaveLength(3);
  });

  it("is empty when there is nothing to carry", () => {
    expect(reportHash(undefined, undefined)).toBe("");
  });

  it(
    "regression: the pre-fix `#pl=${pl}` splice (zero layers of percent-encoding) loses a place " +
      "once report.html's parser (one layer of decoding) reads it back",
    () => {
      const pl = hashFromPlaces(three);
      const oldStyleHash = `#pl=${pl}`;
      const decoded = parseSel({ search: "", hash: oldStyleHash });
      const places = placesFromHash(decoded.pl);
      expect(places.length).toBeLessThan(3);
    },
  );
});

describe("addGazPlace: an id that cannot be carried in a link is refused (a search hit)", () => {
  it("a place_id over the p. token's 120 encoded characters is refused, never added", async () => {
    const { addGazPlace } = await import("../../src/places/model");
    const long = `ONMS:${"a-very-long-section-name-".repeat(6)}`;
    const r = addGazPlace([], long, "Long one");
    expect(r.ok).toBe(false);
    expect(r.places).toEqual([]);
    expect(r.reason).toMatch(/too long/);
  });
  it("an ordinary id still adds", async () => {
    const { addGazPlace } = await import("../../src/places/model");
    expect(addGazPlace([], "NMS:CINMS", "Channel Islands").ok).toBe(true);
  });
});
