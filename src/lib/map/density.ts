// Ben's ask (2026-09-30, round 4 R4-A): "the histogram should represent the density of values
// across the whole layer ... and so not vary across clicks of the same layer, just the vertical
// line indicating the clicked element's value ... better suited in the Legend above the color
// ramp". This module is the pure math: bin a value list into counts, place those bins on the
// legend ramp's own x-axis (`histogramBars`), and place the clicked value's marker on it
// (`markerX`). Nothing here touches the DOM, a palette, or a network/engine call -- see
// `distribution.ts` for where the bins come from and `lib/ui/Legend.svelte` for the drawing (the
// bar colours come from the ramp's own stops there, never a second ramp here).

/** the bar count a legend histogram has: what `binValues` bins a hex layer's column into, and what a
 * raster item asks titiler's `/cog/statistics` for, so the two kinds of layer draw alike. */
export const DEFAULT_HISTOGRAM_BINS = 40;

export interface Histogram {
  /** the bin count actually used (may be less than requested if the value range degenerates). */
  binCount: number;
  /** raw counts per bin, left to right. */
  counts: number[];
  min: number;
  max: number;
}

/**
 * Bins `values` into `binCount` equal-width buckets over `[min(values), max(values)]`. Non-finite
 * values (NaN, ±Infinity -- a real Parquet column can carry either) are dropped before binning, not
 * counted, and never widen the range. `values` with fewer than 2 distinct finite values (empty, one
 * value, or every value identical) returns a ONE-bin histogram holding every value — a degenerate
 * but still valid "distribution" (a flat point at that value), rather than dividing by a
 * `max - min` of zero.
 */
export function binValues(values: readonly number[], binCount = DEFAULT_HISTOGRAM_BINS): Histogram {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { binCount: 0, counts: [], min: 0, max: 0 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max - min < 1e-12) {
    return { binCount: 1, counts: [finite.length], min, max };
  }
  const n = Math.max(1, Math.floor(binCount));
  const counts = new Array<number>(n).fill(0);
  const width = (max - min) / n;
  for (const v of finite) {
    // the max value must land in the LAST bin, not spill into a phantom (n)-th one.
    const idx = Math.min(n - 1, Math.floor((v - min) / width));
    counts[idx]++;
  }
  return { binCount: n, counts, min, max };
}

/** the x-axis a legend draws on: the ramp's first and last stop values. A {@link Histogram}
 * satisfies it structurally, so `markerX(value, histogram)` reads naturally. */
export interface AxisDomain {
  min: number;
  max: number;
}

/**
 * The clicked value's position along `domain` as a fraction in `[0, 1]` -- clamped to the ends for
 * a value outside the range (a marker is never placed off the chart). `null` (draw no marker) for
 * a non-finite/absent value or an absent domain; a zero-width domain pins to the middle.
 */
export function markerX(
  value: number | null | undefined,
  domain: AxisDomain | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max)) return null;
  const span = domain.max - domain.min;
  if (span < 1e-12) return 0.5;
  return Math.min(1, Math.max(0, (value - domain.min) / span));
}

/** one histogram bar, every field a fraction of the chart: `x`/`w` along the axis, `h` of the
 * chart height (tallest bin = 1), and `value` (the bin centre) for the caller to colour by. */
export interface HistogramBar {
  x: number;
  w: number;
  h: number;
  value: number;
}

/**
 * The bars of `histogram` on `domain`'s x-axis (the legend ramp's own endpoints, so bar x lines up
 * with the ramp underneath). Counts scale linearly to the tallest bin. Bins outside the domain are
 * clipped to it. `[]` for an empty/absent histogram or domain (nothing to draw), never a throw.
 */
export function histogramBars(
  histogram: Histogram | null | undefined,
  domain: AxisDomain | null | undefined,
): HistogramBar[] {
  if (!histogram || histogram.binCount < 1 || histogram.counts.length === 0) return [];
  if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max)) return [];
  const peak = Math.max(0, ...histogram.counts);
  if (peak <= 0) return [];
  const span = domain.max - domain.min;
  if (span < 1e-12) return [];
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const n = histogram.counts.length;
  const width = (histogram.max - histogram.min) / n;
  const bars: HistogramBar[] = [];
  for (let i = 0; i < n; i++) {
    const count = histogram.counts[i];
    if (!(count > 0)) continue;
    // a degenerate one-value histogram (min === max): a thin bar at that value
    const lo = width < 1e-12 ? histogram.min - span * 0.005 : histogram.min + i * width;
    const hi = width < 1e-12 ? histogram.min + span * 0.005 : lo + width;
    const x0 = clamp01((lo - domain.min) / span);
    const x1 = clamp01((hi - domain.min) / span);
    if (x1 <= x0) continue;
    bars.push({ x: x0, w: x1 - x0, h: count / peak, value: (lo + hi) / 2 });
  }
  return bars;
}

/**
 * The marker's label. Precision follows the legend axis so a small-range layer is not flattened:
 * integer when the domain span is >= 10 (the app's own cases -- 0-93, 7.5-52.7, 1-100 -- where it
 * is the popup value line's `Math.round`, so the legend never shows a raw "33.0930431598879" beside
 * a popup that says "Score 33"), one decimal when the span is < 10, two when it is < 1, and three
 * significant figures when it is < 0.1 (a density surface spanning 0.0004 to 0.008 would otherwise
 * read "0.00"). No domain (or a zero-width one) falls back to the integer. `null` (no label) for a non-finite/absent value.
 */
export function formatMarkerValue(
  value: number | null | undefined,
  domain?: AxisDomain | null,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const span = domain ? Math.abs(domain.max - domain.min) : Infinity;
  if (span > 0 && span < 0.1) {
    const s = Number(value.toPrecision(3));
    return s !== 0 && Math.abs(s) < 1e-3 ? s.toExponential(2) : String(s);
  }
  const dp = span >= 10 || !(span > 0) ? 0 : span >= 1 ? 1 : 2;
  return dp === 0 ? String(Math.round(value)) : value.toFixed(dp);
}
