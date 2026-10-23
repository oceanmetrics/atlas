// The OBIS layer in the one composed style (build week 4, step 5): the release slot's vector source and fill go in
// through `composeStyle({ h3 })` in the lens's data group, under the basemap labels; the indicator switch changes
// the paint and filter only, never the source (no tile is fetched again); a period changes the tile url.
import { describe, expect, it } from "vitest";
import { h3ReleaseSlot, releaseSource } from "@oceanmetrics/map";
import { composeStyle } from "../../src/lib/map/style";
import {
  DEFAULT_LAYER_STACK,
  LABELS_ABOVE_DATA_STACK,
  defaultLayerStackEntries,
  formatLayerStack,
  isDefaultLayerStack,
  layerStackForUrl,
  parseLayerStack,
  resolveLayerStack,
} from "../../src/lib/map/layerStack";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import type { H3LayerSpec } from "../../src/lib/map/types";
import type { CartoStyleLike } from "../../src/lib/map/layers/basemap";
import { releaseTarget } from "../../src/lens/collection/h3/view";
import { item, spec } from "./support";

const CARTO: CartoStyleLike = {
  version: 8,
  sources: { carto: { type: "vector", url: "https://x.test/carto.json" } },
  layers: [
    { id: "water", type: "fill", source: "carto", "source-layer": "water" },
    { id: "place_label", type: "symbol", source: "carto", "source-layer": "place" },
  ],
  glyphs: "https://x.test/{fontstack}/{range}.pbf",
} as unknown as CartoStyleLike;

function slotOf(indicator = "es") {
  const t = releaseTarget(spec(), "obis_h3", item("all"))!;
  return h3ReleaseSlot({ collection: t.collection, item: t.item, indicator, statsHref: null });
}
const specOf = (s: ReturnType<typeof slotOf>, selected: string | null = null): H3LayerSpec => ({
  sourceId: s.ids.source,
  source: releaseSource(s.layer()),
  fill: { id: s.ids.fill, type: "fill", source: s.ids.source, "source-layer": "h3", paint: {} },
  selected: selected
    ? {
        id: `${s.ids.fill}:selected`,
        type: "line",
        source: s.ids.source,
        "source-layer": "h3",
        filter: ["==", ["get", "h3"], selected],
      }
    : null,
});

describe("composeStyle({ h3 })", () => {
  it("adds the slot's source and fill, then the selected outline, in the data group", () => {
    const s = slotOf();
    const style = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      h3: specOf(s, "8348c0fffffffff"),
    });
    expect(style.sources[s.ids.source]).toMatchObject({ type: "vector", promoteId: "h3" });
    const ids = style.layers.map((l) => l.id);
    const fill = ids.indexOf(s.ids.fill);
    expect(fill).toBeGreaterThan(-1);
    expect(ids.indexOf(`${s.ids.fill}:selected`)).toBe(fill + 1);
    // the atlas's default stack draws the basemap under the data, labels included (as for every layer)
    const label = ids.findIndex((id) => id.endsWith("place_label"));
    expect(label).toBeLessThan(fill);
  });
  it("labels sit above the hexagons once the Labels row is moved above the data (the Layers panel)", () => {
    const s = slotOf();
    const def = defaultLayerStackEntries();
    const labels = def.find((e) => e.id === "basemap-labels")!;
    const stack = [...def.filter((e) => e.id !== "basemap-labels"), labels];
    const style = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      h3: specOf(s),
      layerStack: stack,
    });
    const ids = style.layers.map((l) => l.id);
    expect(ids.findIndex((id) => id.endsWith("place_label"))).toBeGreaterThan(
      ids.indexOf(s.ids.fill),
    );
  });
  it("the h3 layer's own default stack draws the place labels above the hexagons (a per-layer default)", () => {
    const s = slotOf();
    const style = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      h3: specOf(s),
      layerStack: resolveLayerStack(undefined, true),
    });
    const ids = style.layers.map((l) => l.id);
    expect(ids.findIndex((id) => id.endsWith("place_label"))).toBeGreaterThan(
      ids.indexOf(s.ids.fill),
    );
    // the same view with another layer's default (not h3) keeps the labels under the data
    const other = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      h3: specOf(s),
      layerStack: resolveLayerStack(undefined, false),
    });
    const oids = other.layers.map((l) => l.id);
    expect(oids.findIndex((id) => id.endsWith("place_label"))).toBeLessThan(
      oids.indexOf(s.ids.fill),
    );
  });
  it("the data group's opacity scales the hexagons (the Layers panel's opacity control)", () => {
    const s = slotOf();
    const stack = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, opacity: 0.5 } : e,
    );
    const style = composeStyle({ theme: "navy", basemap: null, h3: specOf(s), layerStack: stack });
    const l = style.layers.find((x) => x.id === s.ids.fill) as { paint?: Record<string, unknown> };
    expect(l.paint?.["fill-opacity"]).toBe(0.5);
  });
  it("no h3 spec, no h3 source", () => {
    const style = composeStyle({ theme: "navy", basemap: null, h3: null });
    expect(Object.keys(style.sources).some((k) => k.includes("h3"))).toBe(false);
  });
});

