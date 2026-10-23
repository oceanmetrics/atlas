import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_TEMPLATE,
  itemTemplateOf,
  registryRefOf,
} from "../../../src/lib/catalog/registry/ref";
import type { StacCollection } from "../../../src/lib/catalog/types";
import { nativeCollection } from "./support";

describe("registryRefOf: a collection with atlas:taxa_registry is a taxon collection", () => {
  it("reads the registry and index assets, resolved against the collection", () => {
    const ref = registryRefOf(nativeCollection())!;
    expect(ref.collectionId).toBe("aquamaps_native");
    expect(ref.registryUrl).toMatch(/\/atlas\/aquamaps_native\/registry\/v2\/registry\.parquet$/);
    expect(ref.indexUrl).toMatch(/\/atlas\/aquamaps_native\/registry_index\.json$/);
    expect(ref).toMatchObject({
      keyColumn: "sp_key",
      groupColumn: "sp_cat",
      searchColumns: ["scientific_name", "common_name"],
      rowCount: 18697,
    });
  });
  it("a collection without atlas:taxa_registry is not one", () => {
    const c = nativeCollection();
    delete c["atlas:taxa_registry"];
    expect(registryRefOf(c)).toBeNull();
    expect(registryRefOf(null)).toBeNull();
  });
  it("a registry naming an asset the collection does not list is not drawable", () => {
    const c = nativeCollection();
    c.assets = {};
    expect(registryRefOf(c)).toBeNull();
  });
  it("no index asset is fine: indexUrl is null", () => {
    const c = nativeCollection();
    delete c.assets!.registry_index;
    expect(registryRefOf(c)!.indexUrl).toBeNull();
  });
});

describe("itemTemplateOf: rescale, colormap, no-data and unit from the template, defaults for the rest", () => {
  it("reads the AquaMaps template", () => {
    expect(itemTemplateOf(nativeCollection())).toMatchObject({
      rescale: [1, 100],
      colormap: "spectral_r",
      valueRange: [1, 100],
      nodata: 0,
      unit: "percent",
      bidx: 1,
    });
  });
  it("a collection with no template draws with the defaults", () => {
    const bare = { type: "Collection", id: "x", links: [] } as StacCollection;
    expect(itemTemplateOf(bare)).toEqual(DEFAULT_ITEM_TEMPLATE);
    expect(DEFAULT_ITEM_TEMPLATE).toMatchObject({
      rescale: [1, 100],
      nodata: 0,
      colormap: "spectral_r",
    });
  });
  it("a colormap the app does not have, and a garbled rescale, fall back (Spectral reversed, [1, 100])", () => {
    const c = {
      type: "Collection",
      id: "x",
      links: [],
      "atlas:item_template": {
        assets: { cog: { "atlas:colormap": "rainbow", "atlas:rescale": [5, 5] } },
      },
    } as unknown as StacCollection;
    expect(itemTemplateOf(c)).toMatchObject({ colormap: "spectral_r", rescale: [1, 100] });
  });
  it("a named app colormap and a rescale are taken verbatim", () => {
    const c = {
      type: "Collection",
      id: "x",
      links: [],
      "atlas:item_template": {
        assets: { cog: { "atlas:colormap": "viridis", "atlas:rescale": [0, 50] } },
      },
    } as unknown as StacCollection;
    expect(itemTemplateOf(c)).toMatchObject({
      colormap: "viridis",
      rescale: [0, 50],
      valueRange: [0, 50],
    });
  });
});
