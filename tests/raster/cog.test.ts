// The browser COG renderer behind the RasterSource seam (`raster/cog.ts`) and the lens inputs it feeds: one
// synthetic fixture per rule, on the aquamaps_eov fixture collection (8 x 2 items over two 9-band COGs) with the
// `cog_3857` asset the pipeline writes at publish (`atlas_pipeline/cog.py`) added where a rule needs it.
import { CogProjectionError } from "@oceanmetrics/map";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { collectionMapInputs, COLLECTION_RASTER_ID } from "../../src/lens/collection/mapInputs";
import { rasterAssetOf } from "../../src/lib/catalog/assets";
import { loadCatalog, loadItems, type CollectionEntry } from "../../src/lib/catalog/load";
import type { StacAsset, StacItem } from "../../src/lib/catalog/types";
import {
  cogRasterSource,
  rasterChoiceOf,
  releaseCogSources,
  stacHistogram,
} from "../../src/lib/raster/cog";
import {
  classColorFunction,
  paintFor,
  paintHash,
  stopsColorFunction,
} from "../../src/lib/raster/paint";
import { DEFAULT_TITILER_HOST } from "../../src/lib/raster/tiles";
import { FIXTURE_BASE, fakeFetch } from "../catalog/support";

let entry: CollectionEntry;
let items: StacItem[];
beforeAll(async () => {
  const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
  const cat = await loadCatalog(o);
  if (!cat.ok) throw new Error("catalog fixture");
  entry = cat.value.entries.find((e) => e.id === "aquamaps_eov")!;
  const res = await loadItems(entry, o);
  if (!res.ok) throw new Error("items fixture");
  items = res.value.items;
});
afterEach(() => releaseCogSources());

const HIST = { count: 4, min: 0, max: 88, buckets: [10, 5, 2, 1] };

/** the item as the pipeline publishes it from build week 2: its `cog` (4326) plus `cog_3857` (roles data +
 * visual, the same band metadata, `proj:code` EPSG:3857), and a band histogram on both. */
function with3857(item: StacItem, over: Partial<StacAsset> = {}): StacItem {
  const cog = item.assets.cog;
  const bands = (cog["raster:bands"] as Record<string, unknown>[]).map((b) => ({
    ...b,
    histogram: HIST,
  }));
  return {
    ...item,
    assets: {
      ...item.assets,
      cog: { ...cog, "proj:code": "EPSG:4326", "raster:bands": bands },
      cog_3857: {
        ...cog,
        href: cog.href.replace(/\.tif$/, "_3857.tif"),
        roles: ["data", "visual"],
        "proj:code": "EPSG:3857",
        "raster:bands": bands,
        "atlas:zoom": [0, 5],
        ...over,
      },
    },
  };
}
const item = (id: string) => items.find((i) => i.id === id)!;

describe("rasterChoiceOf: who draws an item (pickCogAssets)", () => {
  it("an item with an EPSG:3857 data asset is drawn in the browser; the values come from the 4326 original", () => {
    const c = rasterChoiceOf(with3857(item("fish_risk")));
    expect(c.kind).toBe("cog");
    if (c.kind !== "cog") return;
    expect(c.draw.key).toBe("cog_3857");
    expect(c.draw.asset.href).toBe(`${FIXTURE_BASE}aquamaps_eov/score_risk_3857.tif`);
    expect(c.values.key).toBe("cog");
    expect(c.values.asset.href).toBe(`${FIXTURE_BASE}aquamaps_eov/score_risk.tif`);
  });

  it("without one (every item but the published EOV risk items today) titiler draws it", () => {
    expect(rasterChoiceOf(item("fish_risk")).kind).toBe("titiler");
    expect(rasterChoiceOf(item("fish_share")).kind).toBe("titiler");
    expect(rasterChoiceOf(null).kind).toBe("titiler");
  });

  it("a 3857 asset that is not a data asset (a thumbnail, a reference) does not count", () => {
    expect(rasterChoiceOf(with3857(item("fish_risk"), { roles: ["visual"] })).kind).toBe("titiler");
  });

  it("rasterAssetOf (download, titiler, point read) keeps the 4326 original even when the copy is listed first", () => {
    const it = with3857(item("fish_risk"));
    const { cog, cog_3857, ...rest } = it.assets;
    const reordered = { ...it, assets: { cog_3857, cog, ...rest } };
    expect(rasterAssetOf(reordered)?.url).toBe(`${FIXTURE_BASE}aquamaps_eov/score_risk.tif`);
  });
});

