import { beforeAll, describe, expect, it } from "vitest";
import {
  hexAssetOf,
  isCogAsset,
  rasterAssetOf,
  styleUrlOf,
  valuesAssetOf,
} from "../../src/lib/catalog/assets";
import { loadCatalog, loadItems, type CollectionEntry } from "../../src/lib/catalog/load";
import type { StacItem } from "../../src/lib/catalog/types";
import { FIXTURE_BASE, fakeFetch } from "./support";

let biotrack: CollectionEntry;
let items: StacItem[];
beforeAll(async () => {
  const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
  const cat = await loadCatalog(o);
  if (!cat.ok) throw new Error("fixture");
  biotrack = cat.value.entries.find((e) => e.id === "biotrack_indicators")!;
  const res = await loadItems(biotrack, o);
  if (!res.ok) throw new Error("fixture");
  items = res.value.items;
});

describe("hexAssetOf", () => {
  it("resolves the item's hex asset against the item's own URL", () => {
    expect(hexAssetOf(items[0], biotrack.collection)).toEqual({
      url: `${FIXTURE_BASE}biotrack_indicators/hex.pmtiles`,
      layer: "hex",
      idField: "FID",
    });
  });

  it("falls back to the collection-level hex asset when the item lists none", () => {
    const bare = { ...items[0], assets: {} } as StacItem;
    expect(hexAssetOf(bare, biotrack.collection)?.url).toBe(
      `${FIXTURE_BASE}biotrack_indicators/hex.pmtiles`,
    );
  });

  it("null when neither lists one", () => {
    expect(hexAssetOf(null, null)).toBeNull();
    expect(
      hexAssetOf({ ...items[0], assets: {} } as StacItem, { ...biotrack.collection!, assets: {} }),
    ).toBeNull();
  });
});

describe("valuesAssetOf", () => {
  it("returns the Parquet url with the key and this item's value column", () => {
    expect(valuesAssetOf(items[3])).toEqual({
      url: `${FIXTURE_BASE}biotrack_indicators/values.parquet`,
      keyColumn: "FID",
      valueColumn: "all_winter_uncertainty",
    });
  });

  it("null without a values asset or without a value column", () => {
    expect(valuesAssetOf(null)).toBeNull();
    expect(valuesAssetOf({ ...items[0], assets: {} } as StacItem)).toBeNull();
    const noCol = { ...items[0], assets: { values: { href: "../values.parquet" } } } as StacItem;
    expect(valuesAssetOf(noCol)).toBeNull();
  });
});

describe("rasterAssetOf: cloud-optimized GeoTIFF items render through titiler", () => {
  const cog = "image/tiff; application=geotiff; profile=cloud-optimized";

  it("recognises the COG media type regardless of parameter spacing", () => {
    expect(isCogAsset({ href: "a", type: cog })).toBe(true);
    expect(
      isCogAsset({ href: "a", type: "image/tiff;application=geotiff;profile=cloud-optimized" }),
    ).toBe(true);
    expect(isCogAsset({ href: "a", type: "image/tiff" })).toBe(false);
    expect(isCogAsset({ href: "a", type: "application/vnd.pmtiles" })).toBe(false);
    expect(isCogAsset({ href: "a" })).toBe(false);
  });

  it("finds the COG asset and resolves it against the item", () => {
    const it = {
      type: "Feature",
      id: "x",
      properties: {},
      links: [],
      "atlas:url": "https://file.example.test/stac/v7/am/items/x.json",
      assets: {
        thumb: { href: "t.png", type: "image/png" },
        cog: { href: "../cog/x.tif", type: cog },
      },
    } as unknown as StacItem;
    expect(rasterAssetOf(it)).toEqual({ url: "https://file.example.test/stac/v7/am/cog/x.tif" });
  });

  it("prefers a data-role COG; null when there is none", () => {
    const it = {
      type: "Feature",
      id: "x",
      properties: {},
      links: [],
      assets: {
        overview: { href: "https://a.test/o.tif", type: cog, roles: ["overview"] },
        data: { href: "https://a.test/d.tif", type: cog, roles: ["data"] },
      },
    } as unknown as StacItem;
    expect(rasterAssetOf(it)?.url).toBe("https://a.test/d.tif");
    expect(rasterAssetOf(items[0])).toBeNull(); // the biotrack items are hex, not COG
    expect(rasterAssetOf(null)).toBeNull();
  });

  const withBands = (assetBands: Record<string, unknown>, bidx = 2) =>
    ({
      type: "Feature",
      id: "x",
      properties: {},
      links: [],
      assets: {
        cog: {
          href: "https://a.test/d.tif",
          type: cog,
          roles: ["data"],
          "atlas:bidx": bidx,
          ...assetBands,
        },
      },
    }) as unknown as StacItem;

  it("reads the band's nodata from raster:bands (raster 1.1)", () => {
    const it = withBands({ "raster:bands": [{ nodata: -1 }, { nodata: 255 }] });
    expect(rasterAssetOf(it)).toEqual({ url: "https://a.test/d.tif", bidx: 2, nodata: 255 });
  });

  it("reads the band's nodata from the STAC 1.1 core bands when raster:bands is absent (AquaMaps)", () => {
    const it = withBands({ bands: [{ nodata: 0 }] }, 1);
    expect(rasterAssetOf(it)).toEqual({ url: "https://a.test/d.tif", bidx: 1, nodata: 0 });
    const second = withBands({ bands: [{ nodata: 0 }, { nodata: 255 }] });
    expect(rasterAssetOf(second)?.nodata).toBe(255);
  });

  it("raster:bands wins over core bands; null, nan and absent nodata give none", () => {
    const both = withBands({ "raster:bands": [{ nodata: 7 }], bands: [{ nodata: 0 }] }, 1);
    expect(rasterAssetOf(both)?.nodata).toBe(7);
    expect(rasterAssetOf(withBands({ bands: [{ nodata: null }] }, 1))).not.toHaveProperty("nodata");
    expect(rasterAssetOf(withBands({ bands: [{ nodata: "nan" }] }, 1))).not.toHaveProperty(
      "nodata",
    );
    expect(rasterAssetOf(withBands({}, 1))).not.toHaveProperty("nodata");
  });
});

describe("styleUrlOf", () => {
  it("the collection's style asset, resolved", () => {
    expect(styleUrlOf(biotrack.collection)).toBe(
      `${FIXTURE_BASE}biotrack_indicators/styles/default.json`,
    );
  });

  it("null when the collection publishes none", () => {
    expect(styleUrlOf({ ...biotrack.collection!, assets: {} })).toBeNull();
    expect(styleUrlOf(null)).toBeNull();
  });
});
