import { describe, expect, it } from "vitest";
import { clearPick, EMPTY_PICK, togglePick } from "../../src/places/pick";
import type { ZoneHit } from "../../src/lib/map/interaction";

const GAA: ZoneHit = { unit: "programarea", key: "GAA", name: "St. George Basin" };
const WGA: ZoneHit = { unit: "programarea", key: "WGA", name: "Western Gulf of Alaska" };
const ECO: ZoneHit = { unit: "ecoregion", key: "EBS", name: "Eastern Bering Sea" };

describe("togglePick: a plain click", () => {
  it("from empty, selects just that key", () => {
    expect(togglePick(EMPTY_PICK, GAA, false)).toEqual({ unit: "programarea", keys: ["GAA"] });
  });

  it("replaces a DIFFERENT key with just the new one", () => {
    const state = { unit: "programarea", keys: ["GAA"] };
    expect(togglePick(state, WGA, false)).toEqual({ unit: "programarea", keys: ["WGA"] });
  });

  it("clicking the SAME sole key again clears the pick (toggle-off)", () => {
    const state = { unit: "programarea", keys: ["GAA"] };
    expect(togglePick(state, GAA, false)).toEqual(clearPick());
  });

  it("clicking one of SEVERAL picked keys plainly collapses to just that one (not a clear)", () => {
    const state = { unit: "programarea", keys: ["GAA", "WGA"] };
    expect(togglePick(state, GAA, false)).toEqual({ unit: "programarea", keys: ["GAA"] });
  });
});

describe("togglePick: multi (ctrl/shift/long-press)", () => {
  it("adds a new key to the set", () => {
    const state = { unit: "programarea", keys: ["GAA"] };
    expect(togglePick(state, WGA, true)).toEqual({ unit: "programarea", keys: ["GAA", "WGA"] });
  });

  it("removes an already-picked key, leaving the rest", () => {
    const state = { unit: "programarea", keys: ["GAA", "WGA"] };
    expect(togglePick(state, GAA, true)).toEqual({ unit: "programarea", keys: ["WGA"] });
  });

  it("from empty, still just selects the one key", () => {
    expect(togglePick(EMPTY_PICK, GAA, true)).toEqual({ unit: "programarea", keys: ["GAA"] });
  });
});

describe("togglePick: switching units restarts the selection, even under multi", () => {
  it("a hit on a different unit than the current pick starts fresh (D17 safety net)", () => {
    const state = { unit: "programarea", keys: ["GAA", "WGA"] };
    expect(togglePick(state, ECO, true)).toEqual({ unit: "ecoregion", keys: ["EBS"] });
    expect(togglePick(state, ECO, false)).toEqual({ unit: "ecoregion", keys: ["EBS"] });
  });
});

describe("clearPick", () => {
  it("returns a fresh empty state each call (not a shared mutable reference)", () => {
    const a = clearPick();
    const b = clearPick();
    expect(a).toEqual({ unit: null, keys: [] });
    a.keys.push("x");
    expect(b.keys).toEqual([]);
  });
});
