// atlas-3 step 2b: the flower plot's geometry, pulled out of Flower.svelte so its hard rules are
// unit-tested directly (CLAUDE.md: core logic lives in an exported function; the component only
// calls it). Mirrors msens::ggplot_flower() (viz.R:719-829): every bar has `even = 1` (equal
// angular width, independent of score or how many components there are -- 7 on v7, 8 on v8/v9,
// parity scores app.md:826-830); centre = `weighted.mean(score, even, na.rm = TRUE)`, which with
// every weight equal to 1 IS the plain mean of the components actually present.
//
// One deliberate correction over the R app: a component with NO value is "no data", not an
// implicit 0 that `na.rm = TRUE` quietly drops from view. This module keeps that component's
// angular SLOT (so the ring's layout doesn't shift depending on which components happen to be
// present) but draws no petal in it and excludes it from the mean -- "absent is not zero"
// (docs/design/spec.md / the plan).
//
// atlas-4 fix round 2 (owner-reported defect, 2026-09-24): "Flower plot, nothing selected" on live
// v7 listed EIGHT components under a centre of 24 but drew only ~3-4 visible petals. Root cause --
// every petal used to be a full PIE SLICE from the true centre (`sectorPath(cx, cy, radius, ...)`
// with `radius = score` when `outerRadius = 100`), and `Flower.svelte`/`flowerSvg.ts` then drew a
// solid hub disc of radius 24 ON TOP to host the centre number. Any component whose score was <=
// 24 -- Coral 10.45, Fish 15.96, Invertebrate 14.73, Other 15.18, Primary producer 10.38 in the
// reported case -- produced a slice that fit ENTIRELY inside the hub and was therefore completely
// covered by it: 5 of 8 petals were real, correctly-colored, correctly-sized shapes that were
// simply painted over. This was never a color/category mapping gap (every one of the eight real
// categories, "other" included, already had a defined, distinct `--cat-*` token in tokens.css) --
// it was a z-order/radius bug that happened to look like a missing color from the screenshot.
//
// The fix mirrors what `msens::ggplot_flower()` does structurally (viz.R:779: `xlim(c(-10,
// max(height)))`, which offsets the polar axis so every bar's inner edge starts above the true
// centre, never fully covered by the centre annotation): every petal is now drawn as an ANNULAR
// SECTOR (a donut-ring wedge) from a shared `innerRadius` (matching the hub's own radius) out to a
// score-scaled outer radius, rather than a pie slice from the true centre. A real, present score
// -- however small -- always draws a visible band immediately outside the hub; only an EXACT score
// of 0 is naturally degenerate (innerRadius == outerRadius, zero-width, nothing to draw), which is
// the same "real but invisible" contract `sectorPath`'s `radius <= 0` case already had.
import { categoryFor, categoryKeyFor, categoryLabel, type Category } from "./categories";
import { formatScore } from "../format";
import { signif3 } from "../geo/round";

/** the hub's radius as a fraction of `outerRadius` (24 of 100 in the default/only configuration
 * this app ever uses) -- the single source both `computeFlowerGeometry`'s default `innerRadius`
 * and every renderer's `<circle r>` derive from, so the two can never drift apart again the way
 * Flower.svelte's hardcoded `r="24"` and this module's plain pie slices did. */
export const FLOWER_HUB_RADIUS_RATIO = 0.24;

/** the flower SVG's fixed `viewBox`, `"0 0 (2*outerRadius) (2*outerRadius)"` -- ONE place
 * Flower.svelte reads the plot's true drawing-coordinate box from, so the `size` prop (a CSS
 * pixel value only, atlas-4 fix round 3: "Flower plot should be centered") can never be mistaken
 * for a change to the coordinate system the petals are computed in. Unit-tested directly since
 * this module runs under vitest's node environment, which cannot render Flower.svelte itself. */
export function flowerViewBox(outerRadius = 100): string {
  return `0 0 ${outerRadius * 2} ${outerRadius * 2}`;
}

export interface FlowerComponentInput {
  /** raw category/component key as the data names it (msens sp_cat, or the flower's
   * metric_key-derived component label) -- resolved through categories.ts so every spelling of a
   * category shares one color token. */
  key: string;
  /** 0-100, or null when this place has no value for this component ("no data", not zero). */
  score: number | null;
}

