import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  noSurfaceMessage,
  surfaceFor,
  taxonFacts,
  taxonItem,
  COG_MEDIA_TYPE,
  PMTILES_MEDIA_TYPE,
} from "../../../src/lib/catalog/mst/taxon";
import { rangeAssetOf, rasterAssetOf } from "../../../src/lib/catalog/assets";
import { parseTaxonShard, type TaxonCard } from "../../../src/lens/species/data/shards";

function leatherback(): TaxonCard {
  const raw = JSON.parse(
    readFileSync(new URL("../../fixtures/mst/v7-taxon-e1.json", import.meta.url), "utf8"),
  );
  const shard = parseTaxonShard(raw);
  if (typeof shard === "string") throw new Error(shard);
  return shard.taxa.get("54241")!;
}

describe("surfaceFor: which COG a taxon has in a v7 collection", () => {
  it("an input dataset gives its `model` COG, verbatim rescale and colormap", () => {
    const s = surfaceFor(leatherback(), "am_0.05");
    expect(s).toMatchObject({ ok: true, rep: "model", rescale: [1, 100], colormap: "spectral_r" });
    expect(s.ok && s.url).toMatch(/\/cog\/usa05\/3b65e8ff84b8cf75\.tif$/);
  });
  it("ms_merge gives the merged surface", () => {
    const s = surfaceFor(leatherback(), "ms_merge");
    expect(s).toMatchObject({ ok: true, rep: "merged" });
    expect(s.ok && s.url).toMatch(/9fe6f75498affae1\.tif$/);
  });
  it("a dataset the taxon has no model in is no-input", () => {
    expect(surfaceFor(leatherback(), "bl")).toEqual({ ok: false, reason: "no-input" });
  });
  it("a taxon with no merged surface is no-surface", () => {
    expect(surfaceFor({ ...leatherback(), merged: null }, "ms_merge")).toEqual({
      ok: false,
      reason: "no-surface",
    });
  });
  it("an input with no registered file is no-asset; one with only vector files is no-cog", () => {
    const c = leatherback();
    const bare = { ...c, inputs: c.inputs.map((i) => ({ ...i, assets: [] })) };
    expect(surfaceFor(bare, "rng_iucn")).toEqual({ ok: false, reason: "no-asset" });
    const vec = {
      ...c,
      inputs: c.inputs.map((i) => ({
        ...i,
        assets: i.assets.filter((a) => a.type === "pmtiles"),
      })),
    };
    // WP11: a vector-only model is drawable (a range fill keyed by the shard's source_key)...
    expect(surfaceFor(vec, "rng_iucn")).toEqual({
      ok: true,
      kind: "pmtiles",
      url: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/native/rng_iucn/3a26f18f3e7cdca6.pmtiles",
      sourceLayer: "rng_iucn",
      key: "rng_iucn|6494",
      rep: "native",
    });
    // ...unless it names no tile layer: then there is nothing to draw
    const noLayer = {
      ...vec,
      inputs: vec.inputs.map((i) => ({
        ...i,
        assets: i.assets.map((a) => ({ ...a, sourceLayer: null })),
      })),
    };
    expect(surfaceFor(noLayer, "rng_iucn")).toEqual({ ok: false, reason: "no-cog" });
  });
  it("the key is the input's own mdl_key when the shard gives no source_key", () => {
    const c = leatherback();
    const vec = {
      ...c,
      inputs: c.inputs.map((i) => ({
        ...i,
        assets: i.assets
          .filter((a) => a.type === "pmtiles")
          .map((a) => ({ ...a, sourceKey: null })),
      })),
    };
    const s = surfaceFor(vec, "rng_iucn");
    const own = vec.inputs.find((i) => i.dsKey === "rng_iucn")!.mdlKey;
    expect(s.ok && s.kind === "pmtiles" && s.key).toBe(own);
  });
  it("regression: a COG asset with no rescale asks for titiler's own, never a guessed one", () => {
    const c = leatherback();
    const noRescale = {
      ...c,
      inputs: c.inputs.map((i) => ({
        ...i,
        assets: i.assets.map((a) => ({ ...a, rescale: null })),
      })),
    };
    const item = taxonItem(noRescale, "am_0.05", "msens-v7-am_0.05")!;
    expect(item.assets.data["atlas:rescale"]).toBe("auto");
    expect(item.properties["atlas:value_range"]).toBeUndefined();
  });
});

