import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  centroidsAssetOf,
  centroidsFromRows,
  readCentroids,
  type Centroids,
} from "../../src/lib/catalog/centroids";
import type { StacCollection } from "../../src/lib/catalog/types";
import {
  cellStats,
  fidsInside,
  fidsInsideAny,
  summarizePlace,
  summaryCsv,
  summaryRowOf,
  valueIndexOf,
} from "../../src/places/summary";
import { prepareArea } from "../../src/lib/geo/pip";
import type { AreaGeometry } from "../../src/lib/geo/types";

const box = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

// a 4 x 1 strip of cells with centroids at lon 0.5, 1.5, 2.5, 3.5 (lat 0.5)
const CENTROIDS: Centroids = {
  fids: Int32Array.from([10, 11, 12, 13]),
  lon: Float64Array.from([0.5, 1.5, 2.5, 3.5]),
  lat: Float64Array.from([0.5, 0.5, 0.5, 0.5]),
};

describe("cellStats: n, mean, min, max and the no-value share, with nulls", () => {
  it("nulls, undefined and NaN are no value: counted in n, left out of mean/min/max", () => {
    const s = cellStats([2, null, 4, undefined, Number.NaN, 6]);
    expect(s).toEqual({ n: 6, nValue: 3, noValueShare: 0.5, mean: 4, min: 2, max: 6 });
  });
  it("all no value: n counted, the statistics are null (never 0)", () => {
    expect(cellStats([null, null])).toEqual({
      n: 2,
      nValue: 0,
      noValueShare: 1,
      mean: null,
      min: null,
      max: null,
    });
  });
  it("zero is a value (a real zero is not 'no value')", () => {
    expect(cellStats([0, 0, null])).toMatchObject({ n: 3, nValue: 2, mean: 0, min: 0, max: 0 });
  });
  it("no cells at all: n 0 and a null share", () => {
    expect(cellStats([])).toMatchObject({ n: 0, noValueShare: null, mean: null });
  });
});

describe("cells inside a place (centroid test)", () => {
  it("picks exactly the cells whose centroid is inside", () => {
    expect(fidsInside(CENTROIDS, prepareArea(box(1, 0, 3, 1)))).toEqual([11, 12]);
  });
  it("a place that covers part of a cell does not count it unless the centroid is inside", () => {
    expect(fidsInside(CENTROIDS, prepareArea(box(0.9, 0, 1.4, 1)))).toEqual([]);
  });
  it("summarizePlace: stats of the item's values over those cells; a cell missing from the column is no value", () => {
    const col = { fids: [10, 11, 12], values: [1, 3, null] as (number | null)[] };
    const idx = valueIndexOf(col);
    const r = summarizePlace(CENTROIDS, box(0, 0, 4, 1), (f) => idx.get(f));
    expect(r.fids).toEqual([10, 11, 12, 13]);
    expect(r.stats).toEqual({ n: 4, nValue: 2, noValueShare: 0.5, mean: 2, min: 1, max: 3 });
  });
  it("fidsInsideAny: the union over several places, each cell once", () => {
    const set = fidsInsideAny(CENTROIDS, [box(0, 0, 2, 1), box(1, 0, 3, 1)]);
    expect([...set].sort()).toEqual([10, 11, 12]);
  });
  it("antimeridian: a cell at -179.5 is inside an unwrapped place spanning 179..181", () => {
    const c: Centroids = {
      fids: Int32Array.from([1, 2]),
      lon: Float64Array.from([-179.5, -170]),
      lat: Float64Array.from([5, 5]),
    };
    expect(fidsInside(c, prepareArea(box(179, 0, 181, 10)))).toEqual([1]);
  });
});

describe("summary rows and CSV", () => {
  it("a row is loading until stats exist; the CSV carries raw numbers and the item", () => {
    expect(summaryRowOf(0, "A", null).status).toBe("loading");
    const rows = [
      summaryRowOf(0, "Sanctuary, North", cellStats([1, 2, null])),
      summaryRowOf(1, "B", cellStats([])),
    ];
    const csv = summaryCsv(rows, "all_summer_richness").split("\r\n");
    expect(csv[0]).toBe("item,place,unit,n,mean,min,max,share_no_value");
    expect(csv[1]).toBe(
      'all_summer_richness,"Sanctuary, North",cells,3,1.5,1,2,0.3333333333333333',
    );
    expect(csv[2]).toBe("all_summer_richness,B,cells,0,,,,");
  });
});

