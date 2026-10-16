import { describe, expect, it } from "vitest";
import {
  assertSpeciesValueRequest,
  createTitilerValueSource,
  titilerPointUrl,
  type ValueRequest,
} from "../../src/lib/raster/point";
import { DEFAULT_TITILER_CONFIG, DEFAULT_TITILER_HOST } from "../../src/lib/raster/tiles";

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/x.tif";

describe("assertSpeciesValueRequest (runtime guard: /cog/point serves species values ONLY)", () => {
  it("passes silently for domain: 'species'", () => {
    expect(() => assertSpeciesValueRequest({ domain: "species" })).not.toThrow();
  });

  // seeded fault: a scores value requested through /cog/point. Scores values must come from
  // Parquet (engine/ + sql/), never a raster pixel (plan D4) — a request built from untyped data
  // (bypassing the ValueRequest["domain"] type) must still be rejected at runtime.
  it("seeded fault: throws for domain: 'scores' even though the type only admits 'species'", () => {
    const untyped = { domain: "scores" } as unknown as { domain: string };
    expect(() => assertSpeciesValueRequest(untyped)).toThrow(/species values/i);
  });

  it("throws for any other unexpected domain string", () => {
    expect(() => assertSpeciesValueRequest({ domain: "zones" })).toThrow();
  });
});

describe("titilerPointUrl", () => {
  it("builds {host}/cog/point/{lon},{lat}?url=<enc>", () => {
    const url = titilerPointUrl(DEFAULT_TITILER_CONFIG, -122.5, 37.8, COG_URL);
    expect(url).toBe(
      `${DEFAULT_TITILER_HOST}/cog/point/-122.5,37.8?url=${encodeURIComponent(COG_URL)}`,
    );
  });
});

describe("createTitilerValueSource", () => {
  it("resolves the first value from {values:[...]} — no network call, fetchJson injected", async () => {
    const requested: string[] = [];
    const source = createTitilerValueSource(async (url) => {
      requested.push(url);
      return { values: [42.5, 99] };
    });
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBe(42.5);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/cog/point/1,2?url=");
  });

  it("resolves null when the fetch throws (matches cog_point_value()'s NA-on-failure contract)", async () => {
    const source = createTitilerValueSource(async () => {
      throw new Error("network down");
    });
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBeNull();
  });

  it("resolves null when the response has no usable values array", async () => {
    const source = createTitilerValueSource(async () => ({}));
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBeNull();
  });

  it("rejects a scores-domain request before ever calling fetchJson (seeded fault)", async () => {
    let called = false;
    const source = createTitilerValueSource(async () => {
      called = true;
      return { values: [1] };
    });
    const badReq = { domain: "scores", lon: 1, lat: 2, cogUrl: COG_URL } as unknown as ValueRequest;
    await expect(source.pointValue(badReq)).rejects.toThrow(/species values/i);
    expect(called).toBe(false);
  });
});

describe("WP14: a Collections raster item's value (domain collection, band)", () => {
  it("the point URL carries bidx after the url, and none for band-less callers", () => {
    expect(titilerPointUrl(DEFAULT_TITILER_CONFIG, -70.3, 42.3, COG_URL, 2)).toBe(
      `${DEFAULT_TITILER_HOST}/cog/point/-70.3,42.3?url=${encodeURIComponent(COG_URL)}&bidx=2`,
    );
    expect(titilerPointUrl(DEFAULT_TITILER_CONFIG, 1, 2, COG_URL)).not.toContain("bidx");
  });
  it("the collection domain is served, with the band and the abort signal handed to the transport", async () => {
    const seen: { url: string; signal?: AbortSignal }[] = [];
    const source = createTitilerValueSource(async (url, signal) => {
      seen.push({ url, signal });
      return { values: [0.34] };
    });
    const ctrl = new AbortController();
    const v = await source.pointValue({
      domain: "collection",
      lon: -70.3,
      lat: 42.3,
      cogUrl: COG_URL,
      bidx: 2,
      signal: ctrl.signal,
    });
    expect(v).toBe(0.34);
    expect(seen[0].url).toContain("&bidx=2");
    expect(seen[0].signal).toBe(ctrl.signal);
  });
  it("a masked (nodata) pixel answers values [null]: null, shown as no data", async () => {
    const source = createTitilerValueSource(async () => ({ values: [null] }));
    await expect(
      source.pointValue({ domain: "collection", lon: 0, lat: 0, cogUrl: COG_URL }),
    ).resolves.toBeNull();
  });
});

describe("pointValues: every band of the COG from ONE /cog/point request", () => {
  const req: ValueRequest = { domain: "collection", lon: 1, lat: 2, cogUrl: COG_URL, bidx: 3 };
  it("returns the full values array and band_names, and never sends bidx", async () => {
    const seen: string[] = [];
    const source = createTitilerValueSource(async (url) => {
      seen.push(url);
      return { values: [50, 40, null, 12.5], band_names: ["b1", "b2", "b3", "b4"] };
    });
    const got = await source.pointValues(req);
    expect(got).toEqual({ values: [50, 40, null, 12.5], bandNames: ["b1", "b2", "b3", "b4"] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("bidx");
  });
  it("omits bandNames when titiler names none; non-finite entries become null", async () => {
    const source = createTitilerValueSource(async () => ({ values: [1, "x", NaN, 255] }));
    expect(await source.pointValues(req)).toEqual({ values: [1, null, null, 255] });
  });
  it("null for a failed read or a response with no values array", async () => {
    const failing = createTitilerValueSource(async () => {
      throw new Error("down");
    });
    expect(await failing.pointValues(req)).toBeNull();
    expect(await createTitilerValueSource(async () => ({})).pointValues(req)).toBeNull();
  });
  it("keeps the values[0] behaviour of pointValue unchanged on the same response", async () => {
    const source = createTitilerValueSource(async () => ({ values: [7, 8, 9] }));
    expect(await source.pointValue(req)).toBe(7);
  });
  it("is guarded like pointValue: a scores-domain request throws before any fetch", async () => {
    let called = false;
    const source = createTitilerValueSource(async () => {
      called = true;
      return { values: [1] };
    });
    const bad = { ...req, domain: "scores" } as unknown as ValueRequest;
    await expect(source.pointValues(bad)).rejects.toThrow(/species values/i);
    expect(called).toBe(false);
  });
});