describe("cogRasterSource: cogSlot behind the seam", () => {
  const drawOf = (it: StacItem) => {
    const c = rasterChoiceOf(it);
    if (c.kind !== "cog") throw new Error("not a cog item");
    return c.draw.asset;
  };

  it("the tile template is the cog:// url of the 3857 copy, keyed by the band, never a titiler url", () => {
    const it = with3857(item("fish_risk"));
    const src = cogRasterSource(it, drawOf(it), { domain: [0, 100] });
    expect(src.kind).toBe("cog");
    expect(
      src.template.startsWith(`cog://${FIXTURE_BASE}aquamaps_eov/score_risk_3857.tif?b=2#color:[`),
    ).toBe(true);
    expect(src.template.endsWith(",0,100,c/{z}/{x}/{y}")).toBe(true);
    expect(src.tileUrl(3, 1, 2, { url: "", colormapName: "", rescaleMin: 0, rescaleMax: 1 })).toBe(
      src.template.replace("{z}/{x}/{y}", "3/1/2"),
    );
    expect(src.template).not.toContain(DEFAULT_TITILER_HOST);
    expect(src.maxzoom).toBe(5);
  });

  // regression (0.4.3): the eight EOV items are bands of one file; MapLibre keys its tile cache and the protocol its
  // colour function by url, so the band must be in it (@oceanmetrics/map 0.2.2 `cogHref`: `?b=<atlas:bidx>`)
  it("two bands of one file get two templates, each naming its band", () => {
    const fish = with3857(item("fish_risk"));
    const all = with3857(item("all_risk"));
    const a = cogRasterSource(fish, drawOf(fish), { domain: [0, 100] }).template;
    const b = cogRasterSource(all, drawOf(all), { domain: [0, 100] }).template;
    expect(a).not.toBe(b);
    expect(a).toContain("score_risk_3857.tif?b=2#");
    expect(b).toContain("score_risk_3857.tif?b=1#");
  });

  it("idempotent: the same asset and options give the same mounted source", () => {
    const it = with3857(item("fish_risk"));
    expect(cogRasterSource(it, drawOf(it), { domain: [0, 100] })).toBe(
      cogRasterSource(it, drawOf(it), { domain: [0, 100] }),
    );
  });

  it("one mounted slot per band of a file: another range of the band unmounts the first, another band does not", () => {
    const fish = with3857(item("fish_risk"));
    const all = with3857(item("all_risk"));
    const a = cogRasterSource(fish, drawOf(fish), { domain: [0, 100] });
    const unmount = vi.spyOn(a.slot, "unmount");
    cogRasterSource(fish, drawOf(fish), { domain: [0, 100] });
    cogRasterSource(all, drawOf(all), { domain: [0, 100] });
    expect(unmount).not.toHaveBeenCalled();
    cogRasterSource(fish, drawOf(fish), { domain: [0, 50] });
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("a 4326 asset is refused with the package's CogProjectionError", () => {
    const it = item("fish_risk");
    expect(() =>
      cogRasterSource(it, {
        ...it.assets.cog,
        href: "https://x.test/a.tif",
        "proj:code": "EPSG:4326",
      } as never),
    ).toThrow(CogProjectionError);
  });
});

describe("the legend from a synthetic STAC asset (legendFromStac, never computed)", () => {
  it("the ramp over the domain in the asset's colormap, the histogram and stats as published", () => {
    const it = with3857(item("fish_risk"));
    const c = rasterChoiceOf(it);
    if (c.kind !== "cog") throw new Error("not a cog item");
    const lg = cogRasterSource(it, c.draw.asset, { domain: [0, 100] }).legend();
    expect(lg.ramp).toMatchObject({ min: 0, max: 100 });
    expect(lg.ramp!.colors).toHaveLength(7);
    expect(lg.ramp!.colors[0].toLowerCase()).toBe("#440154"); // viridis
    expect(lg.stats).toEqual({
      minimum: 0,
      maximum: 100,
      mean: 24.5,
      stddev: 18.2,
      valid_percent: 71.5,
    });
    expect(stacHistogram(lg)).toEqual({ binCount: 4, counts: [10, 5, 2, 1], min: 0, max: 88 });
  });

  it("no histogram in STAC: no histogram (the lens never reads one from the tile server)", () => {
    expect(stacHistogram({ histogram: null } as never)).toBeNull();
  });
});

describe("collectionMapInputs on a browser-drawn item", () => {
  it("draws cog:// tiles with the STAC legend; the download stays the 4326 original", () => {
    const it = with3857(item("fish_risk"));
    const out = collectionMapInputs({ entry, item: it, style: null, values: null, marker: 42 });
    expect(out.rasterBackend).toBe("cog");
    expect(out.raster?.id).toBe(COLLECTION_RASTER_ID);
    expect(out.raster?.tiles[0].startsWith("cog://")).toBe(true);
    expect(out.raster?.maxzoom).toBe(5);
    expect(out.cogUrl).toBe(`${FIXTURE_BASE}aquamaps_eov/score_risk.tif`);
    expect(out.cogBidx).toBe(2);
    expect(out.legend?.histogram).toEqual({ binCount: 4, counts: [10, 5, 2, 1], min: 0, max: 88 });
    const values = out.legend!.stops.map((s) => s.value);
    expect(values).toHaveLength(7);
    [0, 100 / 6, 200 / 6, 50, 400 / 6, 500 / 6, 100].forEach((v, i) =>
      expect(values[i]).toBeCloseTo(v, 9),
    );
    expect(out.legend?.marker).toBe(42);
  });

  it("the same item without the 3857 asset stays on titiler", () => {
    const out = collectionMapInputs({
      entry,
      item: item("fish_risk"),
      style: null,
      values: null,
      marker: null,
    });
    expect(out.rasterBackend).toBe("titiler");
    expect(out.raster?.tiles[0].startsWith(DEFAULT_TITILER_HOST)).toBe(true);
  });
});

// ---- build week 6 step 5: the app's own colours (`CogPaint`) ----------------------------------------
describe("the paint: the app's palette stops and a mask's exact table", () => {
  const px = (fn: ReturnType<typeof stopsColorFunction>, v: number, meta?: { noData?: number }) => {
    const c = new Uint8ClampedArray(4);
    fn([v], c, meta);
    return [...c];
  };

  it("stops are spread over [min, max] and clamped at both ends, as titiler spreads a colormap over rescale", () => {
    const fn = stopsColorFunction({ stops: ["#000000", "#ffffff"], min: 0, max: 100, nodata: 0 });
    expect(px(fn, 50)).toEqual([128, 128, 128, 255]);
    expect(px(fn, 100)).toEqual([255, 255, 255, 255]);
    expect(px(fn, 500)).toEqual([255, 255, 255, 255]);
    expect(px(fn, -5)).toEqual([0, 0, 0, 255]);
  });

  it("nodata (the band's, the file's, NaN) is transparent", () => {
    const fn = stopsColorFunction({ stops: ["#000000", "#ffffff"], min: 0, max: 100, nodata: 0 });
    expect(px(fn, 0)[3]).toBe(0);
    expect(px(fn, NaN)[3]).toBe(0);
    expect(px(fn, 7, { noData: 7 })[3]).toBe(0);
    const f32 = stopsColorFunction({
      stops: ["#000000", "#ffffff"],
      min: 0,
      max: 1,
      nodata: -9999.5,
    });
    expect(px(f32, Math.fround(-9999.5))[3]).toBe(0);
  });

  it("a class table paints its values only: 1 -> the mask grey, 0 and nodata transparent", () => {
    const fn = classColorFunction({ classes: { 1: [34, 34, 34, 255] }, nodata: -9999 });
    expect(px(fn, 1)).toEqual([34, 34, 34, 255]);
    expect(px(fn, 0)[3]).toBe(0);
    expect(px(fn, 2)[3]).toBe(0);
    expect(px(fn, -9999)[3]).toBe(0);
  });

  it("the hash carries the paint, so two palettes of one file are two sets of tiles", () => {
    expect(paintHash({ kind: "stops", stops: ["#AA0000", "#00bb00"] }, [1, 100])).toBe(
      'color:["#aa0000","#00bb00"],1,100,c',
    );
    expect(paintHash({ kind: "classes", classes: { 1: [34, 34, 34, 255] } }, [1, 1])).toBe(
      'color:["#222222"],1,1,c',
    );
  });

  it("a painted source draws the paint's hash; a palette the package's ramps lack (cividis) is no longer viridis", () => {
    const it3857 = with3857(item("fish_risk"));
    const draw = rasterChoiceOf(it3857);
    if (draw.kind !== "cog") throw new Error("fixture");
    const cividis = ["#00204d", "#ffea46"];
    const viridis = ["#440154", "#fde725"];
    const a = cogRasterSource(it3857, draw.draw.asset, {
      domain: [0, 88],
      paint: paintFor({ kind: "stops", stops: cividis }, draw.draw.asset, [0, 88]),
    });
    expect(a.template).toContain('#color:["#00204d","#ffea46"],0,88,c/{z}/{x}/{y}');
    const b = cogRasterSource(it3857, draw.draw.asset, {
      domain: [0, 88],
      paint: paintFor({ kind: "stops", stops: viridis }, draw.draw.asset, [0, 88]),
    });
    expect(b.template).not.toBe(a.template);
  });
});

describe("paintFor: a mask's range and nodata come from its band", () => {
  it("no domain: the band's statistics ([1, 1] for a mask), its STAC nodata transparent", () => {
    const asset = {
      href: "x_3857.tif",
      "proj:code": "EPSG:3857",
      bands: [{ nodata: -9999, statistics: { minimum: 1, maximum: 1 } }],
    };
    const p = paintFor({ kind: "classes", classes: { 1: [34, 34, 34, 255] } }, asset, null);
    expect(p.hash).toBe('color:["#222222"],1,1,c');
    const c = new Uint8ClampedArray(4);
    p.colorFunction([-9999], c);
    expect(c[3]).toBe(0);
    p.colorFunction([1], c);
    expect([...c]).toEqual([34, 34, 34, 255]);
  });
});
