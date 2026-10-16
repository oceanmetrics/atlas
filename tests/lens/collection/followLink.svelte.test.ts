// Following an Atlas link from the species table (`lens.followLink`), the carried clicked point, the way back
// (`lens.returnTo`, `lens.goBack`) and the auto-zoom preference on a follow. This runs the REAL runes-based lens
// state (the "runes" project of vitest.config.ts) on the synthetic catalog (tests/fixtures/catalog/) plus a
// second raster collection, `twin`, standing in for the AquaMaps native taxon the link opens. The map is a stub
// that records the camera moves; the raster click interaction is captured so a test can "click" a position.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CollectionLens } from "../../../src/lens/collection/state.svelte";
import type { RasterInteractionOptions } from "../../../src/lib/map/layers/rasterValue";
import type { MapHandle } from "../../../src/lib/map/map";
import type { ValueSource } from "../../../src/lib/raster/point";
import type { MapView } from "../../../src/lib/state/types";
import { FIXTURE_BASE, fakeFetch, jsonResponse } from "../../catalog/support";

const captured: { opts: RasterInteractionOptions | null } = { opts: null };
vi.mock("../../../src/lib/map/layers/rasterValue", async (orig) => ({
  ...(await orig<typeof import("../../../src/lib/map/layers/rasterValue")>()),
  installRasterInteraction: (_map: unknown, opts: RasterInteractionOptions) => {
    captured.opts = opts;
    return { destroy: () => void (captured.opts = null) };
  },
}));

const { createCollectionLens } = await import("../../../src/lens/collection/state.svelte");
const { createSelStore } = await import("../../../src/lib/state/sel.svelte");

// --- the `twin` raster collection: the eov collection without its flower and species hooks, one item whose
// frame is a small box (so a follow changes the frame, as a species' range does) --------------------------
const ROOT = join(__dirname, "../../fixtures/catalog");
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
function twinOverride(url: string): Response | undefined {
  if (url === `${FIXTURE_BASE}catalog.json`) {
    const cat = readJson("catalog.json");
    cat.links.push({ rel: "child", href: "./twin/collection.json", title: "Twin" });
    return jsonResponse(cat);
  }
  if (url === `${FIXTURE_BASE}twin/collection.json`) {
    const c = readJson("aquamaps_eov/collection.json");
    delete c["atlas:flower"];
    delete c["atlas:cell_species"];
    c.id = "twin";
    c.title = "Twin";
    c.links = [
      ...c.links.filter((l: { rel: string }) => l.rel !== "item"),
      { rel: "item", href: "./items/t1.json", type: "application/geo+json" },
    ];
    return jsonResponse(c);
  }
  if (url === `${FIXTURE_BASE}twin/items/t1.json`) {
    const it = readJson("aquamaps_eov/items/fish_risk.json");
    it.id = "t1";
    it.collection = "twin";
    it.bbox = [-90, 20, -80, 30];
    it.assets.cog["atlas:bidx"] = 1;
    it.assets.cog.href = "../twin.tif";
    it.assets.cog["raster:bands"] = it.assets.cog["raster:bands"].slice(0, 1);
    return jsonResponse(it);
  }
  return undefined;
}

// bands 1..9 of the eov COG: all, fish, ...; the twin item reads one band
const BANDS = [50, 80, 60, 40, 20, null, null, 50, 5];
const CLICK: [number, number] = [-86.73, 21.62];
const CAMERA: MapView = { lon: -86, lat: 22, zoom: 6.5 };

let lens: CollectionLens;
let selStore: ReturnType<typeof createSelStore>;
let stop: () => void;
let flyTo: ReturnType<typeof vi.fn>;
let flyToBounds: ReturnType<typeof vi.fn>;
let pointValue: Mock<ValueSource["pointValue"]>;
let pointValues: Mock<ValueSource["pointValues"]>;

/** every camera move the lens asked for since the last `moves.clear()`. */
const moves = () => flyTo.mock.calls.length + flyToBounds.mock.calls.length;
const settle = (check: () => void) =>
  vi.waitFor(() => {
    flushSync();
    check();
  });
const ready = (id: string) =>
  settle(() => {
    expect(lens.entry?.id).toBe(id);
    expect(lens.item).not.toBeNull();
  });
/** a click on the raster layer at CLICK, answered with `value`. */
function click(value: number | null) {
  const o = captured.opts!;
  o.onClickStart(CLICK);
  o.onClickValue(CLICK, value);
  flushSync();
}

