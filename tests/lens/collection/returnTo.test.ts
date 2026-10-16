// The pure rules of the way back and the carried point (`lens/collection/returnTo.ts`); the lens-level
// behaviour (the real state, effects and camera calls) is in followLink.svelte.test.ts.
import { describe, expect, it } from "vitest";
import {
  carryDecision,
  makeReturnTo,
  returnStillValid,
} from "../../../src/lens/collection/returnTo";
import { DEFAULT_SEL } from "../../../src/lib/state/types";

const CAMERA = { lon: -80, lat: 25, zoom: 4 };
const sel = { ...DEFAULT_SEL, c: "aquamaps_eov", i: "fish_risk", map: { lon: 1, lat: 2, zoom: 3 } };

describe("makeReturnTo", () => {
  it("keeps the keys that select the layer (unset ones too, so going back clears sp) and never map", () => {
    const r = makeReturnTo({ sel, camera: CAMERA, label: "Fish", target: "aquamaps_native" });
    expect(r).toEqual({
      sel: { c: "aquamaps_eov", i: "fish_risk", sp: undefined, rep: "native" },
      camera: CAMERA,
      label: "Fish",
      target: "aquamaps_native",
    });
    expect(Object.keys(r!.sel)).toEqual(["c", "i", "sp", "rep"]);
  });
  it("is null without a camera (no map to fly back on)", () => {
    expect(makeReturnTo({ sel, camera: null, label: "x", target: "y" })).toBeNull();
  });
});

describe("returnStillValid", () => {
  const r = makeReturnTo({ sel, camera: CAMERA, label: "Fish", target: "aquamaps_native" })!;
  it("holds only in the collection lens, on the collection the link opened", () => {
    expect(returnStillValid(r, "collection", "aquamaps_native")).toBe(true);
    expect(returnStillValid(r, "collection", "biotrack_indicators")).toBe(false);
    expect(returnStillValid(r, "species", "aquamaps_native")).toBe(false);
    expect(returnStillValid(r, "collection", null)).toBe(false);
  });
});

describe("carryDecision", () => {
  const base = {
    carrying: true,
    pointCollection: "aquamaps_eov",
    entryId: "aquamaps_native",
    hasItem: true,
    key: "native.tif#1",
    fromKey: "eov.tif#2",
  };
  it("re-keys once the new collection's item is ready", () => {
    expect(carryDecision(base)).toBe("rekey");
  });
  it("waits while the new item is missing, or is still the one it came from, or the entry is not known", () => {
    expect(carryDecision({ ...base, hasItem: false, key: null })).toBe("wait");
    expect(carryDecision({ ...base, key: base.fromKey })).toBe("wait");
    expect(carryDecision({ ...base, entryId: null })).toBe("wait");
  });
  it("is the ordinary rule when not carrying, or when the collection did not change", () => {
    expect(carryDecision({ ...base, carrying: false })).toBe("normal");
    expect(carryDecision({ ...base, pointCollection: "aquamaps_native" })).toBe("normal");
  });
});
