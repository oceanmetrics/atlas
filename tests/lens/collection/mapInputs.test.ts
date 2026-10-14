// What the Collections lens draws and labels, as a pure function of entry + item + style + values.
import { beforeAll, describe, expect, it } from "vitest";
import { loadCatalog, loadItems, type CollectionEntry } from "../../../src/lib/catalog/load";
import type { StacItem } from "../../../src/lib/catalog/types";
import {
  COLLECTION_RASTER_ID,
  EMPTY_COLLECTION_INPUTS,
  collectionMapInputs,
  formatCollectionValue,
  formatRasterValue,
  itemLabel,
  rasterDomainOf,
} from "../../../src/lens/collection/mapInputs";
import style from "../../fixtures/catalog/biotrack_indicators/styles/default.json";
import { FIXTURE_BASE, fakeFetch } from "../../catalog/support";

let entry: CollectionEntry;
let items: StacItem[];
beforeAll(async () => {
  const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
  const cat = await loadCatalog(o);
  if (!cat.ok) throw new Error("fixture");
  entry = cat.value.entries[0];
  const res = await loadItems(entry, o);
  if (!res.ok) throw new Error("fixture");
  items = res.value.items;
});

const richness = () => items.find((i) => i.id === "all_summer_richness")!;

describe("collectionMapInputs: a hex item", () => {
  it("builds the hex spec from the item's PMTiles asset, the collection's ramp and the item's range", () => {
    const out = collectionMapInputs({ entry, item: richness(), style, values: null, marker: null });
    expect(out.hex).toEqual({
      pmtiles: `${FIXTURE_BASE}biotrack_indicators/hex.pmtiles`,
      sourceLayer: "hex",
      idField: "FID",
      colors: ["#112233", "#445566", "#778899"],
      domain: [0, 0.9], // atlas:value_range of a richness item
    });
    expect(out.raster).toBeNull();
    expect(out.cogUrl).toBeNull();
  });

  it("the legend spans the SAME domain the colours use, with the item's title and the collection's", () => {
    const out = collectionMapInputs({ entry, item: richness(), style, values: null, marker: null });
    expect(out.legend).toMatchObject({
      kind: "continuous",
      title: "Richness of all species, summer",
      subtitle: "MBON BioTrack biodiversity indicators",
      unit: "",
    });
    expect(out.legend?.stops.map((s) => s.value)).toEqual([0, 0.45, 0.9]);
    expect(out.legend?.stops.map((s) => s.color)).toEqual(["#112233", "#445566", "#778899"]);
  });

  it("another item has its own range (uncertainty 0.1-0.5) -- the legend follows the item", () => {
    const u = items.find((i) => i.id === "all_summer_uncertainty")!;
    const out = collectionMapInputs({ entry, item: u, style, values: null, marker: null });
    expect(out.hex?.domain).toEqual([0.1, 0.5]);
    expect(out.legend?.stops[0].value).toBe(0.1);
    expect(out.legend?.stops[2].value).toBe(0.5);
  });

  it("without a collection style the ramp is Spectral reversed (11 stops)", () => {
    const out = collectionMapInputs({
      entry,
      item: richness(),
      style: null,
      values: null,
      marker: null,
    });
    expect(out.hex?.colors).toHaveLength(11);
    expect(out.legend?.stops).toHaveLength(11);
  });

  it("the legend carries the layer's histogram once values are loaded (null values are not binned) and the marker", () => {
    const values = { fids: [1, 2, 3, 4], values: [0.1, null, 0.5, 0.9] };
    const out = collectionMapInputs({ entry, item: richness(), style, values, marker: 0.5 });
    expect(out.legend?.histogram?.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(out.legend?.marker).toBe(0.5);
    const none = collectionMapInputs({
      entry,
      item: richness(),
      style,
      values: null,
      marker: null,
    });
    expect(none.legend?.histogram).toBeNull();
    expect(none.legend?.marker).toBeNull();
  });

  it("a non-finite marker draws no line", () => {
    const out = collectionMapInputs({
      entry,
      item: richness(),
      style,
      values: null,
      marker: Number.NaN,
    });
    expect(out.legend?.marker).toBeNull();
  });

  it("a unit other than 'unitless' is carried into the legend", () => {
    const withUnit = {
      ...richness(),
      properties: { ...richness().properties, "sdm:value_unit": "individuals/km2" },
    } as StacItem;
    const out = collectionMapInputs({ entry, item: withUnit, style, values: null, marker: null });
    expect(out.legend?.unit).toBe("individuals/km2");
    expect(out.legend?.subtitle).toBe("MBON BioTrack biodiversity indicators · individuals/km2");
  });
});

describe("collectionMapInputs: a cloud-optimized GeoTIFF item renders through titiler", () => {
  const cogItem = {
    type: "Feature",
    id: "Fis-1",
    properties: { title: "A fish", "atlas:value_range": [1, 100] },
    links: [],
    "atlas:url": "https://file.marinesensitivity.org/stac/v7/am_0.05/items/Fis-1.json",
    assets: {
      cog: {
        href: "../cog/Fis-1.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"],
      },
    },
  } as unknown as StacItem;
  const cogEntry = {
    ...entry,
    id: "am_0.05",
    title: "AquaMaps 0.05 degree",
    collection: { type: "Collection", id: "am_0.05", links: [] },
  } as unknown as CollectionEntry;

  it("a raster spec on the titiler host, rescaled to the item's range, never a hex layer", () => {
    const out = collectionMapInputs({
      entry: cogEntry,
      item: cogItem,
      style: null,
      values: null,
      marker: null,
    });
    expect(out.hex).toBeNull();
    expect(out.raster?.id).toBe(COLLECTION_RASTER_ID);
    const tile = out.raster?.tiles[0] ?? "";
    expect(tile).toContain(
      "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png",
    );
    expect(tile).toContain("colormap_name=spectral_r");
    expect(tile).toContain("rescale=1,100");
    expect(tile).toContain(
      encodeURIComponent("https://file.marinesensitivity.org/stac/v7/am_0.05/cog/Fis-1.tif"),
    );
    expect(out.cogUrl).toBe("https://file.marinesensitivity.org/stac/v7/am_0.05/cog/Fis-1.tif");
  });

  it("its legend uses the default ramp over the same range (titiler takes a named colormap only)", () => {
    const out = collectionMapInputs({
      entry: cogEntry,
      item: cogItem,
      style,
      values: null,
      marker: null,
    });
    expect(out.legend?.stops).toHaveLength(11);
    expect(out.legend?.stops[0].value).toBe(1);
    expect(out.legend?.stops[10].value).toBe(100);
    expect(out.legend?.histogram).toBeNull();
  });
});

