import { describe, expect, it } from "vitest";
import { pointInRing, pointOnSurface, ringCentroid } from "../../src/report/pointOnSurface";
import type { AreaGeometry, Ring } from "../../src/lib/geo/types";

const SQUARE: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

describe("ringCentroid", () => {
  it("is the geometric center of a square", () => {
    expect(ringCentroid(SQUARE)).toEqual([5, 5]);
  });
});

describe("pointInRing", () => {
  it("true inside, false outside", () => {
    expect(pointInRing([5, 5], SQUARE)).toBe(true);
    expect(pointInRing([15, 5], SQUARE)).toBe(false);
  });
});

describe("pointOnSurface", () => {
  it("returns the centroid for a convex polygon (already inside)", () => {
    const geom: AreaGeometry = { type: "Polygon", coordinates: [SQUARE] };
    expect(pointOnSurface(geom)).toEqual([5, 5]);
  });

  it("falls back to a boundary vertex for a concave (C-shaped) ring whose centroid falls outside it", () => {
    // a "C" shape: centroid of the vertex mean would land in the open notch, well outside the ring.
    const c: Ring = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 8],
      [10, 8],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const geom: AreaGeometry = { type: "Polygon", coordinates: [c] };
    const pt = pointOnSurface(geom);
    // must be a real ring vertex (guaranteed on the boundary), not an invented interior point.
    expect(c.some(([x, y]) => x === pt[0] && y === pt[1])).toBe(true);
  });

  it("picks the larger part of a MultiPolygon", () => {
    const small: Ring = [
      [100, 100],
      [101, 100],
      [101, 101],
      [100, 101],
      [100, 100],
    ];
    const geom: AreaGeometry = { type: "MultiPolygon", coordinates: [[SQUARE], [small]] };
    expect(pointOnSurface(geom)).toEqual([5, 5]);
  });
});
