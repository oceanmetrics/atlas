// What the Collections lens draws for the MarineSensitivity collections: the legend and the titiler
// URL come from the item's COG asset (rescale / colormap / band), and the URL round-trips.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMPTY_COLLECTION_INPUTS,
  collectionMapInputs,
} from "../../../src/lens/collection/mapInputs";
import type { CollectionEntry } from "../../../src/lib/catalog/load";
import type { StacItem } from "../../../src/lib/catalog/types";
import { taxonItem } from "../../../src/lib/catalog/mst/taxon";
import { loadTaxonItem, loadMstTaxa } from "../../../src/lib/catalog/mst/items";
import { createShardCache, parseTaxonShard } from "../../../src/lens/species/data/shards";
import { searchTaxa } from "../../../src/lens/species/data/picker";
import { formatSel, parseSel } from "../../../src/lib/state/codec";
import { DEFAULT_SEL, defaultLens } from "../../../src/lib/state/types";
import { dataUrl } from "../../../src/lib/release/dataBase";
import { fixtureFetch, taxaIndexFor } from "../species/fixtures";

const entry = (id: string, title: string, unit?: string): CollectionEntry => ({
  id,
  title,
  href: `https://file.marinesensitivity.org/stac/${id}/collection.json`,
  group: id.includes("v8") ? "mst-v8" : "mst-v7",
  external: true,
  status: "ok",
  collection: { type: "Collection", id, links: [], ...(unit ? { "sdm:value_unit": unit } : {}) },
  error: null,
});

const shard = parseTaxonShard(
  JSON.parse(readFileSync(new URL("../../fixtures/mst/v7-taxon-e1.json", import.meta.url), "utf8")),
);
if (typeof shard === "string") throw new Error(shard);
const card = shard.taxa.get("54241")!;

describe("a v7 taxon item: the legend and the tile URL come from the asset", () => {
  const e = entry("msens-v7-am_0.05", "AquaMaps habitat suitability (0.05 degree)", "percent");
  const item = taxonItem(card, "am_0.05", e.id, e.title)!;
  const out = collectionMapInputs({ entry: e, item, style: null, values: null, marker: null });

  it("draws the model COG through titiler at the asset's rescale and colormap", () => {
    expect(out.raster?.tiles[0]).toBe(
      "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
        "?url=https%3A%2F%2Fs3.us-east-1.amazonaws.com%2Foceanmetrics.io-public%2Fmarine-atlas%2Fcog%2Fusa05%2F3b65e8ff84b8cf75.tif" +
        "&colormap_name=spectral_r&rescale=1,100",
    );
    expect(out.cogUrl).toMatch(/3b65e8ff84b8cf75\.tif$/);
  });
  it("the legend spans the asset's rescale, with the collection's unit", () => {
    expect(out.legend?.stops[0].value).toBe(1);
    expect(out.legend?.stops.at(-1)?.value).toBe(100);
    expect(out.legend?.unit).toBe("percent");
    expect(out.legend?.title).toContain("Dermochelys coriacea");
    expect(out.legend?.subtitle).toContain("AquaMaps habitat suitability (0.05 degree)");
  });
});

describe("a multi-band item with rescale: auto", () => {
  const e = entry("msens-v8-nc", "NOAA NCCOS seabird density", "n_per_km2");
  const item: StacItem = {
    type: "Feature",
    id: "atlantic.ARTE.summer.cv_n_per_km2",
    properties: { title: "Arctic Tern", "sdm:value_unit": "unitless" },
    assets: {
      data: {
        href: "https://file.marinesensitivity.org/cog/sdm/raw/nc_atl_birds_dens/ARTE_summer.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"],
        "atlas:bidx": 2,
        "atlas:rescale": "auto",
      },
    },
    links: [],
  };
  it("draws nothing until the range has been read (no guessed rescale)", () => {
    expect(collectionMapInputs({ entry: e, item, style: null, values: null, marker: null })).toBe(
      EMPTY_COLLECTION_INPUTS,
    );
  });
  it("once the range is known: the band, the rescale and the legend all follow it", () => {
    const read: StacItem = {
      ...item,
      properties: { ...item.properties, "atlas:value_range": [0.11, 1.97] },
    };
    const out = collectionMapInputs({
      entry: e,
      item: read,
      style: null,
      values: null,
      marker: null,
    });
    expect(out.raster?.tiles[0]).toMatch(/&colormap_name=spectral_r&rescale=0\.11,1\.97&bidx=2$/);
    // the band reaches the place summaries too (titiler /cog/statistics must read the band drawn)
    expect(out.cogBidx).toBe(2);
    expect(out.legend?.stops[0].value).toBe(0.11);
    expect(out.legend?.stops.at(-1)?.value).toBe(1.97);
  });
});

