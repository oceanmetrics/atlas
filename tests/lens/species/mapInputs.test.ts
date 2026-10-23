// atlas-5 step 1/2: mapInputs.ts turns a LayerBar + representation into composeStyle() data — the
// COG branch (with the asset's OWN colormap/rescale, AquaX 0-1000 vs everything else 1-100), the
// PMTiles ranges branch, and the two render-time notices (§7.4).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { releaseCogSources } from "../../../src/lib/raster/cog";
import { releaseCogDraw } from "../../../src/lib/raster/releaseCog";
import { clearCog3857Cache } from "../../../src/lib/release/cog3857";
import { parseTaxonShard } from "../../../src/lens/species/data/shards";
import { layerBar } from "../../../src/lens/species/data/layerBar";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import {
  DEFAULT_SPECIES_COLORMAP,
  SINGLE_LAYER_CAPTION,
  SPECIES_RANGE_ID,
  SPECIES_RASTER_ID,
  SPECIES_RASTER_OPACITY,
  activePill,
  formatSpeciesLegendValue,
  noNativeSurfaceNotice,
  pickAsset,
  rangeFeatureKey,
  speciesMapInputs,
} from "../../../src/lens/species/mapInputs";
import { RANGE_FILL_COLOR, RANGE_FILL_OPACITY } from "../../../src/lib/map/layers/ranges";
import { CARDS, datasetsFor } from "./fixtures";

const v9 = () => datasetsFor("v9");
const v7 = () => datasetsFor("v7");

describe("pickAsset", () => {
  it("prefers the exact rep match", () => {
    const assets = [
      {
        rep: "native",
        type: "cog" as const,
        url: "a",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        sourceKey: null,
        bbox: null,
      },
      {
        rep: "model",
        type: "cog" as const,
        url: "b",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        sourceKey: null,
        bbox: null,
      },
    ];
    expect(pickAsset(assets, "model")?.url).toBe("b");
    expect(pickAsset(assets, "native")?.url).toBe("a");
  });

  it("falls back to native, then to the first, when the exact rep is missing", () => {
    const nativeOnly = [
      {
        rep: "native",
        type: "cog" as const,
        url: "a",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        sourceKey: null,
        bbox: null,
      },
    ];
    expect(pickAsset(nativeOnly, "model")?.url).toBe("a");
    const neither = [
      {
        rep: "foo",
        type: "cog" as const,
        url: "z",
        rescale: null,
        colormap: null,
        sourceLayer: null,
        sourceKey: null,
        bbox: null,
      },
    ];
    expect(pickAsset(neither, "model")?.url).toBe("z");
  });

  it("null for no assets at all", () => {
    expect(pickAsset([], "native")).toBeNull();
  });
});

describe("speciesMapInputs — COG branch", () => {
  it("the merged model: titiler tile with its own colormap/rescale, opacity 0.8", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBeNull();
    expect(out.raster?.id).toBe(SPECIES_RASTER_ID);
    expect(out.raster?.opacity).toBe(SPECIES_RASTER_OPACITY);
    expect(out.raster?.tiles[0]).toContain("colormap_name=spectral_r");
    expect(out.raster?.tiles[0]).toContain("rescale=1,100");
    expect(out.range).toBeNull();
  });

  it("AquaX 'Delivered' (native) representation carries rescale=0,1000 — the AquaX gate", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: "ax", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.raster?.tiles[0]).toContain("rescale=0,1000");
    expect(out.asset?.rep).toBe("native");
  });

  it("AquaX 'As ingested' (model) representation carries rescale=1,100", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: "ax", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "model",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.raster?.tiles[0]).toContain("rescale=1,100");
  });

  it("a null asset.colormap falls back to the app's default ramp name, never guessed elsewhere", () => {
    expect(DEFAULT_SPECIES_COLORMAP).toBe("spectral_r");
  });

  it("legend stops come from boot.palettes at the asset's own [min,max], or null without boot", () => {
    const card = CARDS.leatherback();
    const bar = layerBar(card, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    const withBoot = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: "x",
      boot: {
        palettes: { spectral_r: Array.from({ length: 11 }, (_, i) => `#${i}${i}${i}${i}${i}${i}`) },
      },
    });
    expect(withBoot.legend?.kind).toBe("continuous");
    if (withBoot.legend?.kind === "continuous") {
      expect(withBoot.legend.stops[0].value).toBe(1);
      expect(withBoot.legend.stops.at(-1)?.value).toBe(100);
    }
    const withoutBoot = speciesMapInputs(bar, { rep: "native", ver: "v9", scientificName: "x" });
    expect(withoutBoot.legend).toBeNull();
    // the raster STILL draws even with no legend — titiler colors it server-side regardless
    expect(withoutBoot.raster).not.toBeNull();
  });

  it("merged: null -> the notice, no raster, no range (the ~192 residual taxa)", () => {
    const card = CARDS.whelk(); // v1: merged null, zero inputs
    const bar = layerBar(card, {
      ver: "v1",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v1"),
    });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v1",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBe("No surface published for this taxon in v1");
    expect(out.raster).toBeNull();
    expect(out.range).toBeNull();
  });
});

