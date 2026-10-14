import { describe, expect, it } from "vitest";
import {
  binColor,
  choroplethBin,
  colorForValue,
  legendStops,
  legendTicks,
  paletteStopsFromBoot,
  paletteStopsWithFallback,
  rampCss,
  type PaletteStops,
} from "../../src/lib/raster/ramps";

// an 11-stop fixture shaped like colorRampPalette(space = "Lab")(11) for "spectral_r" would look
// (real values come from boot.palettes at runtime — this file exists only under tests/, so it is
// exempt from scripts/check-hex-literals.mjs's src/-only scan roots, per the module contract).
const SPECTRAL_R_11: PaletteStops = [
  "#9E0142",
  "#D53E4F",
  "#F46D43",
  "#FDAE61",
  "#FEE08B",
  "#FFFFBF",
  "#E6F598",
  "#ABDDA4",
  "#66C2A5",
  "#3288BD",
  "#5E4FA2",
];

describe("paletteStopsFromBoot (reads boot.palettes with a runtime guard)", () => {
  it("returns the 11 stops for a known palette name", () => {
    const boot = { palettes: { spectral_r: SPECTRAL_R_11 } };
    expect(paletteStopsFromBoot(boot, "spectral_r")).toEqual(SPECTRAL_R_11);
  });

  it("returns null when boot is null/undefined", () => {
    expect(paletteStopsFromBoot(null, "spectral_r")).toBeNull();
    expect(paletteStopsFromBoot(undefined, "spectral_r")).toBeNull();
  });

  it("returns null when boot.palettes is absent (boot.json's real schema has not shipped yet)", () => {
    expect(paletteStopsFromBoot({}, "spectral_r")).toBeNull();
  });

  it("returns null when the named palette is missing or malformed", () => {
    expect(paletteStopsFromBoot({ palettes: {} }, "viridis")).toBeNull();
    expect(paletteStopsFromBoot({ palettes: { viridis: "not-an-array" } }, "viridis")).toBeNull();
    expect(paletteStopsFromBoot({ palettes: { viridis: [1, 2, 3] } }, "viridis")).toBeNull();
    expect(paletteStopsFromBoot({ palettes: { viridis: [] } }, "viridis")).toBeNull();
  });
});