describe("collectionMapInputs: nothing to draw", () => {
  it("no entry, no item, an unavailable entry, or an item with neither a hex+values pair nor a COG", () => {
    expect(
      collectionMapInputs({ entry: null, item: null, style: null, values: null, marker: null }),
    ).toBe(EMPTY_COLLECTION_INPUTS);
    expect(
      collectionMapInputs({ entry, item: null, style: null, values: null, marker: null }),
    ).toBe(EMPTY_COLLECTION_INPUTS);
    const bare = { ...richness(), assets: {} } as StacItem;
    expect(
      collectionMapInputs({ entry, item: bare, style: null, values: null, marker: null }),
    ).toBe(EMPTY_COLLECTION_INPUTS);
    const unavailable = { ...entry, collection: null, status: "unavailable" } as CollectionEntry;
    expect(
      collectionMapInputs({
        entry: unavailable,
        item: richness(),
        style: null,
        values: null,
        marker: null,
      }),
    ).toBe(EMPTY_COLLECTION_INPUTS);
  });
});

describe("itemLabel / formatCollectionValue", () => {
  it("the item's title, else its id", () => {
    expect(itemLabel(richness())).toBe("Richness of all species, summer");
    expect(itemLabel({ ...richness(), properties: {} } as StacItem)).toBe("all_summer_richness");
    expect(itemLabel({ ...richness(), properties: { title: "  " } } as StacItem)).toBe(
      "all_summer_richness",
    );
  });

  it("three significant figures, no trailing zeros", () => {
    expect(formatCollectionValue(0.4237)).toBe("0.424");
    expect(formatCollectionValue(12.345)).toBe("12.3");
    expect(formatCollectionValue(1500)).toBe("1500");
    expect(formatCollectionValue(0)).toBe("0");
    expect(formatCollectionValue(-0.5)).toBe("-0.5");
    expect(formatCollectionValue(2_500_000)).toBe("2.50e+6");
    expect(formatCollectionValue(0.0001234)).toBe("1.23e-4");
    expect(formatCollectionValue(Number.NaN)).toBe("");
  });
});

