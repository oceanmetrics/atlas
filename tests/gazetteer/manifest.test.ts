import { describe, expect, it } from "vitest";
import { fetchLayersManifest, layersFromManifest } from "../../src/lib/gazetteer/manifest";

const ROW = {
  slug: "a",
  title: "A",
  pmtiles: "https://storage.oceanmetrics.io/gazetteer/a/places.pmtiles",
};
const BASE = "https://s3.example/gazetteer/";

describe("layers.json", () => {
  it("both shapes are read ({layers}, a bare array); PMTiles URLs are re-based onto the data base", () => {
    expect(layersFromManifest({ layers: [ROW] }, BASE)[0].pmtiles).toBe(`${BASE}a/places.pmtiles`);
    expect(layersFromManifest([ROW], BASE)).toHaveLength(1);
  });
  it("rows without a slug or a pmtiles are dropped; garbage is an empty list", () => {
    expect(layersFromManifest({ layers: [{ slug: "x" }, null, 3, ROW] }, BASE)).toHaveLength(1);
    expect(layersFromManifest("nope", BASE)).toEqual([]);
    expect(layersFromManifest(null, BASE)).toEqual([]);
  });
  it("a raster or derived layer (`pmtiles: null`) is dropped; an unlisted one is kept (a link may draw it)", () => {
    const rows = layersFromManifest(
      {
        layers: [
          { slug: "r", kind: "raster", pmtiles: null, access: "public" },
          { ...ROW, slug: "u", access: "unlisted" },
          ROW,
        ],
      },
      BASE,
    );
    expect(rows.map((r) => r.slug)).toEqual(["u", "a"]);
  });
  it("falls back to the root copy on a 403/404, and rejects on a real failure", async () => {
    const calls: string[] = [];
    const mk = (status: number, body?: unknown) =>
      ({ ok: status < 300, status, json: async () => body }) as Response;
    const f1 = (async (u: string) => {
      calls.push(u);
      return u.endsWith("index/layers.json") ? mk(403) : mk(200, { layers: [ROW] });
    }) as unknown as typeof fetch;
    expect(await fetchLayersManifest(f1, BASE)).toHaveLength(1);
    expect(calls).toEqual([`${BASE}index/layers.json`, `${BASE}layers.json`]);
    const f2 = (async () => mk(500)) as unknown as typeof fetch;
    await expect(fetchLayersManifest(f2, BASE)).rejects.toThrow(/HTTP 500/);
  });
});
