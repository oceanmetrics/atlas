// A collection's own vector overlays through the REAL runes-based lens state (the "runes" project of
// vitest.config.ts): `atlas:overlays` lists them, `cov=` says which are on (else the defaults), a toggle
// writes the URL and lands back on "absent" at the defaults, "Only features matching the selected layer"
// (`covf=1`) filters by the Item's `atlas:overlay_filter`, another collection starts from its own defaults,
// and the hover/click interaction is a lazy chunk installed once an overlay is on. The synthetic catalog
// (tests/fixtures/catalog/) with overlays added to its raster collection.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionLens } from "../../../src/lens/collection/state.svelte";
import type { CollectionOverlayInteractionOptions } from "../../../src/lens/collection/overlayInteraction";
import type { MapHandle } from "../../../src/lib/map/map";
import { FIXTURE_BASE, fakeFetch, jsonResponse } from "../../catalog/support";

vi.mock("../../../src/lib/map/layers/rasterValue", async (orig) => ({
  ...(await orig<typeof import("../../../src/lib/map/layers/rasterValue")>()),
  installRasterInteraction: () => ({ destroy: () => undefined }),
}));
const installed: { opts: CollectionOverlayInteractionOptions | null; count: number } = {
  opts: null,
  count: 0,
};
vi.mock("../../../src/lens/collection/overlayInteraction", () => ({
  installCollectionOverlayInteraction: (
    _map: unknown,
    opts: CollectionOverlayInteractionOptions,
  ) => {
    installed.opts = opts;
    installed.count++;
    return { destroy: () => void (installed.opts = null) };
  },
}));

const { createCollectionLens } = await import("../../../src/lens/collection/state.svelte");
const { createSelStore } = await import("../../../src/lib/state/sel.svelte");

const ROOT = join(__dirname, "../../fixtures/catalog");
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const PM = "application/vnd.pmtiles";
const OVERLAYS = [
  {
    id: "sightings_vessel",
    title: "Vessel sightings",
    asset: "sightings_vessel",
    source_layer: "sightings_vessel",
    geometry: "point",
    color: "#c51b7d",
    default: true,
    filter_field: "models",
  },
  {
    id: "effort_vessel",
    title: "Vessel effort",
    asset: "effort_vessel",
    source_layer: "effort_vessel",
    geometry: "line",
    color: "#4d4d4d",
    default: true,
  },
  {
    id: "hexagons",
    title: "Model hexagons",
    asset: "hexagons",
    source_layer: "hexagons",
    geometry: "polygon",
    color: "#777777",
  },
];

function override(url: string): Response | undefined {
  if (url === `${FIXTURE_BASE}aquamaps_eov/collection.json`) {
    const c = readJson("aquamaps_eov/collection.json");
    c["atlas:overlays"] = OVERLAYS;
    c.assets = {
      ...c.assets,
      sightings_vessel: { href: "./overlays/sightings_vessel.pmtiles", type: PM },
      effort_vessel: { href: "./overlays/effort_vessel.pmtiles", type: PM },
      hexagons: { href: "./overlays/hexagons.pmtiles", type: PM },
    };
    return jsonResponse(c);
  }
  if (url === `${FIXTURE_BASE}aquamaps_eov/items/fish_risk.json`) {
    const it = readJson("aquamaps_eov/items/fish_risk.json");
    it.properties["atlas:overlay_filter"] = { field: "models", token: "rices_whale" };
    return jsonResponse(it);
  }
  return undefined;
}

let lens: CollectionLens;
let selStore: ReturnType<typeof createSelStore>;
let stop: () => void;
const settle = (check: () => void) =>
  vi.waitFor(() => {
    flushSync();
    check();
  });

