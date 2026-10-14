// WP11 item 4: the raster SOURCE's bounds come from the COG's own `/cog/info` footprint (read once per
// COG), so a regional COG is never asked for tiles outside it. The camera's narrowing (bounds.test.ts)
// is a separate question and is untouched.
import { describe, expect, it } from "vitest";
import {
  MERCATOR_MAX_LAT,
  createCogExtentCache,
  sourceBoundsOf,
  titilerInfoGeoJsonUrl,
} from "../../src/lib/raster/bounds";
import { DEFAULT_TITILER_CONFIG } from "../../src/lib/raster/tiles";

const COG = "https://file.marinesensitivity.org/cog/sdm/raw/nc_atl_birds_dens/ARTE_summer.tif";
// the real /cog/info.geojson answer for that COG: a regional WGS84 bbox (the US Atlantic coast), with
// the COG's own-CRS `bounds` in METRES alongside it (Oblique Mercator), which must never be used
const ATLANTIC = {
  bbox: [-87.02, 23.07, -52.27, 53.3],
  properties: { bounds: [-820443.17, -1234728.48, 1579556.83, 2045271.52] },
};

describe("sourceBoundsOf: /cog/info bounds -> MapLibre source bounds", () => {
  it("a regional footprint passes through unchanged", () => {
    expect(sourceBoundsOf(ATLANTIC)).toEqual([-87.02, 23.07, -52.27, 53.3]);
  });
  it("latitudes are clamped to the mercator limit, longitudes to [-180, 180]", () => {
    expect(sourceBoundsOf({ bbox: [-181, -90, 181, 90] })).toEqual([
      -180,
      -MERCATOR_MAX_LAT,
      180,
      MERCATOR_MAX_LAT,
    ]);
  });
  it("REGRESSION: /cog/info's own-CRS `bounds` (metres) are never read as degrees", () => {
    expect(
      sourceBoundsOf({ bounds: [-820443.17, -1234728.48, 1579556.83, 2045271.52] }),
    ).toBeNull();
    expect(sourceBoundsOf(ATLANTIC)).toEqual([-87.02, 23.07, -52.27, 53.3]);
  });
  it("a degenerate or malformed footprint is no bound at all, never a wrong one", () => {
    expect(sourceBoundsOf({ bbox: [10, 0, 10, 5] })).toBeNull(); // zero width
    expect(sourceBoundsOf({ bbox: [10, 5, 20, 5] })).toBeNull(); // zero height
    expect(sourceBoundsOf({ bbox: [170, 0, -170, 5] })).toBeNull(); // wrapped: MapLibre cannot use it
    expect(sourceBoundsOf({ bbox: [1, 2, 3] })).toBeNull();
    expect(sourceBoundsOf({ bbox: [1, 2, 3, "x"] })).toBeNull();
    expect(sourceBoundsOf({})).toBeNull();
    expect(sourceBoundsOf(null)).toBeNull();
  });
  it("a whole-globe-width footprint is kept whole (the raw footprint, never narrowed)", () => {
    expect(sourceBoundsOf({ bbox: [-180, 53.15, 180, 73.75] })).toEqual([-180, 53.15, 180, 73.75]);
  });
});

describe("createCogExtentCache: one /cog/info per COG", () => {
  it("reads once, serves the cache, and shares an in-flight read between two callers", async () => {
    const urls: string[] = [];
    const cache = createCogExtentCache(async (url) => {
      urls.push(url);
      return ATLANTIC;
    });
    const [a, b] = await Promise.all([cache.get(COG), cache.get(COG)]);
    expect(a).toEqual([-87.02, 23.07, -52.27, 53.3]);
    expect(b).toEqual(a);
    await cache.get(COG);
    expect(urls).toEqual([titilerInfoGeoJsonUrl(DEFAULT_TITILER_CONFIG, COG)]);
    expect(cache.requests).toBe(1);
    expect(cache.size).toBe(1);
  });
  it("another COG is another read", async () => {
    const cache = createCogExtentCache(async () => ATLANTIC);
    await cache.get(COG);
    await cache.get(COG.replace("ARTE", "BLKI"));
    expect(cache.requests).toBe(2);
  });
  it("a failure is null and is retried next time (not cached)", async () => {
    let calls = 0;
    const cache = createCogExtentCache(async () => {
      calls++;
      if (calls === 1) throw new Error("HTTP 500");
      return ATLANTIC;
    });
    expect(await cache.get(COG)).toBeNull();
    expect(await cache.get(COG)).toEqual([-87.02, 23.07, -52.27, 53.3]);
    expect(cache.size).toBe(1);
  });
});