describe("the raster source's bounds (WP11): the COG footprint, when it is known", () => {
  const e = entry("msens-v8-nc", "NOAA NCCOS seabird density", "n_per_km2");
  const item: StacItem = {
    type: "Feature",
    id: "atlantic.ARTE.summer.n_per_km2",
    properties: { title: "Arctic Tern", "atlas:value_range": [0, 0.008] },
    assets: {
      data: {
        href: "https://file.marinesensitivity.org/cog/sdm/raw/nc_atl_birds_dens/ARTE_summer.tif",
        type: "image/tiff; application=geotiff; profile=cloud-optimized",
        roles: ["data"],
      },
    },
    links: [],
  };
  it("a known footprint is the raster's `bounds` (MapLibre never asks for tiles outside it)", () => {
    const out = collectionMapInputs({
      entry: e,
      item,
      style: null,
      values: null,
      marker: null,
      cogBounds: [-82.5, 24.1, -64.9, 46.3],
    });
    expect(out.raster?.bounds).toEqual([-82.5, 24.1, -64.9, 46.3]);
  });
  it("an unknown footprint draws unbounded (no `bounds` key, not a wrong one)", () => {
    for (const cogBounds of [undefined, null]) {
      const out = collectionMapInputs({
        entry: e,
        item,
        style: null,
        values: null,
        marker: null,
        cogBounds,
      });
      expect(out.raster).not.toBeNull();
      expect(out.raster).not.toHaveProperty("bounds");
    }
  });
});

describe("a vector-only model draws as a presence fill, not a 'cannot draw' notice (WP11)", () => {
  const e = entry("msens-v7-rng_iucn", "IUCN range");
  const vec = {
    ...card,
    inputs: card.inputs.map((i) => ({
      ...i,
      assets: i.assets.filter((a) => a.type === "pmtiles"),
    })),
  };
  const item = taxonItem(vec, "rng_iucn", e.id, e.title)!;
  const out = collectionMapInputs({ entry: e, item, style: null, values: null, marker: null });
  it("a range layer keyed by the model, no raster and no hex", () => {
    expect(out.raster).toBeNull();
    expect(out.hex).toBeNull();
    expect(out.range).toMatchObject({
      id: "collection_range",
      sourceLayer: "rng_iucn",
      keyProperty: "mdl_key",
      key: "rng_iucn|6494",
      pmtiles: expect.stringMatching(/3a26f18f3e7cdca6\.pmtiles$/),
    });
  });
  it("the legend is a presence swatch with the taxon's title", () => {
    expect(out.legend).toMatchObject({ kind: "presence", stops: [], histogram: null });
    expect(out.legend?.swatch).toBe(out.range?.fillColor);
    expect(out.legend?.title).toContain("Dermochelys coriacea");
  });
  it("a COG item has no range layer", () => {
    const cog = taxonItem(card, "am_0.05", "msens-v7-am_0.05", "AquaMaps")!;
    const o = collectionMapInputs({
      entry: entry("msens-v7-am_0.05", "AquaMaps"),
      item: cog,
      style: null,
      values: null,
      marker: null,
    });
    expect(o.range).toBeNull();
  });
});

describe("a fixed rescale in the asset (gm's relative index)", () => {
  it("is used without any statistics read", () => {
    const e = entry("msens-v8-gm", "gm");
    const item: StacItem = {
      type: "Feature",
      id: "x",
      properties: {},
      assets: {
        data: {
          href: "https://s3.test/gm.tif",
          type: "image/tiff; application=geotiff; profile=cloud-optimized",
          "atlas:rescale": [1, 100],
        },
      },
      links: [],
    };
    const out = collectionMapInputs({ entry: e, item, style: null, values: null, marker: null });
    expect(out.raster?.tiles[0]).toMatch(/rescale=1,100$/);
  });
});