export interface FlowerPetal {
  key: string;
  category: Category;
  /** the score actually drawn, clamped to [0, 100] */
  score: number;
  startAngle: number;
  endAngle: number;
  /** the shared hub-boundary radius every petal's annular band starts from (same units as `path`'s
   * coordinates) -- exposed so a caller/test can compute this petal's on-screen centroid without
   * parsing `path` (see `petalCentroid`). */
  innerRadius: number;
  /** this petal's own OUTER edge radius: `innerRadius` when `score` is 0, the geometry's
   * `outerRadius` option when `score` is 100. */
  radius: number;
  /** SVG path `d` for a filled ANNULAR SECTOR from `innerRadius` out to `radius`; "" when
   * `radius <= innerRadius` (a real score of exactly 0 -- still present, just degenerate). Never a
   * pie slice from the true centre -- see this module's header note on why a hub drawn on top of
   * that shape silently swallowed every petal below the hub's own radius. */
  path: string;
}

export interface FlowerSlot {
  key: string;
  category: Category;
  startAngle: number;
  endAngle: number;
}

export interface FlowerGeometry {
  /** one entry per input component with a non-null score, in input order -- what is actually drawn */
  petals: FlowerPetal[];
  /** one entry per input component with a null score, in input order -- drawn as nothing ("absent
   * is not zero"); the panel/table/text summary lists these as "no data" */
  noData: FlowerSlot[];
  /** the mean of the NON-null scores, unrounded; null when every component is null ("centre = the
   * mean of the non-null components") */
  centerValue: number | null;
  /** total slots -- fixes the equal angular width (360 / sliceCount) independent of how many of
   * them are actually drawn */
  sliceCount: number;
  /** the shared hub-boundary radius (same value as every petal's own `innerRadius`) -- the ONE
   * place a renderer's hub `<circle r>` should read this from, rather than a hardcoded literal
   * that can drift from the petals drawn around it. */
  innerRadius: number;
}

export interface FlowerGeometryOptions {
  /** the SVG viewBox is `0 0 (2*outerRadius) (2*outerRadius)`; the centre is
   * `(outerRadius, outerRadius)`. Default 100 (a 0-100 viewBox unit maps 1:1 to a score point). */
  outerRadius?: number;
  /** the hub's radius, in the same units as `outerRadius` -- every petal's annular band starts
   * here, never at the true centre (see this module's header). Default
   * `outerRadius * FLOWER_HUB_RADIUS_RATIO` (24 when `outerRadius` is the default 100). */
  innerRadius?: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  // angleDeg = 0 at 12 o'clock, increasing clockwise -- reads the same rotational sense as
  // coord_polar(theta = "y") without needing to reproduce ggplot's exact axis origin.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * A filled sector from `(cx, cy)` out to `radius`, spanning `[startAngle, endAngle)` degrees.
 * `radius <= innerRadius` draws nothing (a real score of 0, not an error).
 *
 * `innerRadius` (default 0, a full pie slice from the true centre) turns the shape into an ANNULAR
 * SECTOR -- a donut-ring wedge from `innerRadius` to `radius` instead -- which is what
 * `computeFlowerGeometry` uses for every petal (see this module's header: a pie slice from the
 * centre is exactly what let the hub disc silently cover any petal at or below its own radius).
 */
export function sectorPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  innerRadius = 0,
): string {
  if (radius <= innerRadius || endAngle <= startAngle) return "";
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  if (innerRadius <= 0) {
    return (
      `M ${cx} ${cy} ` +
      `L ${start.x.toFixed(3)} ${start.y.toFixed(3)} ` +
      `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`
    );
  }
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  return (
    `M ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)} ` +
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)} ` +
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} ` +
    `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)} ` +
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)} Z`
  );
}

/** the on-screen (viewBox) centroid of a drawn petal's colored annular band -- the midpoint of its
 * angular span at the midpoint of its radial band (`innerRadius`..`radius`). `cx`/`cy` are the
 * geometry's own centre (`outerRadius, outerRadius` in the default 100-unit flower). Used by
 * `e2e/scores.flower.spec.ts` to probe a real rendered pixel inside each petal without parsing its
 * SVG path string -- the seeded fault this guards against is a "petal exists in the DOM with a
 * defined fill" check that never verifies the petal is actually the topmost, visible thing at its
 * own centroid (the exact gap in the old `e2e/gallery.spec.ts` "8 distinct colors" gate, which
 * read `getComputedStyle(...).fill` and so passed even while the hub covered 5 of 8 petals). */
export function petalCentroid(
  petal: Pick<FlowerPetal, "startAngle" | "endAngle" | "innerRadius" | "radius">,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const midAngle = (petal.startAngle + petal.endAngle) / 2;
  const midRadius = (petal.innerRadius + petal.radius) / 2;
  return polarToCartesian(cx, cy, midRadius, midAngle);
}

/** one petal's tap/hover/focus label text -- "Bird: 56.8", always `formatScore`'s ONE decimal.
 * The single source for both the petal's own accessible name (`aria-label`/`<title>`, read on
 * focus regardless of pointer type) and the visible on-tap/on-hover label Flower.svelte draws in
 * the hub area, so the two can never disagree (atlas-4 fix round 3, owner: "values of petal show
 * on click (and for desktop on hover)"). */
export function petalLabelText(petal: Pick<FlowerPetal, "category" | "score">): string {
  return `${petal.category.label}: ${formatScore(petal.score)}`;
}

/** the reference ring's fallback value (P round, Ben's live review 2026-09-24: "Flower plot...
 * needs a reference outer circle... based on the maximum component score for given version") — used
 * whenever the caller has no real release maximum to hand (`boot.ts#flowerMaxComponentScore`
 * returns `null` when the release manifest publishes no `*_ecoregion_rescaled` metric at all — a
 * manifest that has not loaded yet, or a pre-metrics release; every real release TODAY (verified
 * live on v7, 2026-09-25) publishes real per-component maxima and never hits this path). */
