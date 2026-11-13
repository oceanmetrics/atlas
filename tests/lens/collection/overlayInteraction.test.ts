// A click on a collection's own overlays (src/lens/collection/overlayInteraction.ts): which features, in
// which order, and the ONE-popup rule with the hex cell, the raster card and the gazetteer's place layers
// (src/lib/map/clickInfo.ts). The MapLibre popup itself is not exercised here (no DOM in this project; the
// e2e spec clicks a real one): reaching the end of a handler without a throw proves none was built.
import { afterEach, describe, expect, it } from "vitest";
import type { CollectionOverlaySpec } from "../../../src/lib/catalog/overlays";
import {
  HIT_SLACK_PX,
  installCollectionOverlayInteraction,
  overlayHitsAt,
  type OverlayMapLike,
} from "../../../src/lens/collection/overlayInteraction";
import { lensOverlayAt, overlayAt, registerOverlayProbe } from "../../../src/lib/map/clickInfo";
import {
  installOverlayInteraction,
  type OverlayMapLike as PlaceMapLike,
} from "../../../src/places/overlayInteraction";

const spec = (id: string, geometry: CollectionOverlaySpec["geometry"]): CollectionOverlaySpec => ({
  id,
  title: id,
  asset: id,
  url: `https://data.test/${id}.pmtiles`,
  sourceLayer: id,
  geometry,
  color: "#c51b7d",
  default: true,
  labelField: null,
  fields: null,
  fieldLabels: {},
  filterField: null,
});
const SIGHTINGS = spec("sightings_vessel", "point");
const EFFORT = spec("effort_vessel", "line");
const HEXAGONS = spec("hexagons", "polygon");
const TOP_FIRST = [SIGHTINGS, EFFORT, HEXAGONS];

type Query = { geometry: unknown; layers: string[] };