describe("the hex_centroids table", () => {
  const FILE = join(__dirname, "../fixtures/catalog/biotrack_indicators/hex_centroids.parquet");
  const buf = () => {
    const b = readFileSync(FILE);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  it("reads FID, lon and lat of a parquet file", async () => {
    const res = await readCentroids(buf());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.value.fids]).toEqual([101, 102, 103]);
    expect(res.value.lon[0]).toBeCloseTo(-80.6);
    expect(res.value.lat[2]).toBeCloseTo(28.55);
  });
  it("rows with a non-finite key or coordinate are dropped; BigInt FIDs are numbers", () => {
    const c = centroidsFromRows([
      { FID: 1n, lon: 1, lat: 2 },
      { FID: null, lon: 1, lat: 2 },
      { FID: 3, lon: Number.NaN, lat: 2 },
      { FID: 4, lon: 5, lat: 6 },
    ]);
    expect([...c.fids]).toEqual([1, 4]);
  });
  it("the asset is read from the collection, resolved against its own URL", () => {
    const coll = {
      type: "Collection",
      id: "x",
      links: [],
      "atlas:url": "https://example.org/atlas/x/collection.json",
      assets: { hex_centroids: { href: "./hex_centroids.parquet" } },
    } as unknown as StacCollection;
    expect(centroidsAssetOf(coll)).toEqual({
      url: "https://example.org/atlas/x/hex_centroids.parquet",
      keyColumn: "FID",
    });
    expect(centroidsAssetOf({ ...coll, assets: {} })).toBeNull();
    expect(centroidsAssetOf(null)).toBeNull();
  });
});

import { formatShare, geometryKey, summaryLine, summaryRows } from "../../src/places/summary";

describe("the one-line summary under a place row", () => {
  const row = (stats: ReturnType<typeof cellStats> | null, unit: "cells" | "pixels" = "cells") =>
    summaryRowOf(0, "P", stats, unit);
  it("n, mean, min, max; a share of cells with no value is added only when it is not 0", () => {
    expect(summaryLine(row(cellStats([1, 2, 3])))).toBe("3 cells · mean 2 · min 1 · max 3");
    expect(summaryLine(row(cellStats([1, null, 3, null])))).toBe(
      "4 cells · mean 2 · min 1 · max 3 · 50% no value",
    );
  });
  it("one cell is singular; pixels say pixels", () => {
    expect(summaryLine(row(cellStats([0.5])))).toBe("1 cell · mean 0.5 · min 0.5 · max 0.5");
    expect(summaryLine(row({ ...cellStats([1, 3]) }, "pixels"))).toBe(
      "2 pixels · mean 2 · min 1 · max 3",
    );
  });
  it("an empty place and an all-no-value place say so, never 0 or NaN", () => {
    expect(summaryLine(row(cellStats([])))).toBe("No cells inside this place.");
    expect(summaryLine(row(cellStats([null, null])))).toBe("2 cells · no values");
  });
  it("loading and error rows say so", () => {
    expect(summaryLine(row(null))).toBe("Summarising…");
    expect(
      summaryLine({ ...row(null), status: "error", message: "couldn't load this place" }),
    ).toBe("No summary: couldn't load this place.");
  });
  it("shares: whole percents, and <1% for a sliver", () => {
    expect(formatShare(0.5)).toBe("50%");
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(null)).toBe("");
  });
});

describe("rows for a list of places", () => {
  const g = box(0, 0, 1, 1);
  it("one row per place, index-aligned: ready ones get stats, loading ones wait, unresolvable ones say why", () => {
    const rows = summaryRows(
      [
        { name: "A", state: "ready", geometry: g },
        { name: "B", state: "loading" },
        { name: "C", state: "none", reason: "uploaded without geometry in this session" },
      ],
      (_p, i) => cellStats([i + 1]),
    );
    expect(rows.map((r) => [r.index, r.name, r.status])).toEqual([
      [0, "A", "ok"],
      [1, "B", "loading"],
      [2, "C", "error"],
    ]);
    expect(rows[0].mean).toBe(1);
    expect(rows[2].message).toMatch(/uploaded/);
  });
  it("the same geometry decoded twice has the same cache key; a different one does not", () => {
    expect(geometryKey(box(0, 0, 1, 1))).toBe(geometryKey(box(0, 0, 1, 1)));
    expect(geometryKey(box(0, 0, 1, 1))).not.toBe(geometryKey(box(0, 0, 1, 2)));
  });
});
