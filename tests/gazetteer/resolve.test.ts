// the lazy half of the `p.` token: fetch a place by id from collection parquet (the REAL
// @oceanmetrics/places client against committed fixtures over local HTTP), and what happens when the gazetteer is
// unreachable. Fixture places (see tests/fixtures/gazetteer): FX:A-1 (a plain polygon at -124..-123),
// FX:PM (a MultiPolygon cut at +/-180: 170..180, -180..-170 and a detached -165..-164 part),
// AOA:N1 (a different collection, found through layers.json).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GazetteerError,
  creditsForPlaces,
  loadPickLayers,
  resolveGazPlace,
  type GazetteerClient,
} from "../../src/lib/gazetteer/resolve";
import { createClient } from "@oceanmetrics/places";
import { analysisGeometry } from "../../src/lib/geo/analysisGeometry";
import { isUnwrapped } from "../../src/lib/geo/unwrap";
import { bboxOf, type AreaGeometry } from "../../src/lib/geo/types";
import { serveFixtures } from "./server";

let srv: Awaited<ReturnType<typeof serveFixtures>>;
let client: GazetteerClient;
beforeAll(async () => {
  srv = await serveFixtures();
  client = createClient({ base: srv.base });
});
afterAll(() => srv.close());

describe("resolveGazPlace", () => {
  it("fetches a place by id and returns its analysis geometry and name", async () => {
    const r = await resolveGazPlace("FX:A-1", client);
    expect(r.id).toBe("FX:A-1");
    expect(r.name).toBe("Alpha lease");
    expect(bboxOf(r.geometry)).toEqual([-124, 33, -123, 34]);
  });

  it("finds a place in a collection other than the first through layers.json", async () => {
    const r = await resolveGazPlace("AOA:N1", client);
    expect(r.name).toBe("Northern aquaculture area");
    expect(bboxOf(r.geometry)).toEqual([-123, 36, -122, 37]);
  });

  it("UNWRAPS an antimeridian-split place: contiguous longitudes past 180, no wrapped ring", async () => {
    const r = await resolveGazPlace("FX:PM", client);
    const [x0, , x1] = bboxOf(r.geometry);
    // 170..180 stays, -180..-170 becomes 180..190, and the detached -165..-164 part 195..196
    expect(x0).toBe(170);
    expect(x1).toBe(196);
    expect(isUnwrapped(r.geometry)).toBe(true);
  });

  it("is already the geometry analyses run on: analysisGeometry() of it is a fixed point", async () => {
    const r = await resolveGazPlace("FX:PM", client);
    expect(analysisGeometry(r.geometry)).toEqual(r.geometry);
  });

  it("an id nobody has is a not-found error naming the id", async () => {
    const err = await resolveGazPlace("FX:NOPE", client).catch((e) => e);
    expect(err).toBeInstanceOf(GazetteerError);
    expect(err.code).toBe("not-found");
    expect(err.message).toContain("FX:NOPE");
  });

  it("an unreachable gazetteer is an 'unreachable' error with a sentence for the user", async () => {
    const down = createClient({ base: "http://127.0.0.1:1/" });
    const err = await resolveGazPlace("FX:A-1", down).catch((e) => e);
    expect(err).toBeInstanceOf(GazetteerError);
    expect(err.code).toBe("unreachable");
    expect(err.message).toMatch(/Couldn't reach the places gazetteer/);
  });

  it("a non-area feature is refused rather than analysed", async () => {
    const stub: GazetteerClient = {
      ...client,
      getPlace: async (id) => ({
        type: "Feature",
        id,
        properties: { name: "A point" },
        geometry: { type: "Point", coordinates: [1, 2] },
      }),
    };
    const err = await resolveGazPlace("X:1", stub).catch((e) => e);
    expect(err.code).toBe("not-area");
  });

  it("falls back to the id as the name when the collection carries none", async () => {
    const stub: GazetteerClient = {
      ...client,
      getPlace: async (id) => ({
        type: "Feature",
        id,
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        } as AreaGeometry,
      }),
    };
    expect((await resolveGazPlace("X:2", stub)).name).toBe("X:2");
  });
});

describe("the built-in `places` authorities do not need layers.json", () => {
  it("NMS:/MRGID:/PSGID: ids are read from the `places` collection directly (slug hint)", async () => {
    const calls: unknown[] = [];
    const stub: GazetteerClient = {
      ...client,
      getPlace: async (id, opts) => {
        calls.push(opts);
        return {
          type: "Feature",
          id,
          properties: { name: "Sanctuary" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-120, 33],
                [-119, 33],
                [-119, 34],
                [-120, 33],
              ],
            ],
          },
        };
      },
    };
    await resolveGazPlace("NMS:CINMS", stub);
    expect(calls).toEqual([{ unwrap: true, slug: "places" }]);
    calls.length = 0;
    await resolveGazPlace("BOEM:OCS-P 0562", stub);
    expect(calls).toEqual([{ unwrap: true }]); // everything else goes through the manifest
  });

  it("falls back to the manifest lookup when the hinted collection does not hold the id", async () => {
    const calls: unknown[] = [];
    const stub: GazetteerClient = {
      ...client,
      getPlace: async (_id, opts) => {
        calls.push(opts);
        return opts?.slug ? null : await client.getPlace("FX:A-1", opts); // second call finds it
      },
    };
    const r = await resolveGazPlace("NMS:MOVED", stub);
    expect(r.name).toBe("Alpha lease");
    expect(calls).toEqual([{ unwrap: true, slug: "places" }, { unwrap: true }]);
  });
});

