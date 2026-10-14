import { describe, expect, it } from "vitest";
import { pointInGeometry, pointInRing, prepareArea, pointInArea } from "../../src/lib/geo/pip";
import type { AreaGeometry, Ring } from "../../src/lib/geo/types";

const square = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

describe("pointInRing", () => {
  it("convex: inside, outside, and a closed or open ring give the same answer", () => {
    const ring = square(0, 0, 10, 10);
    expect(pointInRing(5, 5, ring)).toBe(true);
    expect(pointInRing(11, 5, ring)).toBe(false);
    expect(pointInRing(5, -1, ring)).toBe(false);
    expect(pointInRing(5, 5, ring.slice(0, -1))).toBe(true);
  });
  it("concave (a U): the notch is outside, the arms inside", () => {
    //  x: 0..9, y: 0..9; the notch is x 3..6, y 3..9 (open at the top)
    const u: Ring = [
      [0, 0],
      [9, 0],
      [9, 9],
      [6, 9],
      [6, 3],
      [3, 3],
      [3, 9],
      [0, 9],
      [0, 0],
    ];
    expect(pointInRing(1, 8, u)).toBe(true); // left arm
    expect(pointInRing(8, 8, u)).toBe(true); // right arm
    expect(pointInRing(1, 1, u)).toBe(true); // base
    expect(pointInRing(4.5, 8, u)).toBe(false); // inside the notch
    expect(pointInRing(4.5, 1, u)).toBe(true); // under the notch
  });
});

describe("pointInGeometry", () => {
  it("a hole is outside the polygon", () => {
    const g: AreaGeometry = {
      type: "Polygon",
      coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)],
    };
    expect(pointInGeometry(g, 1, 1)).toBe(true);
    expect(pointInGeometry(g, 5, 5)).toBe(false);
    expect(pointInGeometry(g, 4.9, 6.1)).toBe(true);
  });
  it("an island inside a hole is inside again (MultiPolygon part)", () => {
    const g: AreaGeometry = {
      type: "MultiPolygon",
      coordinates: [[square(0, 0, 10, 10), square(2, 2, 8, 8)], [square(4, 4, 6, 6)]],
    };
    expect(pointInGeometry(g, 5, 5)).toBe(true);
    expect(pointInGeometry(g, 3, 3)).toBe(false);
    expect(pointInGeometry(g, 1, 1)).toBe(true);
  });
  it("antimeridian-unwrapped ring (170..190): a centroid at -175 is inside, -165 is not", () => {
    const g: AreaGeometry = { type: "Polygon", coordinates: [square(170, 10, 190, 20)] };
    expect(pointInGeometry(g, 175, 15)).toBe(true);
    expect(pointInGeometry(g, -175, 15)).toBe(true); // = 185
    expect(pointInGeometry(g, -165, 15)).toBe(false); // = 195
    expect(pointInGeometry(g, 160, 15)).toBe(false);
    expect(pointInGeometry(g, -175, 25)).toBe(false); // wrong latitude
  });
  it("a ring west of -180 (-200..-170) holds +165 (= -195) but not +150", () => {
    const g: AreaGeometry = { type: "Polygon", coordinates: [square(-200, 0, -170, 10)] };
    expect(pointInGeometry(g, 165, 5)).toBe(true);
    expect(pointInGeometry(g, -175, 5)).toBe(true);
    expect(pointInGeometry(g, 150, 5)).toBe(false);
  });
  it("non-finite coordinates are never inside", () => {
    const area = prepareArea({ type: "Polygon", coordinates: [square(0, 0, 10, 10)] });
    expect(pointInArea(area, Number.NaN, 5)).toBe(false);
    expect(pointInArea(area, 5, Number.POSITIVE_INFINITY)).toBe(false);
  });
  it("a degenerate ring (fewer than three vertices) contains nothing", () => {
    const area = prepareArea({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] });
    expect(area.polygons).toHaveLength(0);
    expect(pointInArea(area, 0.5, 0.5)).toBe(false);
  });
});