export const FLOWER_MAX_FALLBACK = 100;

export interface FlowerReferenceRing {
  /** the value this ring represents, `signif3`'d the SAME way the raster legend's own endpoints are
   * (`lens/scores/raster.ts#rasterLegend`) — either the release's real published maximum component
   * score, or {@link FLOWER_MAX_FALLBACK} when none exists. */
  value: number;
  /** true when `value` is the FALLBACK, not a real release maximum -- the caller's label must say
   * so (Ben: "if no published maximum exists for a release, fall back to 100 and say so"). */
  isFallback: boolean;
  /** this ring's own radius, in the SAME viewBox units `computeFlowerGeometry` scores petals in
   * (`innerRadius` + `value/100 * (outerRadius - innerRadius)`) -- a petal's own radius can never
   * exceed this as long as its score never exceeds `value`, which is exactly what "the maximum
   * component score for this version" means. */
  radius: number;
}

/**
 * PURE: the flower's reference ring for `maxScore` (`boot.ts#flowerMaxComponentScore`'s result, or
 * `null`/`undefined` when the caller has none). The seeded fault this guards against: a ring drawn
 * at the fixed outer edge (100) regardless of what the release actually published as its ceiling —
 * `value`/`radius` below must move with `maxScore`, not sit pinned at the fallback.
 */
export function computeFlowerReferenceRing(
  maxScore: number | null | undefined,
  options: FlowerGeometryOptions = {},
): FlowerReferenceRing {
  const outerRadius = options.outerRadius ?? 100;
  const innerRadius = options.innerRadius ?? outerRadius * FLOWER_HUB_RADIUS_RATIO;
  const isFallback =
    maxScore === null || maxScore === undefined || !Number.isFinite(maxScore) || maxScore <= 0;
  const value = isFallback ? FLOWER_MAX_FALLBACK : signif3(clamp(maxScore as number, 0, 100));
  const radius = innerRadius + (value / 100) * (outerRadius - innerRadius);
  return { value, isFallback, radius };
}

/** the ring's own small "contour label" text — "max 93", or "max 100 (no published maximum for
 * this release)" for the fallback case, per Ben's own wording ("stated with a small label"). */
export function flowerReferenceRingLabel(ring: FlowerReferenceRing): string {
  return ring.isFallback
    ? `max ${ring.value} (no published maximum for this release)`
    : `max ${ring.value}`;
}