describe("WP14: a raster item's legend histogram, value text and domain", () => {
  const cogAsset = (extra: Record<string, unknown>) => ({
    href: "https://x/y.tif",
    type: "image/tiff; application=geotiff; profile=cloud-optimized",
    roles: ["data"],
    ...extra,
  });
  const cogItem = (props: Record<string, unknown>, asset: Record<string, unknown>) =>
    ({
      type: "Feature",
      id: "t",
      properties: props,
      links: [],
      assets: { data: cogAsset(asset) },
    }) as unknown as StacItem;
  const coll = { type: "Collection", id: "c", links: [], "sdm:value_unit": "percent" };
  const cogEntry = {
    ...entry,
    id: "c",
    title: "C",
    collection: coll,
  } as unknown as CollectionEntry;
  const hist = { binCount: 2, counts: [3, 4], min: 1, max: 100 };

  it("the legend carries the histogram it is given, none while loading", () => {
    const item = cogItem({ "atlas:value_range": [1, 100] }, {});
    const base = { entry: cogEntry, item, style: null, values: null, marker: null };
    expect(collectionMapInputs({ ...base, histogram: hist }).legend?.histogram).toEqual(hist);
    expect(collectionMapInputs(base).legend?.histogram).toBeNull();
    expect(collectionMapInputs({ ...base, histogram: null }).legend?.histogram).toBeNull();
  });
  it("rasterDomainOf: the asset rescale, else the item's range; auto waits for its range", () => {
    expect(rasterDomainOf(cogItem({}, { "atlas:rescale": [1, 100] }), null)).toEqual([1, 100]);
    expect(
      rasterDomainOf(cogItem({ "atlas:value_range": [0, 5] }, { "atlas:rescale": [1, 100] }), null),
    ).toEqual([0, 5]);
    expect(rasterDomainOf(cogItem({}, { "atlas:rescale": "auto" }), null)).toBeNull();
    expect(
      rasterDomainOf(
        cogItem({ "atlas:value_range": [0, 0.008] }, { "atlas:rescale": "auto" }),
        null,
      ),
    ).toEqual([0, 0.008]);
    expect(rasterDomainOf(null, null)).toBeNull();
  });
  it("formatRasterValue: percent, a density unit, unitless, and no data", () => {
    expect(formatRasterValue(87, "percent")).toBe("87%");
    expect(formatRasterValue(42.46, "percent")).toBe("42.5%");
    expect(formatRasterValue(0.0123, "n_per_km2")).toBe("0.0123 n/km²");
    expect(formatRasterValue(0.000511, "n_per_km2")).toBe("5.11e-4 n/km²");
    expect(formatRasterValue(0.213, "")).toBe("0.213");
    expect(formatRasterValue(null, "percent")).toBe("no data");
    expect(formatRasterValue(NaN, "percent")).toBe("no data");
    expect(formatRasterValue(undefined, "")).toBe("no data");
  });
});