describe("loadTaxonItem / loadMstTaxa against the v7 bundle", () => {
  const e = { id: "msens-v7-ms_merge", group: "mst-v7" as const, title: "Merged Model" };
  const liveShard = JSON.parse(
    readFileSync(new URL("../../fixtures/mst/v7-taxon-e1.json", import.meta.url), "utf8"),
  );
  const fetchJson = fixtureFetch(undefined, { "v7/app/taxon/e1.json": liveShard });

  it("reads one shard and builds the Item", async () => {
    const res = await loadTaxonItem(e, "54241", { fetchJson });
    expect(res.ok && res.item.assets.data.href).toMatch(/9fe6f75498affae1\.tif$/);
  });
  it("a taxon with no model in the collection is a state with a sentence, not an error", async () => {
    const res = await loadTaxonItem({ ...e, id: "msens-v7-bl", title: "BirdLife Range" }, "54241", {
      fetchJson,
    });
    expect(res).toMatchObject({ ok: false, kind: "no-model" });
    expect(!res.ok && res.message).toContain("BirdLife Range");
  });
  it("an unknown key and a dead network are errors that say so", async () => {
    const missing = await loadTaxonItem(e, "99999999", { fetchJson });
    expect(missing).toMatchObject({ ok: false, kind: "error" });
    const down = await loadTaxonItem(e, "54241", {
      cache: createShardCache(),
      fetchJson: async () => {
        throw new Error("offline");
      },
    });
    expect(down).toMatchObject({ ok: false, kind: "error" });
  });
  it("a non-taxon collection is refused", async () => {
    const res = await loadTaxonItem({ id: "msens-v8-nc", group: "mst-v8", title: "nc" }, "1", {
      fetchJson,
    });
    expect(res).toMatchObject({ ok: false, kind: "error" });
  });
  it("loads the v7 taxa index from app/taxa.json", async () => {
    const urls: string[] = [];
    const inner = fixtureFetch();
    const res = await loadMstTaxa({
      fetchJson: async (u) => {
        urls.push(u);
        return inner(u);
      },
    });
    expect(urls).toEqual([dataUrl("v7", "app/taxa.json")]);
    expect(res.ok).toBe(true);
  });
});

describe("taxon search (the species lens' ranking, reused by the taxon field)", () => {
  const index = taxaIndexFor("v7");
  it("ranks scientific before common name and exact before prefix", () => {
    const hits = searchTaxa(index, "dermochelys", { usOnly: false });
    expect(hits[0].row.sci).toBe("Dermochelys coriacea");
    expect(searchTaxa(index, "leatherback", { usOnly: false })[0].row.sci).toBe(
      "Dermochelys coriacea",
    );
  });
});

describe("URL: ?c=<collection>&sp=<taxon> stays in the Collections lens", () => {
  const loc = (search: string) => ({ search, hash: "" });
  it("round-trips a taxon collection link", () => {
    const sel = parseSel(loc("?c=msens-v7-rng_iucn&sp=54241"));
    expect(sel).toMatchObject({ lens: "collection", c: "msens-v7-rng_iucn", sp: "54241" });
    expect(formatSel(sel).search).toBe("?sp=54241&c=msens-v7-rng_iucn");
    expect(parseSel(loc(formatSel(sel).search))).toEqual(sel);
  });
  it("regression: ?sp= alone is still the Species lens, and lens=species still wins with a c", () => {
    expect(parseSel(loc("?sp=54241")).lens).toBe("species");
    expect(defaultLens("1", undefined)).toBe("species");
    expect(defaultLens("1", "c")).toBe("collection");
    const both = parseSel(loc("?c=msens-v7-bl&sp=54272&lens=species"));
    expect(both.lens).toBe("species");
    expect(parseSel(loc(formatSel(both).search))).toEqual(both);
  });
  it("round-trips an nc selection by item id (region, species, season, variable)", () => {
    const sel = parseSel(loc("?c=msens-v8-nc&i=pacific.CORM.summer.cv_n_per_km2"));
    expect(sel).toMatchObject({ c: "msens-v8-nc", i: "pacific.CORM.summer.cv_n_per_km2" });
    expect(formatSel(sel).search).toBe("?c=msens-v8-nc&i=pacific.CORM.summer.cv_n_per_km2");
    expect(parseSel(loc(formatSel(sel).search))).toEqual(sel);
  });
  it("a gm item id with a colon survives the URL", () => {
    const sel = { ...DEFAULT_SEL, c: "msens-v8-gm", i: "WORMS:137209.annual" };
    expect(parseSel(loc(formatSel(sel).search))).toEqual(sel);
  });
});
