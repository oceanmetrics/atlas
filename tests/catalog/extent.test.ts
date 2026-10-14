// A collection's extent as the default camera.
import { describe, expect, it } from "vitest";
import { extentBounds } from "../../src/lib/catalog/extent";
import { boundsToCameraView } from "../../src/lib/map/camera";
import type { StacCollection } from "../../src/lib/catalog/types";

const coll = (bbox: unknown) =>
  ({ extent: { spatial: { bbox: [bbox] } } }) as unknown as StacCollection;

describe("extentBounds", () => {
  it("is [[west, south], [east, north]] of the first bbox", () => {
    expect(extentBounds(coll([-97.9, 11.7, -43.8, 56.6]))).toEqual([
      [-97.9, 11.7],
      [-43.8, 56.6],
    ]);
  });
  it("takes the horizontal four of a 6-number (3D) bbox", () => {
    expect(extentBounds(coll([-10, -5, 0, 20, 8, 100]))).toEqual([
      [-10, -5],
      [20, 8],
    ]);
  });
  it("re-expresses an antimeridian-crossing box with east > 180, never wrapped", () => {
    expect(extentBounds(coll([170, -20, -170, -10]))).toEqual([
      [170, -20],
      [190, -10],
    ]);
  });
  it("clamps latitudes to Web Mercator's range", () => {
    expect(extentBounds(coll([-180, -90, 180, 90]))).toEqual([
      [-180, -85],
      [180, 85],
    ]);
  });
  it("is null for a missing, malformed, inverted or zero-area extent", () => {
    expect(extentBounds(null)).toBeNull();
    expect(extentBounds({} as StacCollection)).toBeNull();
    expect(extentBounds(coll([1, 2, 3]))).toBeNull();
    expect(extentBounds(coll([1, 2, NaN, 4]))).toBeNull();
    expect(extentBounds(coll([0, 10, 5, 5]))).toBeNull();
    expect(extentBounds(coll([5, 0, 5, 10]))).toBeNull();
  });
  it("frames the BioTrack extent: centred in it, zoomed past the globe view", () => {
    const b = extentBounds(coll([-97.9, 11.7, -43.8, 56.6]))!;
    const view = boundsToCameraView(b, { width: 1280, height: 800 }, { padding: 40 });
    expect(view.center[0]).toBeCloseTo((-97.9 + -43.8) / 2, 5);
    expect(view.center[1]).toBeGreaterThan(11.7);
    expect(view.center[1]).toBeLessThan(56.6);
    expect(view.zoom).toBeGreaterThan(2);
    expect(view.zoom).toBeLessThan(5);
  });
});
