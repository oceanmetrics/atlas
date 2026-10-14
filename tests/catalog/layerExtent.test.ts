// WP14: which frame "Zoom to layer" and auto-zoom fit, one case per kind of item and the fallback.
import { describe, expect, it } from "vitest";
import { layerExtent } from "../../src/lib/catalog/layerExtent";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";

const COG = "image/tiff; application=geotiff; profile=cloud-optimized";
const collection = {
  type: "Collection",
  id: "c",
  links: [],
  extent: { spatial: { bbox: [[-100, 20, -60, 50]] } },
} as unknown as StacCollection;
const bare = { type: "Collection", id: "c", links: [] } as unknown as StacCollection;

const cogItem = (bbox?: number[]) =>
  ({
    type: "Feature",
    id: "i",
    properties: {},
    links: [],
    ...(bbox ? { bbox } : {}),
    assets: { data: { href: "https://x/y.tif", type: COG, roles: ["data"] } },
  }) as unknown as StacItem;
const hexItem = (bbox?: number[]) =>
  ({
    type: "Feature",
    id: "h",
    properties: {},
    links: [],
    ...(bbox ? { bbox } : {}),
    assets: {
      values: { href: "https://x/v.parquet", type: "application/vnd.apache.parquet" },
    },
  }) as unknown as StacItem;

describe("layerExtent", () => {
  it("a hex item: the collection's extent (an item box does not narrow a shared grid)", () => {
    const e = layerExtent({ item: hexItem([0, 0, 1, 1]), collection });
    expect(e?.source).toBe("collection");
    expect(e?.bounds).toEqual([
      [-100, 20],
      [-60, 50],
    ]);
  });
  it("a registry AquaMaps item: the box of the surface it draws (its bbox), ahead of the collection", () => {
    const e = layerExtent({ item: cogItem([-180, -62.1, 180, 79.65]), collection });
    expect(e?.source).toBe("item");
    expect(e?.bounds).toEqual([
      [-180, -62.1],
      [180, 79.65],
    ]);
    // the 0.05 degree surface states its own box
    const e2 = layerExtent({ item: cogItem([-120, 10, -70, 50]), collection });
    expect(e2?.bounds).toEqual([
      [-120, 10],
      [-70, 50],
    ]);
  });
  it("an nc / gm COG with no box: its cached /cog/info.geojson footprint", () => {
    const e = layerExtent({ item: cogItem(), collection, cogBounds: [-87, 23, -52, 53.3] });
    expect(e?.source).toBe("cog");
    expect(e?.bounds).toEqual([
      [-87, 23],
      [-52, 53.3],
    ]);
  });
  it("a COG whose footprint is not known yet (or unreadable): the collection's extent", () => {
    expect(layerExtent({ item: cogItem(), collection, cogBounds: null })?.source).toBe(
      "collection",
    );
    expect(layerExtent({ item: cogItem(), collection })?.bounds[0]).toEqual([-100, 20]);
  });
  it("a box that crosses the antimeridian is re-expressed with east + 360", () => {
    const e = layerExtent({ item: cogItem([170, 50, -160, 70]), collection });
    expect(e?.bounds).toEqual([
      [170, 50],
      [200, 70],
    ]);
  });
  it("nothing usable anywhere: null (the button is disabled)", () => {
    expect(layerExtent({ item: cogItem(), collection: bare })).toBeNull();
    expect(layerExtent({ item: hexItem(), collection: bare })).toBeNull();
    expect(layerExtent({ item: null, collection: bare })).toBeNull();
  });
  it("a hex item in a collection with no extent falls back to its own box", () => {
    expect(layerExtent({ item: hexItem([-10, 10, 10, 30]), collection: bare })?.source).toBe(
      "item",
    );
  });
});