// R5-2: the legend subtitle's value-semantics clause. An input with ONE representation has nothing to
// be "as delivered" against -- v1-v7 inputs publish a single COG on the scoring grid, labelled
// `rep: "native"` by the legacy adapter. Pinned for: both representations, original only, gridded only.
describe("speciesMapInputs — the legend caption of a single-representation input (R5-2)", () => {
  // without `boot.palettes` a COG draws but has no legend at all
  const BOOT = {
    palettes: { spectral_r: Array.from({ length: 11 }, (_, i) => `#${i}${i}${i}${i}${i}${i}`) },
  };
  const cogAsset = (rep: string, url: string) => ({
    rep,
    type: "cog" as const,
    url,
    rescale: [1, 100] as [number, number],
    colormap: "spectral_r",
    sourceLayer: null,
    sourceKey: null,
    bbox: null,
  });
  const pmtilesAsset = (url: string) => ({
    rep: "native",
    type: "pmtiles" as const,
    url,
    rescale: null,
    colormap: null,
    sourceLayer: "rng_bl",
    sourceKey: null,
    bbox: null,
  });
  const subtitleOf = (
    assets: ReturnType<typeof cogAsset>[] | unknown[],
    rep: "native" | "model",
  ) => {
    const walrus = CARDS.walrus();
    const card = {
      ...walrus,
      inputs: walrus.inputs.map((i) =>
        i.dsKey === "am" ? { ...i, assets: assets as typeof i.assets } : i,
      ),
    };
    const bar = layerBar(card, { ver: "v9", selectedInput: "am", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep,
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
      boot: BOOT,
    });
    return out.legend?.subtitle;
  };

  it("both representations: Original reads 'as delivered', Interpolated reads 'habitat suitability 1-100' (unchanged)", () => {
    const both = [
      cogAsset("native", "https://x/native/am/a.tif"),
      cogAsset("model", "https://x/cog/global05/b.tif"),
    ];
    expect(subtitleOf(both, "native")).toBe("AquaMaps SDM · as delivered");
    expect(subtitleOf(both, "model")).toBe("AquaMaps SDM · habitat suitability 1-100");
  });

  it("lone COG labelled native (v7): 'on the 0.05° scoring grid', NOT 'as delivered'", () => {
    const only = [cogAsset("native", "https://x/v7/native/am/a.tif")];
    expect(subtitleOf(only, "native")).toBe("AquaMaps SDM · on the 0.05° scoring grid");
    expect(SINGLE_LAYER_CAPTION).toBe("on the 0.05° scoring grid");
  });

  it("lone COG labelled model (backfilled v7 'model-only'): keeps the OLD 'habitat suitability 1-100' caption", () => {
    const only = [cogAsset("model", "https://x/cog/global05/b.tif")];
    expect(subtitleOf(only, "native")).toBe("AquaMaps SDM · habitat suitability 1-100");
    expect(subtitleOf(only, "model")).toBe("AquaMaps SDM · habitat suitability 1-100");
  });

  it("original only (a PMTiles range): presence, never the grid caption", () => {
    expect(subtitleOf([pmtilesAsset("https://x/native/am/c.pmtiles")], "native")).toBe(
      "AquaMaps SDM · presence",
    );
  });

  it("the merged model is never relabelled (its caption does not depend on the pill's assets)", () => {
    const card = CARDS.walrus();
    const bar = layerBar(card, { ver: "v9", selectedInput: MERGED_IN, datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      boot: BOOT,
    });
    expect(out.legend?.subtitle).toContain("habitat suitability 1-100");
  });
});

