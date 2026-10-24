// the GEBCO sea floor over CARTO (Ben 2026-10-22: the bathymetric basemap goes everywhere): the tiers through the
// storage rule, the package's stack inside the basemap run, the Bathymetry row's switch and slider, the dimming under
// data, the credit line and the lazy loader. Runs under both instances: every input names its own stack.
import { afterEach, describe, expect, it } from "vitest";
import { BASEMAP_URL, BASEMAP_VERSION, bathyDefaultOpacity, DEFAULT_TILES } from "@oceanmetrics/map";
import { store } from "../../src/lib/catalog/storage";
import {
  BASEMAP_ATTRIBUTION,
  basemapAttribution,
  loadSeaFloor,
  resetSeaFloorForTests,
  type CartoStyleLike,
  type SeaFloorModule,
} from "../../src/lib/map/layers/basemap";
import * as gebco from "../../src/lib/map/layers/gebco";
import {
  classifyBasemapLayer,
  defaultLayerStackEntries,
  type LayerStackEntry,
} from "../../src/lib/map/layerStack";
import { composeStyle, drawsSeaFloor, BASEMAP_LAYER_PREFIX } from "../../src/lib/map/style";
import type { RasterLayerSpec } from "../../src/lib/map/types";

// CARTO's shape (protomaps schema, 2026): the land colour, a park, the sea and its shadow, a road and two labels
const CARTO: CartoStyleLike = {
  sources: {
    protomaps: {
      type: "vector",
      url: "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v2/tiles.json",
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  sprite: "https://tiles.example/sprite",
  glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(250,250,248)" } },
    { id: "landcover", type: "fill", source: "protomaps", "source-layer": "landcover", paint: {} },
    {
      id: "park_national_park",
      type: "fill",
      source: "protomaps",
      "source-layer": "park",
      paint: {},
    },
    { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: {} },
    { id: "water_shadow", type: "fill", source: "protomaps", "source-layer": "water", paint: {} },
    { id: "road_major", type: "line", source: "protomaps", "source-layer": "roads", paint: {} },
    {
      id: "place_town",
      type: "symbol",
      source: "protomaps",
      "source-layer": "place",
      layout: { "text-field": "{name}", "text-font": ["Montserrat Medium"] },
    },
    {
      id: "watername_ocean",
      type: "symbol",
      source: "protomaps",
      "source-layer": "water_name",
      layout: { "text-field": "{name}", "text-font": ["Montserrat Medium Italic"] },
    },
  ],
};
const bathy = (visible: boolean, opacity = 1): LayerStackEntry[] =>
  defaultLayerStackEntries(false, visible).map((e) =>
    e.id === "basemap-bathymetry" ? { ...e, opacity } : e,
  );
const RASTER: RasterLayerSpec = { id: "eov-risk", tiles: ["cog://x/{z}/{x}/{y}"], opacity: 0.8 };
const ids = (s: { layers: { id: string }[] }) => s.layers.map((l) => l.id);
const P = BASEMAP_LAYER_PREFIX;

afterEach(() => resetSeaFloorForTests());

describe("the tiers", () => {
  it("are read through the storage rule (store('basemap/')), every tier and the regional list", () => {
    const base = store("basemap/");
    expect(gebco.GEBCO_TILES).toEqual(gebco.tilesAt(DEFAULT_TILES, BASEMAP_URL, base));
    expect(gebco.GEBCO_TILES.far).toBe(`${base}gebco/v${BASEMAP_VERSION}/far.pmtiles`);
    expect(gebco.GEBCO_TILES.core).toBe(`${base}gebco/v${BASEMAP_VERSION}/core.pmtiles`);
    expect(gebco.GEBCO_TILES.regional).toEqual([`${base}gebco/v${BASEMAP_VERSION}/core-sanctuaries.pmtiles`]);
    expect(gebco.GEBCO_TILES.contours).toBe(`${base}gebco/v${BASEMAP_VERSION}/contours.pmtiles`);
    expect(gebco.GEBCO_TILES.names).toBe(`${base}gebco/v${BASEMAP_VERSION}/names.pmtiles`);
    expect(gebco.GEBCO_TILES.land).toBe(`${base}osm/v${BASEMAP_VERSION}/land.pmtiles`);
  });
  it("keep a url from elsewhere and a null tier as they are", () => {
    expect(
      gebco.tilesAt(
        {
          core: "https://x/c.pmtiles",
          far: `${BASEMAP_URL}f.pmtiles`,
          contours: null,
          names: null,
          land: null,
        },
        BASEMAP_URL,
        "https://h/",
      ),
    ).toEqual({
      core: "https://x/c.pmtiles",
      far: "https://h/f.pmtiles",
      regional: undefined,
      contours: null,
      names: null,
      land: null,
    });
  });
});

describe("withSeaFloor (the package's composer on CARTO's own ids)", () => {
  it("navy is the dark sea floor, paper the light one", () => {
    expect(gebco.seaFloorTheme("navy")).toBe("dark");
    expect(gebco.seaFloorTheme("paper")).toBe("light");
  });
  it("an empty CARTO style (the fetch failed or has not landed) comes back untouched: the tiers never wait on CARTO", () => {
    const empty: CartoStyleLike = { sources: {}, layers: [] };
    expect(gebco.withSeaFloor(empty, "navy")).toBe(empty);
  });
  it("regression: a CARTO style held in Svelte $state (a Proxy, which structuredClone refuses) composes, and is kept per object", () => {
    const proxied = new Proxy(structuredClone(CARTO), {}) as CartoStyleLike;
    expect(() => structuredClone(proxied)).toThrow();
    const a = gebco.withSeaFloor(proxied, "navy");
    expect(a.layers?.some((l) => l.id === "gebco-relief")).toBe(true);
    expect(gebco.withSeaFloor(proxied, "navy")).toBe(a);
    expect(gebco.withSeaFloor(proxied, "navy", { underData: true })).not.toBe(a);
    expect(gebco.withSeaFloor(proxied, "paper")).not.toBe(a);
  });
  it("dims to DATA_DIM of the theme default under data", () => {
    expect(gebco.seaFloorOpacity("navy", false)).toBe(bathyDefaultOpacity("dark"));
    expect(gebco.seaFloorOpacity("paper", true)).toBeCloseTo(
      bathyDefaultOpacity("light") * gebco.DATA_DIM,
    );
    expect(gebco.DATA_DIM).toBeLessThan(1);
  });
});

describe("composeStyle with the sea floor", () => {
  for (const theme of ["navy", "paper"] as const) {
    const style = composeStyle({
      theme,
      basemapStyle: CARTO,
      layerStack: bathy(true),
      seaFloor: gebco,
    });
    const src = style.sources as Record<string, { type: string; url?: string }>;
    const base = store("basemap/");
    it(`${theme}: every tier is a source on the storage host, prefixed like CARTO's`, () => {
      expect(src[`${P}gebco-far`]).toMatchObject({
        type: "raster-dem",
        url: `pmtiles://${base}gebco/v${BASEMAP_VERSION}/far.pmtiles`,
      });
      expect(src[`${P}gebco`]).toMatchObject({
        type: "raster-dem",
        url: `pmtiles://${base}gebco/v${BASEMAP_VERSION}/core.pmtiles`,
      });
      expect(src[`${P}gebco-regional`]).toMatchObject({
        type: "raster-dem",
        url: `pmtiles://${base}gebco/v${BASEMAP_VERSION}/core-sanctuaries.pmtiles`,
      });
      expect(src[`${P}gebco-contours`]).toMatchObject({
        type: "vector",
        url: `pmtiles://${base}gebco/v${BASEMAP_VERSION}/contours.pmtiles`,
      });
      expect(src[`${P}gebco-names`]).toMatchObject({
        type: "vector",
        url: `pmtiles://${base}gebco/v${BASEMAP_VERSION}/names.pmtiles`,
      });
      expect(src[`${P}osm-land`]).toMatchObject({
        type: "vector",
        url: `pmtiles://${base}osm/v${BASEMAP_VERSION}/land.pmtiles`,
      });
    });
    it(`${theme}: the package's order inside the basemap run: the sea, far under core under regional, the isobaths, the mask, CARTO's land, the labels`, () => {
      const o = ids(style);
      const at = (id: string) => {
        const i = o.indexOf(P + id);
        expect(i, id).toBeGreaterThanOrEqual(0);
        return i;
      };
      expect(o[0]).toBe("background");
      expect(at("water")).toBeLessThan(at("gebco-far-relief"));
      expect(at("gebco-far-shade")).toBeLessThan(at("gebco-relief"));
      expect(at("gebco-shade")).toBeLessThan(at("gebco-regional-relief"));
      expect(at("gebco-regional-shade")).toBeLessThan(at("gebco-contour-0"));
      expect(at("gebco-contour-label")).toBeLessThan(at("land"));
      expect(at("land")).toBeLessThan(at("water-inland"));
      expect(at("water-inland")).toBeLessThan(at("landcover"));
      expect(at("road_major")).toBeLessThan(at("place_town"));
    });
  }

  it("the sea floor is the Bathymetry row; the isobaths' labels go with it, the undersea names are place labels", () => {
    for (const id of [
      "gebco-far-relief",
      "gebco-far-shade",
      "gebco-relief",
      "gebco-shade",
      "gebco-regional-relief",
      "gebco-regional-2-shade",
      "gebco-contour-0",
      "gebco-contour-3",
    ])
      expect(classifyBasemapLayer({ id, type: "line" }), id).toBe("basemap-bathymetry");
    expect(classifyBasemapLayer({ id: "gebco-contour-label", type: "symbol" })).toBe(
      "basemap-bathymetry",
    );
    expect(classifyBasemapLayer({ id: "gebco-names-1", type: "symbol" })).toBe("basemap-labels");
    expect(classifyBasemapLayer({ id: "land", type: "fill" })).toBe("basemap-land");
    expect(classifyBasemapLayer({ id: "water-inland", type: "fill" })).toBe("basemap-land");
  });

  it("the data draws over the whole basemap run, the sea floor and the mask included", () => {
    const s = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      layerStack: bathy(true),
      seaFloor: gebco,
      raster: RASTER,
    });
    const o = ids(s);
    expect(o.indexOf("eov-risk")).toBeGreaterThan(o.indexOf(`${P}land`));
    expect(o.indexOf("eov-risk")).toBeGreaterThan(o.indexOf(`${P}gebco-contour-label`));
  });

  it("dims the relief under a data layer (the package's opacity) and not without one", () => {
    const relief = (s: ReturnType<typeof composeStyle>) =>
      (
        s.layers.find((l) => l.id === `${P}gebco-relief`) as unknown as {
          paint: Record<string, number>;
        }
      ).paint["color-relief-opacity"];
    const plain = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      layerStack: bathy(true),
      seaFloor: gebco,
    });
    const under = composeStyle({
      theme: "navy",
      basemapStyle: CARTO,
      layerStack: bathy(true),
      seaFloor: gebco,
      raster: RASTER,
    });
    expect(relief(plain)).toBe(bathyDefaultOpacity("dark"));
    expect(relief(under)).toBeCloseTo(bathyDefaultOpacity("dark") * gebco.DATA_DIM);
  });

  it("the row's slider scales the relief's opacity and the shading's strength", () => {
    const s = composeStyle({
      theme: "paper",
      basemapStyle: CARTO,
      layerStack: bathy(true, 0.5),
      seaFloor: gebco,
    });
    const full = composeStyle({
      theme: "paper",
      basemapStyle: CARTO,
      layerStack: bathy(true),
      seaFloor: gebco,
    });
    const paint = (st: ReturnType<typeof composeStyle>, id: string) =>
      (st.layers.find((l) => l.id === P + id) as unknown as { paint: Record<string, number> })
        .paint;
    expect(paint(s, "gebco-relief")["color-relief-opacity"]).toBeCloseTo(
      paint(full, "gebco-relief")["color-relief-opacity"] * 0.5,
    );
    expect(paint(s, "gebco-shade")["hillshade-exaggeration"]).toBeCloseTo(
      paint(full, "gebco-shade")["hillshade-exaggeration"] * 0.5,
    );
  });

  it("the row off (or the composer not loaded yet, or no basemap) draws CARTO's own style: no tier is fetched", () => {
    for (const s of [
      composeStyle({
        theme: "navy",
        basemapStyle: CARTO,
        layerStack: bathy(false),
        seaFloor: gebco,
      }),
      composeStyle({ theme: "navy", basemapStyle: CARTO, layerStack: bathy(true), seaFloor: null }),
      composeStyle({ theme: "navy", basemapStyle: CARTO, layerStack: bathy(true) }),
    ]) {
      expect(Object.keys(s.sources)).toEqual([`${P}protomaps`]);
      expect(ids(s).some((id) => id.includes("gebco") || id === `${P}land`)).toBe(false);
    }
    expect(drawsSeaFloor({ seaFloor: gebco, layerStack: bathy(true), basemap: null })).toBe(false);
    expect(drawsSeaFloor({ seaFloor: gebco, layerStack: bathy(true) })).toBe(true);
    expect(drawsSeaFloor({ seaFloor: gebco, layerStack: bathy(false) })).toBe(false);
  });
});

