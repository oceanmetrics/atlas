// Ben's ask (round-3 review): the popup sparkline's species source -- titiler's `/cog/statistics`,
// the "second sanctioned tile-server read" (plan D4) alongside `raster/point.ts`'s `/cog/point`.
import { describe, expect, it } from "vitest";
import {
  assertHistogramRequest,
  createTitilerHistogramSource,
  parseTitilerStatistics,
  titilerStatisticsUrl,
} from "../../src/lib/raster/histogram";
import { DEFAULT_TITILER_CONFIG } from "../../src/lib/raster/tiles";

describe("assertHistogramRequest", () => {
  it("passes for the species and scores (Raster cells) domains", () => {
    expect(() => assertHistogramRequest({ domain: "species" })).not.toThrow();
    expect(() => assertHistogramRequest({ domain: "scores" })).not.toThrow();
  });

  it("throws for any other domain -- Program-area distributions never read a tile endpoint", () => {
    expect(() => assertHistogramRequest({ domain: "zones" })).toThrow(/plan D4/);
  });
});

describe("titilerStatisticsUrl", () => {
  it("builds the /cog/statistics URL with the encoded cog url and bin count", () => {
    const url = titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 20);
    expect(url).toContain("/cog/statistics?url=");
    expect(url).toContain("histogram_bins=20");
    expect(url).toContain(encodeURIComponent("https://x/y.tif"));
  });
});

