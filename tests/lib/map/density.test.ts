// Ben's ask (round 4, R4-A): the legend histogram's pure math -- binning, bars on the ramp's
// x-axis, and the marker position. See src/lib/map/density.ts's own header.
import { describe, expect, it } from "vitest";
import { binValues, formatMarkerValue, histogramBars, markerX } from "../../../src/lib/map/density";

describe("binValues", () => {
  it("empty input: a zero-bin histogram, never a throw", () => {
    expect(binValues([])).toEqual({ binCount: 0, counts: [], min: 0, max: 0 });
  });

  it("NaN/Infinity values are dropped, not counted and never widen the range", () => {
    const h = binValues([1, 2, 3, NaN, Infinity, -Infinity], 3);
    expect(h.min).toBe(1);
    expect(h.max).toBe(3);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("all values identical: one bin, no divide-by-zero", () => {
    const h = binValues([5, 5, 5]);
    expect(h).toEqual({ binCount: 1, counts: [3], min: 5, max: 5 });
  });

  it("the max value lands in the LAST bin, not a phantom extra one", () => {
    const h = binValues([0, 10], 2);
    expect(h.binCount).toBe(2);
    expect(h.counts).toEqual([1, 1]);
  });

  it("an even spread over N bins puts roughly equal counts in each", () => {
    const values = Array.from({ length: 100 }, (_, i) => i / 99);
    const h = binValues(values, 10);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(h.counts.every((c) => c > 0)).toBe(true);
  });
});

describe("markerX (fraction of the legend's x-axis)", () => {
  const domain = { min: 0, max: 100 };

  it("the minimum, midpoint and maximum sit at 0, 0.5 and 1", () => {
    expect(markerX(0, domain)).toBe(0);
    expect(markerX(50, domain)).toBe(0.5);
    expect(markerX(100, domain)).toBe(1);
  });

  it("a value outside the range clamps to an end, never draws off the chart", () => {
    expect(markerX(-10, domain)).toBe(0);
    expect(markerX(110, domain)).toBe(1);
  });

  it("a degenerate (zero-width) domain pins to the middle", () => {
    expect(markerX(5, { min: 5, max: 5 })).toBe(0.5);
  });

  it("null-safe: no value, a non-finite value or no domain draws no marker", () => {
    expect(markerX(null, domain)).toBeNull();
    expect(markerX(undefined, domain)).toBeNull();
    expect(markerX(NaN, domain)).toBeNull();
    expect(markerX(5, null)).toBeNull();
  });

  it("a Histogram is a valid domain (markerX(value, histogram))", () => {
    const h = { binCount: 2, counts: [1, 1], min: 0, max: 100 };
    expect(markerX(50, h)).toBe(0.5);
  });
});

describe("histogramBars (bins-to-bars scaling on the ramp's axis)", () => {
  const h = { binCount: 4, counts: [2, 4, 0, 1], min: 0, max: 100 };

  it("scales counts to the tallest bin and positions bins along the domain", () => {
    const bars = histogramBars(h, { min: 0, max: 100 });
    expect(bars).toHaveLength(3); // the empty bin draws nothing
    expect(bars[0]).toEqual({ x: 0, w: 0.25, h: 0.5, value: 12.5 });
    expect(bars[1]).toEqual({ x: 0.25, w: 0.25, h: 1, value: 37.5 });
    expect(bars[2]).toEqual({ x: 0.75, w: 0.25, h: 0.25, value: 87.5 });
  });

  it("a wider domain (the ramp's endpoints) shrinks the bars to their share of it", () => {
    const bars = histogramBars(h, { min: 0, max: 200 });
    expect(bars[1].x).toBe(0.125);
    expect(bars[1].w).toBe(0.125);
  });

  it("bins outside the domain are clipped to it", () => {
    const bars = histogramBars(h, { min: 50, max: 100 });
    expect(bars.every((b) => b.x >= 0 && b.x + b.w <= 1)).toBe(true);
  });

  it("a null source gives no bars (the legend draws the ramp alone)", () => {
    expect(histogramBars(null, { min: 0, max: 1 })).toEqual([]);
    expect(histogramBars(undefined, { min: 0, max: 1 })).toEqual([]);
    expect(histogramBars(h, null)).toEqual([]);
    expect(histogramBars({ binCount: 0, counts: [], min: 0, max: 0 }, { min: 0, max: 1 })).toEqual(
      [],
    );
    expect(
      histogramBars({ binCount: 2, counts: [0, 0], min: 0, max: 1 }, { min: 0, max: 1 }),
    ).toEqual([]);
  });

  it("a one-value histogram draws one thin bar at that value", () => {
    const bars = histogramBars(
      { binCount: 1, counts: [7], min: 50, max: 50 },
      { min: 0, max: 100 },
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].h).toBe(1);
    expect(bars[0].x + bars[0].w / 2).toBeCloseTo(0.5, 9);
  });
});

describe("formatMarkerValue (matches the popup's value line)", () => {
  it("a Program-area value prints the popup's integer, not the raw float", () => {
    expect(formatMarkerValue(33.0930431598879)).toBe("33");
  });
  it("a raster cell value and a species value print their integers", () => {
    expect(formatMarkerValue(50)).toBe("50");
    expect(formatMarkerValue(71.5)).toBe("72");
    expect(formatMarkerValue(0.4)).toBe("0");
  });
  it("precision follows the domain span: integer >= 10, one decimal < 10, two < 1", () => {
    expect(formatMarkerValue(33.0930431598879, { min: 7.5, max: 52.7 })).toBe("33");
    expect(formatMarkerValue(50.4, { min: 1, max: 100 })).toBe("50");
    expect(formatMarkerValue(3.14159, { min: 0, max: 9.9 })).toBe("3.1");
    expect(formatMarkerValue(0.4, { min: 0, max: 1 })).toBe("0.4");
    expect(formatMarkerValue(0.4321, { min: 0, max: 0.5 })).toBe("0.43");
    expect(formatMarkerValue(0.4, { min: 0, max: 10 })).toBe("0");
  });
  it("a density-sized domain (span < 0.1) keeps three significant figures, not 0.00", () => {
    expect(formatMarkerValue(0.00511, { min: 0.00036, max: 0.0079 })).toBe("0.00511");
    expect(formatMarkerValue(0.000511, { min: 0.00036, max: 0.0079 })).toBe("5.11e-4");
  });
  it("null / non-finite -> no label", () => {
    expect(formatMarkerValue(null)).toBeNull();
    expect(formatMarkerValue(undefined)).toBeNull();
    expect(formatMarkerValue(NaN)).toBeNull();
  });
});