describe("the credit line", () => {
  it("names GEBCO and the IHO-IOC gazetteer while the sea floor draws, CARTO and OSM always, OSM once", () => {
    expect(basemapAttribution(null)).toBe(BASEMAP_ATTRIBUTION);
    const on = basemapAttribution(gebco);
    expect(on).toBe(`${BASEMAP_ATTRIBUTION}; ${gebco.SEA_FLOOR_ATTRIBUTION}`);
    expect(on).toContain("GEBCO Compilation Group (2025) GEBCO 2025 Grid");
    expect(on).toContain("IHO-IOC GEBCO Gazetteer of Undersea Feature Names");
    expect(on.split("OpenStreetMap").length).toBe(2);
  });
});

describe("loadSeaFloor (the lazy chunk)", () => {
  it("loads once and shares the promise", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return gebco as SeaFloorModule;
    };
    const [a, b] = await Promise.all([loadSeaFloor(load), loadSeaFloor(load)]);
    expect(a).toBe(gebco);
    expect(b).toBe(gebco);
    expect(calls).toBe(1);
  });
  it("a chunk that fails resolves to null (CARTO's own style stays) and is asked again next time", async () => {
    let calls = 0;
    const bad = async (): Promise<SeaFloorModule> => {
      calls++;
      throw new Error("chunk 404");
    };
    expect(await loadSeaFloor(bad)).toBeNull();
    expect(await loadSeaFloor(async () => gebco as SeaFloorModule)).toBe(gebco);
    expect(calls).toBe(1);
  });
});