// M2 fix (docs/usability.md): today's boot.palettes carries ONLY spectral_r (every release's own
// choice, per zoneFill.ts/raster.ts's comments) -- picking Viridis/Cividis/Magma used to paint
// every Program Area flat grey and drop the legend. One case per palette in the picker (PALETTES,
// state/types.ts), so a palette that ever loses its fallback shows up as exactly the row that broke.
describe("paletteStopsWithFallback — one case per palette in the picker (M2)", () => {
  it("spectral_r: returns the published stops verbatim when the release has them (no fallback needed)", () => {
    const boot = { palettes: { spectral_r: SPECTRAL_R_11 } };
    expect(paletteStopsWithFallback(boot, "spectral_r")).toEqual(SPECTRAL_R_11);
  });

  it("spectral_r: unpublished falls back to Spectral reversed, 11 stops (a catalog collection has no boot bundle)", () => {
    for (const boot of [{ palettes: {} }, null]) {
      const stops = paletteStopsWithFallback(boot, "spectral_r");
      expect(stops).toHaveLength(11);
      expect(stops?.[0].toLowerCase()).toBe("#5e4fa2");
      expect(stops?.[10].toLowerCase()).toBe("#9e0142");
    }
  });

  for (const name of ["viridis", "cividis", "magma"] as const) {
    it(`${name}: falls back to 11 real, distinct stops when the release publishes none`, () => {
      const stops = paletteStopsWithFallback({ palettes: {} }, name);
      expect(stops).not.toBeNull();
      expect(stops).toHaveLength(11);
      expect(stops!.every((s) => /^#[0-9a-fA-F]{6}$/.test(s))).toBe(true);
      // a REAL gradient, not 11 copies of one flat colour (the exact pre-fix symptom).
      expect(new Set(stops)).not.toHaveLength(1);
      // monotonic progression, not a random scatter: consecutive stops are never identical.
      for (let i = 1; i < stops!.length; i++) expect(stops![i]).not.toBe(stops![i - 1]);
    });

    it(`${name}: still prefers a release's OWN published stops over the fallback, when it has them`, () => {
      const published: PaletteStops = Array.from(
        { length: 11 },
        (_, i) => `#${(i + 1).toString(16).padStart(6, "0")}`,
      );
      const boot = { palettes: { [name]: published } };
      expect(paletteStopsWithFallback(boot, name)).toEqual(published);
    });
  }

  it("a missing/null boot still resolves every fallback-bearing palette (no boot.json required)", () => {
    for (const name of ["viridis", "cividis", "magma"] as const) {
      expect(paletteStopsWithFallback(null, name)).toHaveLength(11);
      expect(paletteStopsWithFallback(undefined, name)).toHaveLength(11);
    }
  });
});

describe("legendStops", () => {
  it("pairs each of the 11 stops with a value evenly spaced across [min, max]", () => {
    const stops = legendStops(SPECTRAL_R_11, 0, 100);
    expect(stops).toHaveLength(11);
    expect(stops[0]).toEqual({ color: "#9E0142", value: 0 });
    expect(stops[10]).toEqual({ color: "#5E4FA2", value: 100 });
    expect(stops[5].value).toBeCloseTo(50, 10); // the middle stop of 11 sits exactly at the midpoint
  });

  it("handles a single-stop palette without dividing by zero", () => {
    expect(legendStops(["#000000"], 3, 9)).toEqual([{ color: "#000000", value: 3 }]);
  });
});

describe("legendTicks — spec.md's continuous-ramp rule: label the endpoints, not every stop", () => {
  it("an 11-stop ramp renders exactly 2 labels by default (the fault: all 11)", () => {
    const stops = legendStops(SPECTRAL_R_11, 1, 100);
    const ticks = legendTicks(stops);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual(stops[0]);
    expect(ticks[1]).toEqual(stops[10]);
  });

  it("ticks=3 adds the exact midpoint", () => {
    const stops = legendStops(SPECTRAL_R_11, 1, 100);
    const ticks = legendTicks(stops, 3);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toEqual(stops[0]);
    expect(ticks[1]).toEqual(stops[5]);
    expect(ticks[2]).toEqual(stops[10]);
  });

  it("ticks >= stops.length returns every stop, never more than what was handed in", () => {
    const stops = legendStops(SPECTRAL_R_11, 1, 100);
    expect(legendTicks(stops, 11)).toEqual(stops);
    expect(legendTicks(stops, 50)).toEqual(stops);
  });

  it("a single-stop ramp returns that one stop regardless of ticks", () => {
    const stops = legendStops(["#000000"], 3, 9);
    expect(legendTicks(stops, 2)).toEqual(stops);
  });

  it("an empty ramp returns no ticks", () => {
    expect(legendTicks([], 2)).toEqual([]);
  });
});

describe("choroplethBin — clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)", () => {
  it("bins the minimum to 1 and the maximum to 11", () => {
    expect(choroplethBin(0, 0, 100)).toBe(1);
    expect(choroplethBin(100, 0, 100)).toBe(11);
  });

  it("bins the midpoint to 6", () => {
    expect(choroplethBin(50, 0, 100)).toBe(6);
  });

  it("clamps a value outside [min, max] to the end bins", () => {
    expect(choroplethBin(-10, 0, 100)).toBe(1);
    expect(choroplethBin(110, 0, 100)).toBe(11);
  });

  it("guards a degenerate range (max - min < 1e-6) with the max(...,1e-6) floor", () => {
    expect(() => choroplethBin(5, 5, 5)).not.toThrow();
    // value === min === max -> numerator 0, so the 1e-6 floor never causes a divide-by-zero NaN
    expect(choroplethBin(5, 5, 5)).toBe(1);
    // any value above a degenerate min/max divides by the 1e-6 floor and clamps straight to 11
    expect(choroplethBin(5.001, 5, 5)).toBe(11);
  });

  // half-even (banker's) rounding: THE regression this formula exists for. A drawn rectangle
  // produces cells whose coverage fraction is an EXACT half (e.g. 0.5, 1.5, 2.5 after *10), and R's
  // `round()` rounds those to the nearest EVEN integer, not always up.
  it("rounds an exact .5 fraction to the nearest EVEN integer, not always up (half-even)", () => {
    // (v-min)/(max-min)*10 = 0.5 exactly -> half-even rounds to 0 (nearest even) -> bin = 0+1 = 1
    expect(choroplethBin(5, 0, 100)).toBe(1);
    // ... *10 = 1.5 exactly -> half-even rounds to 2 (nearest even) -> bin = 2+1 = 3
    expect(choroplethBin(15, 0, 100)).toBe(3);
    // ... *10 = 2.5 exactly -> half-even rounds to 2 (nearest even, same target as 1.5's case) -> bin = 2+1 = 3
    expect(choroplethBin(25, 0, 100)).toBe(3);
  });

  // seeded fault: Math.round in the bin formula (use an exact-half value). Math.round(0.5) = 1
  // (always rounds .5 up), which would give bin 2 instead of the half-even answer of bin 1 — proving
  // this formula is NOT implemented with a bare Math.round.
  it("seeded fault: differs from a naive Math.round on the exact-half fixture", () => {
    expect(Math.round(0.5)).toBe(1); // documents WHY: Math.round always rounds .5 up
    const naiveBin = Math.min(11, Math.max(1, Math.round(0.5) + 1)); // a Math.round-based formula -> 2
    expect(naiveBin).toBe(2);
    expect(choroplethBin(5, 0, 100)).toBe(1); // half-even rounds the same 0.5 DOWN (to even 0) -> bin 1
    expect(choroplethBin(5, 0, 100)).not.toBe(naiveBin);
  });
});

describe("binColor", () => {
  it("returns the stop color for value's choropleth bin", () => {
    expect(binColor(SPECTRAL_R_11, 0, 0, 100)).toBe("#9E0142");
    expect(binColor(SPECTRAL_R_11, 100, 0, 100)).toBe("#5E4FA2");
  });
});

describe("colorForValue (continuous blend between the two nearest stops)", () => {
  it("returns the first/last stop exactly at the domain endpoints", () => {
    // rgbToHex always emits lowercase hex digits, even when boot.palettes carries uppercase — case
    // is not semantically significant for a color, so callers that care normalize with .toUpperCase().
    expect(colorForValue(SPECTRAL_R_11, 0, 0, 100).toLowerCase()).toBe("#9e0142");
    expect(colorForValue(SPECTRAL_R_11, 100, 0, 100).toLowerCase()).toBe("#5e4fa2");
  });

  it("blends halfway between two adjacent stops at a fractional index", () => {
    // 11 stops span index 0..10 across [0,100]; index 0.5 sits at value = 100 * 0.5/10 = 5
    const c = colorForValue(SPECTRAL_R_11, 5, 0, 100);
    // halfway between #9E0142 (158,1,66) and #D53E4F (213,62,79) -> (185.5, 31.5, 72.5) -> round
    expect(c.toUpperCase()).toBe("#BA2049");
  });

  it("clamps values outside [min, max] to the endpoint colors", () => {
    expect(colorForValue(SPECTRAL_R_11, -50, 0, 100).toLowerCase()).toBe("#9e0142");
    expect(colorForValue(SPECTRAL_R_11, 500, 0, 100).toLowerCase()).toBe("#5e4fa2");
  });

  it("returns the single color for a one-stop palette without interpolating", () => {
    expect(colorForValue(["#123456"], 42, 0, 100)).toBe("#123456");
  });

  it("throws for an empty stop list", () => {
    expect(() => colorForValue([], 1, 0, 1)).toThrow();
  });
});

// R3 (round-3 plan, W1: "actual color ramps visualized for given options" -- the ramp picker's
// strip preview, `lens/scores/LayersPanel.svelte`).
describe("rampCss (a flat left-to-right gradient string over the given stops)", () => {
  it("joins every stop, in order, into one linear-gradient", () => {
    expect(rampCss(["#111111", "#222222", "#333333"])).toBe(
      "linear-gradient(to right, #111111, #222222, #333333)",
    );
  });

  it("works for a single-stop palette (a degenerate but legal gradient)", () => {
    expect(rampCss(["#123456"])).toBe("linear-gradient(to right, #123456)");
  });
});
