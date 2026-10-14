import { describe, expect, it } from "vitest";
import {
  createTitilerStatisticsSource,
  parseStatistics,
  titilerStatisticsUrl,
  wrapForRaster,
} from "../../src/lib/raster/statistics";
import type { AreaGeometry } from "../../src/lib/geo/types";

const HOST = { host: "https://t.example" };
const box = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

const TITILER_ANSWER = {
  type: "Feature",
  properties: {
    statistics: {
      b1: { min: 0.1, max: 0.9, mean: 0.5, count: 30, valid_pixels: 30, masked_pixels: 10 },
    },
  },
};

describe("titiler /cog/statistics", () => {
  it("the URL encodes the COG url with every reserved character escaped", () => {
    expect(titilerStatisticsUrl(HOST, "https://b.example/a b/c(1).tif")).toBe(
      "https://t.example/cog/statistics?url=https%3A%2F%2Fb.example%2Fa%20b%2Fc%281%29.tif",
    );
  });
  it("parses count, min, max, mean and the masked share", () => {
    expect(parseStatistics(TITILER_ANSWER)).toEqual({
      count: 30,
      min: 0.1,
      max: 0.9,
      mean: 0.5,
      noValueShare: 0.25,
    });
  });
  it("a polygon over no valid pixel: null statistics, never a number", () => {
    const empty = {
      properties: {
        statistics: {
          b1: { min: null, max: null, mean: null, count: 0, valid_pixels: 0, masked_pixels: 40401 },
        },
      },
    };
    expect(parseStatistics(empty)).toEqual({
      count: 0,
      min: null,
      max: null,
      mean: null,
      noValueShare: 1,
    });
  });
  it("anything else is not statistics", () => {
    expect(parseStatistics({ detail: "nope" })).toBeNull();
    expect(parseStatistics(null)).toBeNull();
  });
  it("the source POSTs a GeoJSON Feature of the place and returns the parsed statistics", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const src = createTitilerStatisticsSource(async (url, body) => {
      calls.push({ url, body });
      return TITILER_ANSWER;
    }, HOST);
    const res = await src.statistics({
      cogUrl: "https://b.example/x.tif",
      geometry: box(0, 0, 1, 1),
    });
    expect(res).toMatchObject({ ok: true, value: { mean: 0.5 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://t.example/cog/statistics?url=https%3A%2F%2Fb.example%2Fx.tif",
    );
    expect(calls[0].body).toMatchObject({ type: "Feature", geometry: { type: "Polygon" } });
  });
  it("a multi-band COG is asked for its band: bidx in the URL, the bN answer parsed (live 2026-10-14)", async () => {
    expect(titilerStatisticsUrl(HOST, "https://b.example/x.tif", 2)).toBe(
      "https://t.example/cog/statistics?url=https%3A%2F%2Fb.example%2Fx.tif&bidx=2",
    );
    const calls: string[] = [];
    const src = createTitilerStatisticsSource(async (url) => {
      calls.push(url);
      return {
        properties: { statistics: { b2: { count: 306.53, min: 0.27, max: 1.35, mean: 0.35 } } },
      };
    }, HOST);
    const res = await src.statistics({
      cogUrl: "https://b.example/x.tif",
      bidx: 2,
      geometry: box(0, 0, 1, 1),
    });
    expect(calls[0]).toMatch(/&bidx=2$/);
    expect(res).toMatchObject({ ok: true, value: { mean: 0.35, min: 0.27 } });
  });
  it("titiler's coverage-weighted count is shown as whole pixels", () => {
    expect(
      parseStatistics({ properties: { statistics: { b1: { count: 622.42, mean: 1 } } } }),
    ).toMatchObject({
      count: 622,
    });
  });
  it("a transport failure (CORS, offline, HTTP 4xx) is a network error, not a throw", async () => {
    const src = createTitilerStatisticsSource(async () => {
      throw new TypeError("Failed to fetch");
    }, HOST);
    const res = await src.statistics({
      cogUrl: "https://b.example/x.tif",
      geometry: box(0, 0, 1, 1),
    });
    expect(res).toMatchObject({
      ok: false,
      error: { kind: "network", message: "Failed to fetch" },
    });
  });
  it("an answer without statistics is a parse error", async () => {
    const src = createTitilerStatisticsSource(async () => ({ ok: 1 }), HOST);
    const res = await src.statistics({
      cogUrl: "https://b.example/x.tif",
      geometry: box(0, 0, 1, 1),
    });
    expect(res).toMatchObject({ ok: false, error: { kind: "parse" } });
  });
});

describe("wrapForRaster: titiler is sent longitudes inside [-180, 180]", () => {
  it("geometry already in range is unchanged", () => {
    expect(wrapForRaster(box(-80, 25, -70, 35))).toEqual(box(-80, 25, -70, 35));
  });
  it("a polygon wholly east of 180 is shifted back by 360", () => {
    expect(wrapForRaster(box(185, 0, 195, 10))).toEqual(box(-175, 0, -165, 10));
  });
  it("a polygon crossing 180 is cut there into an east and a west part", () => {
    const g = wrapForRaster(box(170, 0, 190, 10));
    expect(g.type).toBe("MultiPolygon");
    const xs = (g.coordinates as number[][][][]).map((poly) => poly[0].map((p) => p[0]));
    expect(xs).toHaveLength(2);
    expect(Math.min(...xs[0])).toBe(170);
    expect(Math.max(...xs[0])).toBe(180);
    expect(Math.min(...xs[1])).toBe(-180);
    expect(Math.max(...xs[1])).toBe(-170);
  });
  it("a polygon crossing -180 is mirrored the same way", () => {
    const g = wrapForRaster(box(-190, 0, -170, 10));
    const all = (g.coordinates as number[][][][]).flatMap((poly) => poly[0].map((p) => p[0]));
    expect(Math.min(...all)).toBe(-180);
    expect(Math.max(...all)).toBe(180);
  });
});