/**
 * PURE: the flower's geometry for one place's components. Equal angular width regardless of score
 * or petal count (7 vs 8); a null score draws no petal and never enters the mean; scores are
 * clamped to [0, 100] before being drawn.
 *
 * Throws if two components resolve to the SAME real category (e.g. "primary producer" and
 * "primprod" -- both synonyms of `primprod` in categories.ts): two petals sharing one color/label
 * is not a rendering choice, it is caller data that collapsed two distinct slots onto one
 * category, and the flower has no way to tell them apart visually (spec.md: "no information by
 * color alone" -- two IDENTICAL colors for two DIFFERENT components is the same failure in
 * reverse). Components that do not match any known category (both resolve to "nodata") are NOT
 * checked against each other -- several genuinely unrecognized labels are an ordinary, expected
 * shape of real data, not a caller bug.
 */
export function computeFlowerGeometry(
  components: readonly FlowerComponentInput[],
  options: FlowerGeometryOptions = {},
): FlowerGeometry {
  const outerRadius = options.outerRadius ?? 100;
  const innerRadius = options.innerRadius ?? outerRadius * FLOWER_HUB_RADIUS_RATIO;
  const n = components.length;
  const petals: FlowerPetal[] = [];
  const noData: FlowerSlot[] = [];

  if (n === 0) return { petals, noData, centerValue: null, sliceCount: 0, innerRadius };

  const seenCategoryKeys = new Map<string, string>(); // resolved CategoryKey -> the raw input key
  for (const c of components) {
    const resolved = categoryKeyFor(c.key);
    if (resolved === null) continue;
    const firstSeenAs = seenCategoryKeys.get(resolved);
    if (firstSeenAs !== undefined) {
      throw new Error(
        `computeFlowerGeometry: "${firstSeenAs}" and "${c.key}" both resolve to category ` +
          `"${resolved}" -- two components may not share one category`,
      );
    }
    seenCategoryKeys.set(resolved, c.key);
  }

  const angleStep = 360 / n; // EQUAL for every slot, regardless of score or count -- the seeded
  // fault this rule guards against is a width proportional to score (unequal petals)
  const present: number[] = [];

  components.forEach((c, i) => {
    const startAngle = i * angleStep;
    const endAngle = (i + 1) * angleStep;
    // owner review item 9 (live 0.10.62): "In v1 I am seeing flower plot with component 'No
    // data', which should not exist." Root cause: v1 (and every pre-v8 release) publishes an
    // `extrisk_reptile_ecoregion_rescaled` component -- a real, SCORED sp_cat that predates the
    // current eight-category `hue_pal()` palette (reptiles were later excluded from scoring
    // entirely, CLAUDE.md's own "reptile/amphibian EXCLUDED"). `categoryFor()` has no such
    // category, so it fell back to `NO_DATA_CATEGORY` -- a swatch reserved for "nothing published
    // here" -- and its label ("No data") is exactly what rendered, even though the component
    // carries a real number. `categoryLabel()` already has the right rule for this (every OTHER
    // surface -- ResultsPanel/SpeciesTable/ZonesTable -- sentence-cases an unrecognized-but-real
    // label instead of blanking it, this function's own header); this override applies that SAME
    // rule to the flower without touching `categoryFor()` itself (still used elsewhere for its
    // "genuinely absent" semantics) or Flower.svelte/FlowerPanel.svelte (this round does not own
    // those). The swatch (`.color`) is unchanged -- several genuinely unrecognized categories
    // already share one color by design (this function's own header, just below) -- only the TEXT
    // a caller reads off `.label` changes, from the literal word "No data" to the release's own
    // component name.
    const category = { ...categoryFor(c.key), label: categoryLabel(c.key) };
    if (c.score === null) {
      noData.push({ key: c.key, category, startAngle, endAngle });
      return;
    }
    const score = clamp(c.score, 0, 100);
    present.push(score);
    // an ANNULAR sector, innerRadius -> radius (never a pie slice from the true centre) -- see
    // this module's header. score=0 -> radius === innerRadius (degenerate, draws nothing, same
    // "real but invisible" contract as before); score=100 -> radius === outerRadius (reaches the
    // same outer edge a pre-fix pie slice did).
    const radius = innerRadius + (score / 100) * (outerRadius - innerRadius);
    petals.push({
      key: c.key,
      category,
      score,
      startAngle,
      endAngle,
      innerRadius,
      radius,
      path: sectorPath(outerRadius, outerRadius, radius, startAngle, endAngle, innerRadius),
    });
  });

  const centerValue = present.length
    ? present.reduce((sum, v) => sum + v, 0) / present.length
    : null;

  return { petals, noData, centerValue, sliceCount: n, innerRadius };
}

