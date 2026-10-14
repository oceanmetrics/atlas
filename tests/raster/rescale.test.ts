import { describe, expect, it } from "vitest";
import {
  createRescaleCache,
  parseRescale,
  titilerBandStatisticsUrl,
} from "../../src/lib/raster/rescale";
import { titilerTileUrl } from "../../src/lib/raster/tiles";

const HOST = { host: "https://t.test" };
// the real shape (titiler /cog/statistics of nc ARTE_summer band 1)
const STATS = { b1: { min: 0.00036, max: 0.81075, percentile_2: 0.00038, percentile_98: 0.0079 } };

describe("parseRescale: [min, 98th percentile] of the band", () => {
  it("clips a right-skewed density at its 98th percentile", () => {
    expect(parseRescale(STATS)).toEqual([0.00036, 0.0079]);
  });
  it("reads whichever band key the response names", () => {
    expect(parseRescale({ b3: STATS.b1 })).toEqual([0.00036, 0.0079]);
  });
  it("falls back to [min, max] when the percentile is not above the minimum", () => {
    expect(parseRescale({ b1: { min: 5, max: 9, percentile_98: 5 } })).toEqual([5, 9]);
  });
  it("widens a constant band so the ramp has a span", () => {
    expect(parseRescale({ b1: { min: 4, max: 4, percentile_98: 4 } })).toEqual([4, 5]);
  });
  it("is null for anything that is not statistics", () => {
    expect(parseRescale(null)).toBeNull();
    expect(parseRescale({ detail: "nope" })).toBeNull();
    expect(parseRescale({ b1: { min: "a", max: 1 } })).toBeNull();
  });
});

describe("the statistics url", () => {
  it("encodes the cog url like every titiler url and names the band", () => {
    expect(titilerBandStatisticsUrl(HOST, "https://f.test/a b.tif", 2)).toBe(
      "https://t.test/cog/statistics?url=https%3A%2F%2Ff.test%2Fa%20b.tif&bidx=2",
    );
  });
});

describe("createRescaleCache", () => {
  it("reads each band once (and shares an in-flight read between two callers)", async () => {
    const calls: string[] = [];
    const cache = createRescaleCache(async (u) => {
      calls.push(u);
      return STATS;
    }, HOST);
    const [a, b] = await Promise.all([
      cache.get("https://f.test/a.tif", 1),
      cache.get("https://f.test/a.tif", 1),
    ]);
    expect(a).toEqual([0.00036, 0.0079]);
    expect(b).toEqual(a);
    await cache.get("https://f.test/a.tif", 1);
    expect(calls).toHaveLength(1);
    await cache.get("https://f.test/a.tif", 2); // another band is another read
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(2);
  });
  it("never caches a failure: the next ask retries", async () => {
    let n = 0;
    const cache = createRescaleCache(async () => {
      if (++n === 1) throw new Error("down");
      return STATS;
    }, HOST);
    expect(await cache.get("u", 1)).toBeNull();
    expect(cache.size).toBe(0);
    expect(await cache.get("u", 1)).toEqual([0.00036, 0.0079]);
    expect(n).toBe(2);
  });
  it("an unreadable body is null and not cached", async () => {
    const cache = createRescaleCache(async () => ({ detail: "x" }), HOST);
    expect(await cache.get("u", 1)).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe("titilerTileUrl bidx", () => {
  const base = {
    url: "https://f.test/a.tif",
    colormapName: "spectral_r",
    rescaleMin: 1,
    rescaleMax: 100,
  };
  it("regression: without a band the URL is byte-identical to the cached single-band ones", () => {
    expect(titilerTileUrl(HOST, 1, 2, 3, base)).toBe(
      "https://t.test/cog/tiles/WebMercatorQuad/1/2/3.png?url=https%3A%2F%2Ff.test%2Fa.tif&colormap_name=spectral_r&rescale=1,100",
    );
  });
  it("a band is appended after rescale", () => {
    expect(titilerTileUrl(HOST, 1, 2, 3, { ...base, bidx: 2 })).toMatch(/&rescale=1,100&bidx=2$/);
  });
});