describe("taxonItem: the STAC Item built from a taxon shard", () => {
  const item = taxonItem(leatherback(), "rng_iucn", "msens-v7-rng_iucn", "IUCN Range")!;
  it("is a Feature in the collection with one COG data asset the lens can draw", () => {
    expect(item.id).toBe("54241");
    expect(item.collection).toBe("msens-v7-rng_iucn");
    expect(item.assets.data.type).toBe(COG_MEDIA_TYPE);
    expect(rasterAssetOf(item)).toMatchObject({
      url: expect.stringMatching(/d1e9e9c00edef2ed\.tif$/),
      rescale: [1, 100],
      colormap: "spectral_r",
    });
  });
  it("carries the legend range from the asset and the title with the common name", () => {
    expect(item.properties["atlas:value_range"]).toEqual([1, 100]);
    expect(item.properties.title).toBe("Dermochelys coriacea (Leatherback Turtle)");
  });
  it("is null when the taxon has nothing to draw there", () => {
    expect(taxonItem(leatherback(), "bl", "msens-v7-bl")).toBeNull();
  });
});

describe("taxonItem for a vector-only model (WP11)", () => {
  const c = leatherback();
  const vec = {
    ...c,
    inputs: c.inputs.map((i) => ({ ...i, assets: i.assets.filter((a) => a.type === "pmtiles") })),
  };
  const item = taxonItem(vec, "rng_iucn", "msens-v7-rng_iucn", "IUCN Range")!;
  it("is an Item with one PMTiles data asset: layer, key property and key", () => {
    expect(item.assets.data).toMatchObject({
      type: PMTILES_MEDIA_TYPE,
      "pmtiles:layers": ["rng_iucn"],
      "atlas:key_property": "mdl_key",
      "atlas:key": "rng_iucn|6494",
    });
    expect(rasterAssetOf(item)).toBeNull();
    expect(rangeAssetOf(item)).toEqual({
      url: expect.stringMatching(/3a26f18f3e7cdca6\.pmtiles$/),
      layer: "rng_iucn",
      keyProperty: "mdl_key",
      key: "rng_iucn|6494",
    });
  });
  it("carries no value range (the shard has no value to colour by) and keeps the taxon facts", () => {
    expect(item.properties["atlas:value_range"]).toBeUndefined();
    expect(taxonFacts(item).map((f) => f.label)).toContain("Scientific name");
  });
  it("a COG item has no range asset", () => {
    expect(rangeAssetOf(taxonItem(leatherback(), "rng_iucn", "x", "y"))).toBeNull();
  });
});

describe("taxonFacts: the identifiers the Details panel shows", () => {
  it("lists WoRMS with a link to its taxon page, the Red List and ESA status", () => {
    const facts = taxonFacts(taxonItem(leatherback(), "am_0.05", "msens-v7-am_0.05"));
    expect(facts.find((f) => f.label === "WoRMS AphiaID")).toEqual({
      label: "WoRMS AphiaID",
      value: "137209",
      href: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=137209",
    });
    expect(facts.find((f) => f.label === "IUCN Red List")?.value).toBe("EN");
    expect(facts.find((f) => f.label === "ESA listing")?.value).toBe("NMFS:EN");
    expect(facts.find((f) => f.label === "Scientific name")?.value).toBe("Dermochelys coriacea");
  });
  it("a BOTW id is shown without a link, and a mirrored Red List code is not an ESA listing", () => {
    const c: TaxonCard = {
      ...leatherback(),
      taxonAuthority: "botw",
      taxonId: "22679919",
      esa: { code: "IUCN:LC", source: null },
    };
    const facts = taxonFacts(taxonItem(c, "ms_merge", "msens-v7-ms_merge"));
    expect(facts.find((f) => f.label === "BOTW (BirdLife) id")).toEqual({
      label: "BOTW (BirdLife) id",
      value: "22679919",
    });
    expect(facts.some((f) => f.label === "ESA listing")).toBe(false);
  });
  it("an item with no sdm:taxon has none", () => {
    expect(taxonFacts(null)).toEqual([]);
  });
});

describe("noSurfaceMessage", () => {
  it("says which taxon, which collection and which release", () => {
    expect(noSurfaceMessage("no-input", "Dermochelys coriacea", "BirdLife Range", "v7")).toBe(
      "Dermochelys coriacea has no model in BirdLife Range (v7). Pick another taxon, or look for it in the Merged Model.",
    );
  });
});