export interface SafeFlowerGeometry {
  geometry: FlowerGeometry;
  /** the input filtered down to what `geometry` actually drew from -- identical to `components`
   * (same array) when there was no collision; the table equivalent iterates THIS, never the raw
   * `components` prop, so it cannot list a row `geometry` itself refused to draw. */
  keptComponents: readonly FlowerComponentInput[];
  /** raw input `key`s dropped because they collided with an already-kept category (first-seen
   * wins, input order); empty when `components` had no collision. Populated ONLY as a
   * belt-and-braces fallback for a caller that did not already de-duplicate its own data (the
   * primary fix for the known v8/v9 case lives in `src/lens/scores/flower.ts`'s
   * `dedupeFlowerComponents`, upstream of this function) -- a caller bug or a future data quirk
   * must degrade the flower, not blank it. */
  droppedKeys: string[];
}

/**
 * `computeFlowerGeometry`, but a same-category collision degrades instead of throwing: the
 * FIRST-SEEN component per category wins (input order), the rest are reported in `droppedKeys`
 * rather than drawn. `Flower.svelte` calls this (never the throwing form directly) so a data
 * quirk renders what it can and announces the drop once, rather than blanking the whole flower.
 */
export function computeFlowerGeometrySafe(
  components: readonly FlowerComponentInput[],
  options: FlowerGeometryOptions = {},
): SafeFlowerGeometry {
  try {
    return {
      geometry: computeFlowerGeometry(components, options),
      keptComponents: components,
      droppedKeys: [],
    };
  } catch {
    const seenCategoryKeys = new Set<string>();
    const kept: FlowerComponentInput[] = [];
    const droppedKeys: string[] = [];
    for (const c of components) {
      const resolved = categoryKeyFor(c.key);
      if (resolved === null || !seenCategoryKeys.has(resolved)) {
        if (resolved !== null) seenCategoryKeys.add(resolved);
        kept.push(c);
      } else {
        droppedKeys.push(c.key);
      }
    }
    return { geometry: computeFlowerGeometry(kept, options), keptComponents: kept, droppedKeys };
  }
}

/**
 * PURE: the flower's text summary (SC 1.1.1 -- "every chart has a table equivalent AND a text
 * summary"), built from the SAME `FlowerGeometry` the SVG draws, so the two cannot disagree. The
 * seeded fault this replaces: the summary's own count previously came from
 * `components.length` (every input, INCLUDING ones with no score) rather than `petals.length`
 * (only the ones actually drawn and averaged) -- "mean 45 across 7 components" over a ring that
 * visibly draws 6 petals plus one empty "no data" slot. The count here is always
 * `geometry.petals.length`; absent components are named in their own sentence, never folded into
 * that count.
 */
export function describeFlowerSummary(title: string, geometry: FlowerGeometry): string {
  const { petals, noData, centerValue } = geometry;
  const meanText = centerValue !== null ? String(Math.round(centerValue)) : "no data";
  const n = petals.length;

  if (n === 0) {
    const absent = noData.map((s) => s.category.label).join(", ");
    return `${title}. Composite mean: no data. No data for any component (${absent}).`;
  }

  const parts = petals.map((p) => `${p.category.label} ${formatScore(p.score)}`);
  let text =
    `${title}. Composite mean ${meanText} across ${n} component${n === 1 ? "" : "s"}: ` +
    `${parts.join(", ")}.`;
  if (noData.length > 0) {
    const absent = noData.map((s) => s.category.label).join(", ");
    text += ` No data for ${absent}.`;
  }
  // atlas-4 fix round 2: never claims a PAGE POSITION ("below") -- this one sentence is reused in
  // three places whose layout disagrees on where the table actually is. In `Flower.svelte` the
  // "Show table" TOGGLE (and the table itself, once shown) sit ABOVE this sentence, not below it;
  // in the exported docx/HTML report (`src/lib/report/model.ts`'s `detail` field,
  // `src/report/exportDocx.ts`) this text is a standalone paragraph with no table anywhere near
  // it. "for exact values" alone is the only claim true in every context.
  return `${text} See the component table for exact values.`;
}