beforeEach(async () => {
  vi.stubGlobal("history", { state: null, replaceState: () => undefined });
  installed.opts = null;
  installed.count = 0;
  // a map that answers every call the hex painter and interaction make with nothing
  const map = {
    on: () => undefined,
    off: () => undefined,
    getSource: () => undefined,
    setFeatureState: () => undefined,
    getCanvas: () => ({ style: { cursor: "" } }),
    queryRenderedFeatures: () => [],
  };
  const handle = {
    map,
    camera: () => ({ lon: 0, lat: 0, zoom: 2 }),
    flyTo: vi.fn(),
    flyToBounds: vi.fn(),
  } as unknown as MapHandle;
  selStore = createSelStore({
    search: `?c=aquamaps_eov&i=fish_risk&catalog=${encodeURIComponent(FIXTURE_BASE)}`,
    hash: "",
    pathname: "/",
  });
  stop = $effect.root(() => {
    lens = createCollectionLens({
      selStore,
      mapHandle: () => handle,
      loadOptions: { base: FIXTURE_BASE, fetchImpl: fakeFetch(override).fetch, cache: new Map() },
      valueSource: { pointValue: async () => 1, pointValues: async () => ({ values: [] }) },
      cogExtent: { get: async () => null, size: 0, requests: 0 },
      histogram: { get: async () => null, size: 0, clear: () => undefined },
      rescale: { get: async () => null, size: 0, clear: () => undefined },
      storage: null,
    });
  });
  await settle(() => {
    expect(lens.entry?.id).toBe("aquamaps_eov");
    expect(lens.item?.id).toBe("fish_risk");
  });
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

const layerIds = () => (lens.mapInputs.overlays?.layers ?? []).map((l) => l.layer.id);

describe("the lens draws a collection's own overlays", () => {
  it("lists them in the collection's order; the defaults are on with no cov= in the URL", () => {
    expect(lens.overlays.map((o) => [o.spec.id, o.on])).toEqual([
      ["sightings_vessel", true],
      ["effort_vessel", true],
      ["hexagons", false],
    ]);
    // bottom first: effort under sightings
    expect(layerIds()).toEqual(["cov-effort_vessel-line", "cov-sightings_vessel-circle"]);
  });

  it("a toggle writes cov=, several can be on at once, and the defaults again are absent", () => {
    lens.toggleOverlay("hexagons", true);
    flushSync();
    expect(selStore.sel.cov).toEqual(["sightings_vessel", "effort_vessel", "hexagons"]);
    expect(layerIds()).toEqual([
      "cov-hexagons-fill",
      "cov-hexagons-outline",
      "cov-effort_vessel-line",
      "cov-sightings_vessel-circle",
    ]);
    lens.toggleOverlay("hexagons", false);
    flushSync();
    expect(selStore.sel.cov).toBeUndefined();
    lens.toggleOverlay("sightings_vessel", false);
    lens.toggleOverlay("effort_vessel", false);
    flushSync();
    expect(selStore.sel.cov).toEqual([]);
    expect(lens.mapInputs.overlays).toBeNull();
  });

  it("covf=1 filters the overlays whose filter_field is the Item's atlas:overlay_filter field", () => {
    expect(lens.overlayFilter).toMatchObject({ offered: true, enabled: true, on: false });
    lens.setOverlayFilter(true);
    flushSync();
    expect(selStore.sel.covf).toBe(true);
    const filterOf = (id: string) =>
      (
        lens.mapInputs.overlays!.layers.find((l) => l.layer.id === id)!.layer as {
          filter?: unknown;
        }
      ).filter;
    expect(JSON.stringify(filterOf("cov-sightings_vessel-circle"))).toContain("|rices_whale|");
    expect(filterOf("cov-effort_vessel-line")).toBeUndefined();
    lens.setOverlayFilter(false);
    flushSync();
    expect(selStore.sel.covf).toBeUndefined();
  });

  it("installs the lazy hover/click interaction with the overlays that are on, top first", async () => {
    await settle(() => expect(installed.opts).not.toBeNull());
    expect(installed.opts!.overlays().map((s) => s.id)).toEqual([
      "sightings_vessel",
      "effort_vessel",
    ]);
    lens.toggleOverlay("sightings_vessel", false);
    flushSync();
    expect(installed.opts!.overlays().map((s) => s.id)).toEqual(["effort_vessel"]);
    // nothing on: uninstalled
    lens.toggleOverlay("effort_vessel", false);
    flushSync();
    expect(installed.opts).toBeNull();
  });

  it("another collection starts from its own defaults (cov and covf are dropped)", async () => {
    lens.toggleOverlay("hexagons", true);
    lens.setOverlayFilter(true);
    flushSync();
    lens.selectCollection("biotrack_indicators");
    await settle(() => expect(lens.entry?.id).toBe("biotrack_indicators"));
    expect(selStore.sel.cov).toBeUndefined();
    expect(selStore.sel.covf).toBeUndefined();
    expect(lens.overlays).toEqual([]);
    expect(lens.mapInputs.overlays ?? null).toBeNull();
  });
});