describe("speciesMapInputs — PMTiles ranges branch", () => {
  it("fill #3388ff at 0.5, source-layer + mdl_key filter from the asset, categorical legend", () => {
    const card = CARDS.walrus();
    const bar = layerBar(card, { ver: "v9", selectedInput: "rng_iucn", datasets: v9() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v9",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBeNull();
    expect(out.raster).toBeNull();
    expect(out.range?.id).toBe(SPECIES_RANGE_ID);
    expect(out.range?.fillColor).toBe(RANGE_FILL_COLOR);
    expect(out.range?.opacity).toBe(RANGE_FILL_OPACITY);
    expect(out.range?.keyProperty).toBe("mdl_key");
    expect(out.range?.key).toBe(activePill(bar)?.mdlKey);
    // UI-L2 (Ben's "Legend names the layer" ask): title is "{common} ({sci})", subtitle is
    // "{input label} · presence" (the brief's own "FWS Range · presence" form) -- built by the
    // SAME `lib/map/legendTitle.ts#legendTitle()` the scores lens' legend uses, never a second,
    // species-only title format.
    expect(out.legend).toEqual({
      kind: "categorical",
      title: "Walrus (Odobenus rosmarus)",
      subtitle: "IUCN Range · presence",
      label: "range (presence)",
      color: RANGE_FILL_COLOR,
    });
  });

  // the "{common} ({sci})" title's fallback to the bare scientific name (no common name published)
  // is `legendTitle()`'s own concern, asserted directly in tests/lib/map/legendTitle.test.ts --
  // not re-asserted here with a synthetic fixture.
});

describe("formatSpeciesLegendValue — the species legend's own formatValue (defect fix)", () => {
  it("prints integers, never Legend.svelte's default 2 dp (the fault: '1.00'/'100.00')", () => {
    expect(formatSpeciesLegendValue(1)).toBe("1");
    expect(formatSpeciesLegendValue(100)).toBe("100");
  });

  it("rounds a fractional value (never truncates)", () => {
    expect(formatSpeciesLegendValue(53.6)).toBe("54");
    expect(formatSpeciesLegendValue(0)).toBe("0");
  });
});

describe("speciesMapInputs — the struck-through-pill state", () => {
  it("an input with no published assets: the notice, nothing drawn", () => {
    const card = CARDS.walrusV7();
    const bar = layerBar(card, { ver: "v7", selectedInput: "am_0.05", datasets: v7() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v7",
      scientificName: card.sci,
      commonName: card.common,
    });
    expect(out.notice).toBe(noNativeSurfaceNotice());
    expect(out.raster).toBeNull();
    expect(out.range).toBeNull();
  });
});

describe("rangeFeatureKey (v7-range-draws-with-source-key)", () => {
  it("v8/v9 shape: no source_key -> the input's own mdl_key", () => {
    expect(rangeFeatureKey({ sourceKey: null }, { mdlKey: "bl|22694870" })).toBe("bl|22694870");
  });
  it("v7 shape: source_key wins over the legacy numeric input key", () => {
    expect(rangeFeatureKey({ sourceKey: "bl|22694870" }, { mdlKey: "17626" })).toBe("bl|22694870");
  });
  it("an empty source_key falls back to the input's key", () => {
    expect(rangeFeatureKey({ sourceKey: "" }, { mdlKey: "17626" })).toBe("17626");
  });
});

describe("source_key parsing", () => {
  const shard = (extra: Record<string, unknown>) => ({
    schema: 1,
    ver: "v7",
    shard: "28",
    taxa: {
      "ms_merge|X:1": {
        key: "ms_merge|X:1",
        sci: "X y",
        common: null,
        sp_cat: "bird",
        taxon_id: "1",
        taxon_authority: "botw",
        merged: null,
        inputs: [
          {
            ds_key: "bl",
            mdl_key: "17626",
            is_mask: true,
            assets: [
              {
                rep: "native",
                type: "pmtiles",
                url: "u",
                source_layer: "bl",
                bbox: null,
                ...extra,
              },
            ],
          },
        ],
      },
    },
  });
  const key = (extra: Record<string, unknown>) => {
    const r = parseTaxonShard(shard(extra));
    if (typeof r === "string") throw new Error(r);
    return r.taxa.get("ms_merge|X:1")?.inputs[0]?.assets[0]?.sourceKey;
  };
  it("parses a string, and treats absent / empty / non-string as null (never a schema error)", () => {
    expect(key({ source_key: "bl|22694870" })).toBe("bl|22694870");
    expect(key({})).toBeNull();
    expect(key({ source_key: "" })).toBeNull();
    expect(key({ source_key: 5 })).toBeNull();
  });
});

// ---- build week 6 step 5: the species lens draws a release COG from its 3857 copy -------------------
describe("speciesMapInputs — who draws the COG (the release's side table)", () => {
  const table = (): ArrayBuffer => {
    const b = readFileSync(
      new URL("../../fixtures/release/cog_3857_lenses.parquet", import.meta.url),
    );
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const boot = {
    palettes: {
      spectral_r: [
        "#5E4EA1",
        "#3287BD",
        "#66C1A5",
        "#ABDDA4",
        "#E5F498",
        "#FFFFBF",
        "#FEDF8B",
        "#FDAD60",
        "#F36C43",
        "#D43E4E",
        "#9E0041",
      ],
    },
  };
  beforeEach(() => clearCog3857Cache());
  afterEach(() => releaseCogSources());

  async function murrelet() {
    const card = CARDS.murrelet();
    const bar = layerBar(card, { ver: "v7", selectedInput: MERGED_IN, datasets: v7() });
    const asset = pickAsset(activePill(bar)!.assets, "native")!;
    const cog = await releaseCogDraw({
      ver: "v7",
      cogUrl: asset.url,
      domain: asset.rescale,
      paint: { kind: "stops", stops: boot.palettes.spectral_r },
      opacity: SPECIES_RASTER_OPACITY,
      table: table(),
      sharedTable: null,
    });
    return { bar, asset, cog };
  }

  it("a v7 row the side table lists: the raster is the 3857 copy's cog:// template, no titiler url", async () => {
    const { bar, cog } = await murrelet();
    expect(cog.kind).toBe("cog");
    const out = speciesMapInputs(bar, { rep: "native", ver: "v7", scientificName: "x", boot, cog });
    expect(out.raster?.id).toBe(SPECIES_RASTER_ID);
    expect(out.raster?.tiles[0]).toMatch(
      /^cog:\/\/.*\/v7\/cog_3857\/cog\/usa05\/7d028c7d233f11f3_3857\.tif#color:/,
    );
    expect(out.raster?.tiles[0]).toContain(",1,100,c/{z}/{x}/{y}"); // the shard's own rescale
    expect(out.raster?.tiles[0]).not.toContain("/cog/tiles/");
    expect(out.raster?.opacity).toBe(SPECIES_RASTER_OPACITY);
    expect(out.raster?.maxzoom).toBe(5);
  });

  it("the legend keeps the release's stops and takes the side table's histogram", async () => {
    const { bar, cog } = await murrelet();
    const out = speciesMapInputs(bar, { rep: "native", ver: "v7", scientificName: "x", boot, cog });
    expect(out.legend?.kind).toBe("continuous");
    if (out.legend?.kind !== "continuous") return;
    expect(out.legend.stops[0].value).toBe(1);
    expect(out.legend.stops.at(-1)?.value).toBe(100);
    expect(out.legend.histogram?.binCount).toBe(32);
    expect([out.legend.histogram?.min, out.legend.histogram?.max]).toEqual([25, 50]);
  });

  it("pending: nothing is drawn yet (no titiler tile for a COG the browser may draw)", () => {
    const bar = layerBar(CARDS.murrelet(), { ver: "v7", selectedInput: MERGED_IN, datasets: v7() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v7",
      scientificName: "x",
      boot,
      cog: "pending",
    });
    expect(out.raster).toBeNull();
    expect(out.asset?.type).toBe("cog");
  });

  it("unresolved (no row): titiler draws it, as before", () => {
    const bar = layerBar(CARDS.murrelet(), { ver: "v7", selectedInput: MERGED_IN, datasets: v7() });
    const out = speciesMapInputs(bar, {
      rep: "native",
      ver: "v7",
      scientificName: "x",
      boot,
      cog: { kind: "titiler" },
    });
    expect(out.raster?.tiles[0]).toContain("/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=");
    expect(out.raster?.maxzoom).toBeUndefined();
  });
});