beforeEach(async () => {
  vi.stubGlobal("history", { state: null, replaceState: () => undefined });
  flyTo = vi.fn();
  flyToBounds = vi.fn();
  pointValue = vi.fn<ValueSource["pointValue"]>(async () => 42);
  pointValues = vi.fn<ValueSource["pointValues"]>(async () => ({ values: BANDS }));
  const handle = { map: {}, camera: () => CAMERA, flyTo, flyToBounds } as unknown as MapHandle;
  selStore = createSelStore({
    search: `?c=aquamaps_eov&i=fish_risk&catalog=${encodeURIComponent(FIXTURE_BASE)}`,
    hash: "",
    pathname: "/",
  });
  stop = $effect.root(() => {
    lens = createCollectionLens({
      selStore,
      mapHandle: () => handle,
      loadOptions: {
        base: FIXTURE_BASE,
        fetchImpl: fakeFetch(twinOverride).fetch,
        cache: new Map(),
      },
      valueSource: { pointValue, pointValues },
      cogExtent: { get: async () => null, size: 0, requests: 0 },
      histogram: { get: async () => null, size: 0, clear: () => undefined },
      rescale: { get: async () => null, size: 0, clear: () => undefined },
      storage: null,
    });
  });
  await ready("aquamaps_eov");
  await settle(() => expect(captured.opts).not.toBeNull());
  flyTo.mockClear();
  flyToBounds.mockClear();
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

describe("the clicked point across a followed link", () => {
  it("is carried to the new collection and re-read there, not dropped", async () => {
    click(80);
    expect(lens.point?.value).toBe(80);
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    // the same pixel, now the twin item's value (one band read at the click position)
    await settle(() => expect(lens.point?.value).toBe(42));
    expect(lens.point).toMatchObject({
      collection: "twin",
      item: "t1",
      lngLat: CLICK,
      loading: false,
    });
    expect(pointValue).toHaveBeenCalledTimes(1);
    expect(pointValue.mock.calls[0][0]).toMatchObject({ lon: CLICK[0], lat: CLICK[1] });
  });

  it("a plain selectCollection still drops the point", async () => {
    click(80);
    lens.selectCollection("twin");
    await ready("twin");
    expect(lens.point).toBeNull();
    expect(pointValue).not.toHaveBeenCalled();
  });

  it("is not carried after the cell is cleared, or into a follow that finds no point", async () => {
    click(80);
    lens.clearCell();
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    expect(lens.point).toBeNull();
    expect(pointValue).not.toHaveBeenCalled();
  });
});

describe("returnTo and goBack", () => {
  it("followLink records the layer, camera and label it left", async () => {
    const label = lens.itemTitle;
    expect(label).toBeTruthy();
    lens.followLink({ c: "twin", i: undefined, sp: "Fis-1", rep: "005", map: CAMERA });
    expect(lens.returnTo).toEqual({
      sel: { c: "aquamaps_eov", i: "fish_risk", sp: undefined, rep: "native" },
      camera: CAMERA,
      label,
      target: "twin",
    });
    expect(selStore.sel).toMatchObject({ c: "twin", sp: "Fis-1", rep: "005" });
  });

  it("goBack restores the layer, flies to the saved camera (once, key back), clears returnTo and carries the point", async () => {
    click(80);
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    await settle(() => expect(lens.point?.value).toBe(42));
    // the follow with auto-zoom on flew to the twin's frame
    expect(flyToBounds).toHaveBeenCalledTimes(1);
    flyTo.mockClear();
    flyToBounds.mockClear();

    lens.goBack();
    expect(lens.returnTo).toBeNull();
    expect(selStore.sel).toMatchObject({
      c: "aquamaps_eov",
      i: "fish_risk",
      sp: undefined,
      rep: "native",
    });
    expect(flyTo).toHaveBeenCalledWith({
      key: "back",
      lon: CAMERA.lon,
      lat: CAMERA.lat,
      zoom: CAMERA.zoom,
    });
    await ready("aquamaps_eov");
    // the flower's collection reads every band of the pixel; fish is band 2
    await settle(() => expect(lens.point?.value).toBe(80));
    expect(lens.point?.flower).not.toBeNull();
    // the layer we returned to is in another frame, and auto-zoom is on, yet the back flight stands alone
    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyToBounds).not.toHaveBeenCalled();

    // the skip was for that one change only: a later change of frame flies again
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    await settle(() => expect(flyToBounds).toHaveBeenCalledTimes(1));
  });

  it("returnTo ends on a manual collection switch, another c, or leaving the lens", async () => {
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    expect(lens.returnTo).not.toBeNull();
    lens.selectCollection("biotrack_indicators");
    expect(lens.returnTo).toBeNull();

    lens.selectCollection("twin");
    await ready("twin");
    lens.followLink({ c: "aquamaps_eov", i: "fish_risk", map: CAMERA });
    await ready("aquamaps_eov");
    expect(lens.returnTo).not.toBeNull();
    selStore.set({ c: "twin" }); // not the collection the link opened
    flushSync();
    expect(lens.returnTo).toBeNull();

    lens.followLink({ c: "aquamaps_eov", i: "fish_risk", map: CAMERA });
    await ready("aquamaps_eov");
    expect(lens.returnTo).not.toBeNull();
    selStore.set({ lens: "species" });
    flushSync();
    expect(lens.returnTo).toBeNull();
  });
});

describe("the auto-zoom preference on a follow", () => {
  it("off: the camera stays where it is", async () => {
    lens.setAutoZoom(false);
    click(80);
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    await settle(() => expect(lens.point?.value).toBe(42));
    expect(moves()).toBe(0);
  });

  it("on: the camera flies to the new layer's frame", async () => {
    expect(lens.autoZoom).toBe(true);
    lens.followLink({ c: "twin", i: undefined, map: CAMERA });
    await ready("twin");
    await settle(() => expect(flyToBounds).toHaveBeenCalledTimes(1));
    expect(flyTo).not.toHaveBeenCalled();
  });
});