describe("histogram_range (R4-A: bins line up with the legend ramp)", () => {
  it("is appended to the URL when a range is given, omitted otherwise", () => {
    const withRange = titilerStatisticsUrl(
      DEFAULT_TITILER_CONFIG,
      "https://x/y.tif",
      40,
      [0, 55.5],
    );
    expect(withRange).toContain("&histogram_range=0,55.5");
    expect(titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 40)).not.toContain(
      "histogram_range",
    );
  });

  it("the parsed min/max are the bin EDGES (the requested range), not the band's own min/max", () => {
    const raw = {
      b1: {
        min: 3,
        max: 90,
        histogram: [
          [5, 10],
          [0, 50, 100],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({ binCount: 2, counts: [5, 10], min: 0, max: 100 });
  });

  it("the source sends the range and serves the scores domain", async () => {
    let seen = "";
    const source = createTitilerHistogramSource(async (url) => {
      seen = url;
      return { b1: { min: 0, max: 1, histogram: [[1], [0, 1]] } };
    });
    const h = await source.histogram({
      domain: "scores",
      cogUrl: "https://x/y.tif",
      bins: 40,
      range: [0, 80],
    });
    expect(seen).toContain("histogram_range=0,80");
    expect(h?.binCount).toBe(1);
  });
});

describe("parseTitilerStatistics", () => {
  it("a well-formed b1 histogram parses to a Histogram", () => {
    const raw = {
      b1: {
        min: 1,
        max: 100,
        histogram: [
          [5, 10, 3],
          [1, 34, 67, 100],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({
      binCount: 3,
      counts: [5, 10, 3],
      min: 1,
      max: 100,
    });
  });

  it("null/non-object input returns null, never a throw", () => {
    expect(parseTitilerStatistics(null)).toBeNull();
    expect(parseTitilerStatistics(undefined)).toBeNull();
    expect(parseTitilerStatistics("not an object")).toBeNull();
  });

  it("a missing min/max or histogram shape returns null", () => {
    expect(parseTitilerStatistics({ b1: { histogram: [[1, 2]] } })).toBeNull();
    expect(parseTitilerStatistics({ b1: { min: 0, max: 1 } })).toBeNull();
    expect(parseTitilerStatistics({ b1: { min: 0, max: 1, histogram: "nope" } })).toBeNull();
  });

  it("an empty band object returns null", () => {
    expect(parseTitilerStatistics({})).toBeNull();
  });
});

describe("createTitilerHistogramSource", () => {
  it("fetches and parses -- happy path", async () => {
    const source = createTitilerHistogramSource(async () => ({
      b1: {
        min: 0,
        max: 10,
        histogram: [
          [1, 2, 3],
          [0, 3, 7, 10],
        ],
      },
    }));
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toEqual({ binCount: 3, counts: [1, 2, 3], min: 0, max: 10 });
  });

  it("a network failure resolves to null, never a throw -- the sparkline just does not render", async () => {
    const source = createTitilerHistogramSource(async () => {
      throw new Error("network down");
    });
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toBeNull();
  });

  it("an unavailable endpoint's malformed JSON body resolves to null too", async () => {
    const source = createTitilerHistogramSource(async () => ({ detail: "Not Found" }));
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toBeNull();
  });

  it("refuses an unknown domain before ever fetching", async () => {
    let fetched = false;
    const source = createTitilerHistogramSource(async () => {
      fetched = true;
      return {};
    });
    await expect(
      source.histogram({ domain: "zones" as never, cogUrl: "https://x/y.tif" }),
    ).rejects.toThrow(/plan D4/);
    expect(fetched).toBe(false);
  });
});

// --- WP14: Collections raster items --------------------------------------------------------------
import {
  createHistogramCache,
  rasterHistogramKey,
  type HistogramRequest,
  type HistogramSource,
} from "../../src/lib/raster/histogram";
import type { Histogram } from "../../src/lib/map/density";

describe("titiler histogram -> Histogram for a Collections COG item (WP14)", () => {
  it("bins and edges: the bars span the REQUESTED range, one count per bin, nodata excluded by titiler", () => {
    const raw = {
      b1: {
        min: 1,
        max: 100,
        histogram: [
          [3, 0, 7, 2],
          [1, 25.75, 50.5, 75.25, 100],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({
      binCount: 4,
      counts: [3, 0, 7, 2],
      min: 1,
      max: 100,
    });
  });
  it("names the band bN when asked for one: the first band object is read, whatever its key", () => {
    const raw = {
      b2: {
        min: 0,
        max: 1,
        histogram: [
          [4, 6],
          [0, 0.5, 1],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({ binCount: 2, counts: [4, 6], min: 0, max: 1 });
  });
  it("empty: no counted pixel in the range (all zero counts, or no counts) is no histogram", () => {
    expect(
      parseTitilerStatistics({
        b1: {
          min: 0,
          max: 1,
          histogram: [
            [0, 0, 0],
            [0, 1, 2, 3],
          ],
        },
      }),
    ).toBeNull();
    expect(parseTitilerStatistics({ b1: { min: 0, max: 1, histogram: [[], []] } })).toBeNull();
  });
  it("failure: the source resolves null for a throw and for an error body, never an error state", async () => {
    const down = createTitilerHistogramSource(async () => {
      throw new Error("HTTP 500");
    });
    const req: HistogramRequest = { domain: "collection", cogUrl: "https://x/y.tif", bins: 40 };
    await expect(down.histogram(req)).resolves.toBeNull();
    const bad = createTitilerHistogramSource(async () => ({ detail: "nope" }));
    await expect(bad.histogram(req)).resolves.toBeNull();
  });
  it("the URL carries bidx after the range, and the collection domain is allowed", async () => {
    const url = titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 40, [1, 100], 2);
    expect(url).toMatch(/histogram_bins=40&histogram_range=1,100&bidx=2$/);
    expect(titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 40)).not.toContain(
      "bidx",
    );
    expect(() => assertHistogramRequest({ domain: "collection" })).not.toThrow();
    let seen = "";
    const source = createTitilerHistogramSource(async (u) => {
      seen = u;
      return { b2: { min: 0, max: 1, histogram: [[1], [0, 1]] } };
    });
    await source.histogram({ domain: "collection", cogUrl: "https://x/y.tif", bins: 40, bidx: 2 });
    expect(seen).toContain("&bidx=2");
  });
});

describe("the whole-layer histogram cache: key = COG + band (+ range, bins) (WP14)", () => {
  const h: Histogram = { binCount: 1, counts: [5], min: 0, max: 1 };
  const counting = (answer: () => Histogram | null) => {
    const seen: HistogramRequest[] = [];
    const source: HistogramSource = {
      async histogram(r) {
        seen.push(r);
        return answer();
      },
    };
    return { seen, cache: createHistogramCache(source) };
  };
  const q = (bidx: number | null) => ({
    cogUrl: "https://x/y.tif",
    bidx,
    range: [0, 1] as const,
    bins: 40,
  });

  it("the key separates bands of one COG and ranges of one band, and reads no bidx as band 1", () => {
    const k = (b: number | null, r: [number, number] = [0, 1]) =>
      rasterHistogramKey("https://x/y.tif", b, r, 40);
    expect(k(1)).not.toBe(k(2));
    expect(k(1)).toBe(k(null));
    expect(k(1)).not.toBe(k(1, [0, 2]));
  });
  it("one request per (COG, band): a second ask is a hit, a second band is its own request", async () => {
    const { seen, cache } = counting(() => h);
    await cache.get(q(1));
    await cache.get(q(1));
    expect(seen).toHaveLength(1);
    await cache.get(q(2));
    expect(seen.map((r) => r.bidx)).toEqual([1, 2]);
    expect(cache.size).toBe(2);
  });
  it("a request in flight is shared; the request is for the collection domain", async () => {
    const { seen, cache } = counting(() => h);
    await Promise.all([cache.get(q(1)), cache.get(q(1))]);
    expect(seen).toHaveLength(1);
    expect(seen[0].domain).toBe("collection");
    expect(seen[0].bins).toBe(40);
  });
  it("a failure is null, is not cached, and is retried on the next ask", async () => {
    let ok = false;
    const { seen, cache } = counting(() => (ok ? h : null));
    await expect(cache.get(q(1))).resolves.toBeNull();
    expect(cache.size).toBe(0);
    ok = true;
    await expect(cache.get(q(1))).resolves.toEqual(h);
    expect(seen).toHaveLength(2);
  });
  it("a source that throws is a null, never a throw", async () => {
    const cache = createHistogramCache({
      async histogram() {
        throw new Error("boom");
      },
    });
    await expect(cache.get(q(1))).resolves.toBeNull();
  });
});
