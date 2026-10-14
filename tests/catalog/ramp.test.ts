// The collection's ramp (read out of its MapLibre style, else Spectral reversed), the value domain
// it spans, and the colour a value gets.
import { describe, expect, it } from "vitest";
import {
  collectionRamp,
  lookupColor,
  rampFromStyle,
  rampStops,
  valueDomain,
} from "../../src/lib/catalog/ramp";
import { paletteStopsWithFallback } from "../../src/lib/raster/ramps";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";
import style from "../fixtures/catalog/biotrack_indicators/styles/default.json";

const item = (props: Record<string, unknown>) => ({ properties: props }) as unknown as StacItem;
const coll = (extra: Record<string, unknown>) => extra as unknown as StacCollection;

describe("rampFromStyle: the ramp is read OUT of the collection's MapLibre fill layer", () => {
  it("returns the stop colours of the interpolate inside fill-color, in order", () => {
    expect(rampFromStyle(style)).toEqual(["#112233", "#445566", "#778899"]);
  });

  it("also reads a {layers:[...]} style document", () => {
    expect(rampFromStyle({ version: 8, layers: [style] })).toEqual([
      "#112233",
      "#445566",
      "#778899",
    ]);
  });

  it("reads a step expression's outputs too", () => {
    const stepStyle = {
      paint: {
        "fill-color": ["step", ["feature-state", "value"], "#111111", 0.5, "#222222", 1, "#333333"],
      },
    };
    expect(rampFromStyle(stepStyle)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("null for anything with no usable ramp: no style, no fill-color, fewer than two hex colours", () => {
    expect(rampFromStyle(null)).toBeNull();
    expect(rampFromStyle({})).toBeNull();
    expect(rampFromStyle({ paint: { "fill-color": "#ff0000" } })).toBeNull();
    expect(
      rampFromStyle({
        paint: { "fill-color": ["interpolate", ["linear"], ["get", "x"], 0, "red", 1, "blue"] },
      }),
    ).toBeNull(); // named colours cannot be blended by the ramp helpers
  });
});

describe("collectionRamp: the collection's style, else Spectral reversed", () => {
  it("uses the collection's own ramp when it has one", () => {
    expect(collectionRamp(style)).toEqual(["#112233", "#445566", "#778899"]);
  });

  it("falls back to Spectral reversed (11 stops, purple-blue low to dark red high)", () => {
    const ramp = collectionRamp(null);
    expect(ramp).toHaveLength(11);
    expect(ramp[0].toLowerCase()).toBe("#5e4fa2");
    expect(ramp[10].toLowerCase()).toBe("#9e0142");
    expect(ramp).toEqual([...paletteStopsWithFallback(null, "spectral_r")!]); // the one definition
  });

  it("a style with no usable ramp also falls back", () => {
    expect(collectionRamp({ paint: {} })).toHaveLength(11);
  });
});

describe("valueDomain: the colour domain (and legend range) of an item", () => {
  it("prefers the item's observed atlas:value_range", () => {
    expect(
      valueDomain(item({ "atlas:value_range": [0.1, 0.5], "sdm:value_range": [0, 1] }), null),
    ).toEqual([0.1, 0.5]);
  });

  it("then the item's sdm:value_range, then the collection's, then [0, 1]", () => {
    expect(
      valueDomain(item({ "sdm:value_range": [2, 4] }), coll({ "sdm:value_range": [0, 9] })),
    ).toEqual([2, 4]);
    expect(valueDomain(item({}), coll({ "sdm:value_range": [0, 9] }))).toEqual([0, 9]);
    expect(valueDomain(item({}), null)).toEqual([0, 1]);
    expect(valueDomain(null, null)).toEqual([0, 1]);
  });

  it("a malformed range is skipped; a degenerate one is widened so the ramp has a span", () => {
    expect(valueDomain(item({ "atlas:value_range": [1, "x"] }), null)).toEqual([0, 1]);
    expect(valueDomain(item({ "atlas:value_range": [3, 3] }), null)).toEqual([3, 4]);
    expect(valueDomain(item({ "atlas:value_range": [5, 2] }), null)).toEqual([5, 6]);
  });
});

describe("ramp lookup: stops and colours over a domain", () => {
  const colors = ["#000000", "#808080", "#ffffff"];

  it("rampStops spaces the colours evenly over the domain", () => {
    expect(rampStops(colors, [10, 20])).toEqual([
      { color: "#000000", value: 10 },
      { color: "#808080", value: 15 },
      { color: "#ffffff", value: 20 },
    ]);
  });

  it("lookupColor: the ends, the midpoint, and clamping outside the domain", () => {
    expect(lookupColor(colors, 10, [10, 20])).toBe("#000000");
    expect(lookupColor(colors, 15, [10, 20])).toBe("#808080");
    expect(lookupColor(colors, 20, [10, 20])).toBe("#ffffff");
    expect(lookupColor(colors, -5, [10, 20])).toBe("#000000");
    expect(lookupColor(colors, 99, [10, 20])).toBe("#ffffff");
  });

  it("lookupColor blends between two stops", () => {
    expect(lookupColor(colors, 12.5, [10, 20])).toBe("#404040");
  });
});