describe("loadPickLayers (layers.json)", () => {
  it("lists polygon layers with their credit", async () => {
    const layers = await loadPickLayers(client);
    expect(layers?.map((l) => l.slug)).toEqual(expect.arrayContaining(["fx_leases", "fx_aoa"]));
    const leases = layers!.find((l) => l.slug === "fx_leases")!;
    expect(leases.sourceLayer).toBe("fx_leases");
    expect(leases.attribution).toBe(
      "Fixture Agency, via MarineCadastre. Processed by Ocean Metrics.",
    );
  });

  it("re-bases the published storage.oceanmetrics.io PMTiles URL onto the data base", async () => {
    const layers = await loadPickLayers(client);
    const leases = layers!.find((l) => l.slug === "fx_leases")!;
    // the manifest says https://storage.oceanmetrics.io/gazetteer/...; the Range-safe base is used
    expect(leases.pmtiles).toBe(
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/fx_leases/places.pmtiles",
    );
  });

  it("an unpublished manifest (403/404) degrades to null, never a throw", async () => {
    const missing = createClient({ base: srv.base + "missing/" });
    expect(await loadPickLayers(missing)).toBeNull();
  });

  it("client 0.5.1: an unlisted layer and a raster layer (no PMTiles of ours) are not offered", async () => {
    const manifest = {
      layers: [
        {
          slug: "fx_pub",
          title: "Public",
          geom_type: "MultiPolygon",
          pmtiles: "https://storage.oceanmetrics.io/gazetteer/fx_pub/places.pmtiles",
          source_layer: "fx_pub",
          attribution: "Pub.",
          access: "public",
        },
        {
          slug: "fx_hidden",
          title: "Hidden",
          geom_type: "MultiPolygon",
          pmtiles: "https://storage.oceanmetrics.io/gazetteer/fx_hidden/places.pmtiles",
          source_layer: "fx_hidden",
          attribution: "Hidden.",
          access: "unlisted",
        },
        {
          slug: "fx_raster",
          title: "Raster",
          kind: "raster",
          geom_type: "Polygon",
          pmtiles: null,
          source_layer: null,
          attribution: "",
          access: "public",
        },
      ],
    };
    const fetchStub = (async () =>
      new Response(JSON.stringify(manifest), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const stubbed = createClient({ base: srv.base, fetch: fetchStub });
    expect((await loadPickLayers(stubbed))?.map((l) => l.slug)).toEqual(["fx_pub"]);
  });
});

describe("creditsForPlaces", () => {
  it("uses each place's own credit from the index, deduplicated, 'Processed by' once", async () => {
    const line = await creditsForPlaces(["FX:A-1", "AOA:N1", "FX:B-2"], client);
    expect(line).toBe(
      "Fixture Agency, via MarineCadastre; NOAA AOA program. Processed by Ocean Metrics.",
    );
  });

  it("falls back to the built-in credit when the index cannot be read", async () => {
    const down = createClient({ base: srv.base + "missing/" });
    const line = await creditsForPlaces(["NMS:CINMS"], down);
    expect(line).toContain("National Marine Sanctuaries");
    expect(line).toContain("Processed by Ocean Metrics.");
  });

  it("no ids, no credit", async () => {
    expect(await creditsForPlaces([], client)).toBe("");
  });
});

// WP4: searching the places index (`search()` of the @oceanmetrics/places client) for areas to add by reference
describe("searchGazetteer: areas from the index, one per place_id", () => {
  const hit = (over: Record<string, unknown>) => ({
    place_id: "A:1",
    name: "Alpha",
    authority: "A",
    place_type: "lease",
    geom_type: "MultiPolygon",
    collection: "wind",
    bbox: [0, 0, 1, 1],
    centroid: [0.5, 0.5],
    area_km2: 12,
    license: null,
    attribution: "Credit.",
    version: null,
    updated: null,
    ...over,
  });
  const searcher = (rows: ReturnType<typeof hit>[]) => ({
    search: async () => rows as never,
  });

  it("points and lines are left out (a place is an area); an id in two collections is listed once", async () => {
    const { searchGazetteer } = await import("../../src/lib/gazetteer/resolve");
    const out = await searchGazetteer(
      "alpha",
      {},
      searcher([
        hit({}),
        hit({ place_id: "P:1", geom_type: "Point", name: "Pt" }),
        hit({ place_id: "L:1", geom_type: "MultiLineString", name: "Ln" }),
        hit({ collection: "pacific" }), // the same A:1, another collection
        hit({ place_id: "B:2", name: "Beta", geom_type: "Polygon" }),
        hit({ place_id: "N:1", name: "No type", geom_type: null }),
      ]),
    );
    expect(out.map((h) => [h.id, h.collection])).toEqual([
      ["A:1", "wind"],
      ["B:2", "wind"],
      ["N:1", "wind"],
    ]);
    expect(out[0]).toMatchObject({ name: "Alpha", areaKm2: 12, attribution: "Credit." });
  });

  it("an id too long for a p. token is dropped, and the limit applies after the filtering", async () => {
    const { searchGazetteer } = await import("../../src/lib/gazetteer/resolve");
    const rows = [
      hit({ place_id: `X:${"y".repeat(130)}` }),
      ...Array.from({ length: 5 }, (_, i) => hit({ place_id: `Z:${i}`, name: `Z${i}` })),
    ];
    const out = await searchGazetteer("z", { limit: 3 }, searcher(rows));
    expect(out.map((h) => h.id)).toEqual(["Z:0", "Z:1", "Z:2"]);
  });
});