describe("the slot's tile url", () => {
  it("indicator switch makes no request: the source is the same for every indicator", () => {
    const s = slotOf("es");
    const before = s.tileUrl();
    for (const ind of ["sp", "shannon", "simpson", "n"]) {
      s.update({ indicator: ind });
      expect(s.tileUrl()).toBe(before);
    }
    // every tile carries the five columns
    expect(s.layer().columns.sort()).toEqual(["es", "n", "shannon", "simpson", "sp"]);
  });
  it("a period is another file: the tile url changes; back to all years restores it", () => {
    const s = slotOf();
    const all = s.tileUrl();
    s.update({ period: { grain: "decade", value: "1990" } });
    expect(s.tileUrl()).not.toBe(all);
    expect(decodeURIComponent(s.tileUrl())).toContain("decade=1990");
    s.update({ period: null });
    expect(s.tileUrl()).toBe(all);
  });
  it("a pinned resolution is in the tile url (the worker reads that file at every zoom)", () => {
    const s = slotOf();
    s.update({ res: 4 });
    expect(s.layer().pin).toBe(4);
  });
});

describe("the Labels row above the data is the h3 layer's default, not the stack's", () => {
  it("the h3 default is the stock stack with basemap-labels right above data-raster; the stock stack is unchanged", () => {
    const ids = LABELS_ABOVE_DATA_STACK;
    expect(ids.indexOf("basemap-labels")).toBe(ids.indexOf("data-raster") + 1);
    expect(ids.filter((id) => id !== "basemap-labels")).toEqual(
      DEFAULT_LAYER_STACK.filter((id) => id !== "basemap-labels"),
    );
    expect(DEFAULT_LAYER_STACK.indexOf("basemap-labels")).toBeLessThan(
      DEFAULT_LAYER_STACK.indexOf("data-raster"),
    );
    expect(defaultLayerStackEntries().map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    expect(defaultLayerStackEntries(true).map((e) => e.id)).toEqual([...LABELS_ABOVE_DATA_STACK]);
    // data-places stays on top, every group is present once
    expect(ids[ids.length - 1]).toBe("data-places");
    expect(new Set(ids).size).toBe(DEFAULT_LAYER_STACK.length);
  });
  it("what is default depends on the layer shown (Reset layers, the URL)", () => {
    const h3 = defaultLayerStackEntries(true);
    const stock = defaultLayerStackEntries();
    expect(isDefaultLayerStack(h3, true)).toBe(true);
    expect(isDefaultLayerStack(h3)).toBe(false);
    expect(isDefaultLayerStack(stock)).toBe(true);
    expect(isDefaultLayerStack(stock, true)).toBe(false);
    // the URL keeps a deviation only: on h3 the stock order IS one
    expect(layerStackForUrl(h3, true)).toBeUndefined();
    expect(layerStackForUrl(stock, true)).toBe(stock);
    expect(layerStackForUrl(stock, false)).toBeUndefined();
    expect(layerStackForUrl(h3, false)).toBe(h3);
    expect(resolveLayerStack(undefined, true)).toEqual(h3);
    expect(resolveLayerStack(stock, true)).toBe(stock);
  });
  it("regression: labels moved back under the hexagons survive a reload (the stock stack is written to layers=)", () => {
    const stock = defaultLayerStackEntries();
    // the model's own contract is unchanged: the stock stack is no token
    expect(formatLayerStack(stock)).toBeNull();
    expect(parseLayerStack(DEFAULT_LAYER_STACK.join(","))).toBeNull();
    // the URL codec keeps it
    const token = formatLayerStack(stock, { keepDefault: true })!;
    expect(token).toBe(DEFAULT_LAYER_STACK.join(","));
    const url = formatSel({ ...parseSel({ search: "", hash: "" }), c: "obis_h3", layers: stock });
    expect(url.search).toContain("layers=");
    const back = parseSel(url);
    expect(back.layers?.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    // a view with no layers= is the layer's default
    const none = parseSel({ search: "?c=obis_h3", hash: "" });
    expect(none.layers).toBeUndefined();
    // garbage names no group: still no token
    expect(parseLayerStack("%%%nope%%%", { keepDefault: true })).toBeNull();
  });
});