/** a fake map: features per layer id; records what was asked. */
function fakeMap(
  byLayer: Record<string, Record<string, unknown>[]>,
  opts: { throws?: boolean } = {},
) {
  const queries: Query[] = [];
  const listeners = new Map<string, (e: never) => void>();
  const map: OverlayMapLike = {
    getLayer: (id) => (id in byLayer ? {} : undefined),
    queryRenderedFeatures: (geometry, o) => {
      if (opts.throws) throw new Error("style swap");
      queries.push({ geometry, layers: o.layers });
      // MapLibre answers top layer first; the fake answers in reverse of the request, to prove the
      // grouping follows the collection's order and not the engine's
      return [...o.layers]
        .reverse()
        .flatMap((id) => (byLayer[id] ?? []).map((properties) => ({ layer: { id }, properties })));
    },
    on: (type, l) => void listeners.set(type, l),
    off: (type) => void listeners.delete(type),
    getCanvas: () => ({ style: { cursor: "" } }),
  };
  return { map, queries, listeners };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("overlayHitsAt", () => {
  const layers = {
    "cov-sightings_vessel-circle": [{ sightid: 1 }, { sightid: 2 }],
    "cov-effort_vessel-line": [{ seg: 9 }, { seg: 9 }], // one segment split across two tiles
    "cov-hexagons-fill": [{ FID: 100 }],
  };

  it("groups by overlay in the collection's order (top first), each feature once", () => {
    const { map } = fakeMap(layers);
    const hits = overlayHitsAt(map, { x: 50, y: 50 }, TOP_FIRST);
    expect(hits.map((h) => [h.spec.id, h.properties])).toEqual([
      ["sightings_vessel", { sightid: 1 }],
      ["sightings_vessel", { sightid: 2 }],
      ["effort_vessel", { seg: 9 }],
      ["hexagons", { FID: 100 }],
    ]);
  });

  it("points and lines in a small box around the click, polygons at the exact point", () => {
    const { map, queries } = fakeMap(layers);
    overlayHitsAt(map, { x: 50, y: 50 }, TOP_FIRST);
    expect(queries).toEqual([
      {
        geometry: [
          [50 - HIT_SLACK_PX, 50 - HIT_SLACK_PX],
          [50 + HIT_SLACK_PX, 50 + HIT_SLACK_PX],
        ],
        layers: ["cov-sightings_vessel-circle", "cov-effort_vessel-line"],
      },
      { geometry: { x: 50, y: 50 }, layers: ["cov-hexagons-fill"] },
    ]);
    expect(HIT_SLACK_PX).toBeGreaterThanOrEqual(5);
    expect(HIT_SLACK_PX).toBeLessThanOrEqual(8);
  });

  it("an overlay whose layer is not on the map is skipped; nothing on is no query at all", () => {
    const { map, queries } = fakeMap({ "cov-hexagons-fill": [{ FID: 1 }] });
    expect(overlayHitsAt(map, { x: 0, y: 0 }, TOP_FIRST).map((h) => h.spec.id)).toEqual([
      "hexagons",
    ]);
    expect(queries).toHaveLength(1);
    const empty = fakeMap({});
    expect(overlayHitsAt(empty.map, { x: 0, y: 0 }, TOP_FIRST)).toEqual([]);
    expect(empty.queries).toEqual([]);
  });

  it("a query racing a style swap is no hit", () => {
    const { map } = fakeMap(layers, { throws: true });
    expect(overlayHitsAt(map, { x: 0, y: 0 }, TOP_FIRST)).toEqual([]);
  });
});

describe("the one-popup rule", () => {
  it("installed, it is a LENS probe: overlayAt and lensOverlayAt see its features; destroyed, they do not", () => {
    const { map } = fakeMap({ "cov-sightings_vessel-circle": [{ sightid: 1 }] });
    const ix = installCollectionOverlayInteraction(map, { overlays: () => TOP_FIRST, doc: null });
    expect(overlayAt({ x: 1, y: 1 })).toBe(true);
    expect(lensOverlayAt({ x: 1, y: 1 })).toBe(true);
    ix.destroy();
    expect(overlayAt({ x: 1, y: 1 })).toBe(false);
    expect(lensOverlayAt({ x: 1, y: 1 })).toBe(false);
  });

  it("while a place pick session owns the map (or another lens shows), it hits nothing", () => {
    let owned = true;
    const { map } = fakeMap({ "cov-sightings_vessel-circle": [{ sightid: 1 }] });
    const ix = installCollectionOverlayInteraction(map, {
      overlays: () => TOP_FIRST,
      isOwned: () => owned,
      doc: null,
    });
    expect(lensOverlayAt({ x: 1, y: 1 })).toBe(false);
    owned = false;
    expect(lensOverlayAt({ x: 1, y: 1 })).toBe(true);
    ix.destroy();
  });

  it("a click where no feature is opens nothing (and builds no popup)", () => {
    const { map, listeners } = fakeMap({});
    const ix = installCollectionOverlayInteraction(map, { overlays: () => TOP_FIRST, doc: null });
    listeners.get("click")?.({ point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } } as never);
    listeners.get("mousemove")?.({ point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } } as never);
    ix.destroy();
  });

  it("a gazetteer place under a collection's feature stays quiet: its card is not built", () => {
    // the place layer answers a feature at every point; a place card would need a DOM and throw here
    const listeners = new Map<string, (e: never) => void>();
    const placeMap: PlaceMapLike = {
      getLayer: () => ({}),
      queryRenderedFeatures: () => [
        {
          properties: { name: "Flower Garden Banks", place_id: "NMS:FGB" },
          geometry: { type: "Polygon" },
        },
      ],
      on: (t, l) => void listeners.set(t, l),
      off: (t) => void listeners.delete(t),
      getCanvas: () => ({ style: { cursor: "" } }),
    };
    const places = installOverlayInteraction(placeMap, {
      hitLayerIds: () => ["ov-noaa_sanctuaries-fill"],
      onAdd: () => {},
    });
    cleanups.push(() => places.destroy());
    cleanups.push(registerOverlayProbe(() => true, { lens: true }));
    const ev = { point: { x: 1, y: 1 }, lngLat: { lng: -93.6, lat: 27.9 } } as never;
    listeners.get("click")?.(ev);
    listeners.get("mousemove")?.(ev);
  });
});
