// report/ramp.ts -- the Map section's colour domain (atlas-7 §3).
//
// R twin: report.qmd:159-160
//   score_rng <- range(all_areas$score)
//   if (diff(score_rng) == 0) score_rng <- score_rng + c(-0.5, 0.5)
// where `all_areas$score` is `round(msens::mean_score(scores), 1)` (report.qmd:152) -- the ROUNDED
// mean, not the raw composite, because that is the number the map tooltip prints too.
//
// THE RAMP SPANS THE PLACES IN *THIS* REPORT, never a fixed 0-100 (§3, spec §2.4). That is what
// makes a two-place report readable and what makes the ±0.5 widening necessary: one place, or two
// places that round to the same tenth, give a zero-width domain, and every interpolation against it
// is a division by zero -- the whole map paints one end of the Spectral ramp (or NaN) with a legend
// whose two ends print the same number.
//
// The palette itself is NOT here: the report reads `src/lib/raster/ramps.ts` like the app does
// (review checklist: "no second copy"). This module only decides the domain.
import { round1HalfEven } from "./format";

/** the value a place is FILLED by: its composite rounded to 1 dp (report.qmd:152). */
export function mapScore(composite: number | null): number | null {
  return composite !== null && Number.isFinite(composite) ? round1HalfEven(composite) : null;
}

/**
 * `[lo, hi]` over the places in this report, widened by ±0.5 when every place lands on the same
 * value. `null` when no place has a score at all (nothing to colour -- the caller shows the places
 * unfilled rather than inventing a domain).
 */
export function rampDomain(values: readonly (number | null)[]): [number, number] | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  let lo = present[0];
  let hi = present[0];
  for (const v of present) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // `diff == 0`, R's own test -- one place, or several that agree to the tenth.
  if (hi === lo) return [lo - 0.5, hi + 0.5];
  return [lo, hi];
}
