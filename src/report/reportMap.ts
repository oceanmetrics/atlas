// report/reportMap.ts -- atlas-7 step 2/3, §3 "Map": places filled by mean score, Spectral
// reversed, the report's OWN ramp domain (never the release's -- the seeded fault list names this
// exact mistake), opacity 0.6, labels at point-on-surface with a white halo, legend "Mean score",
// positron basemap with attribution.
//
// Reached ONLY through a dynamic `import()` from `Report.svelte`'s map section: `maplibre-gl` is
// ~288 KB gzip (CLAUDE.md budgets) and report.html's own static critical path has far less room
// for it once the Svelte runtime + report model + brand tokens are counted, so it is lazy here the
// same way duckdb/terra-draw are lazy for index.html -- this repo's existing rule for "a big
// dependency that is not needed before first interaction," just applied to a second entry point.
//
// FIX ROUND 1 (Opus review, item 1): this module used to restate the basemap tile URL and the
// zone `label_pt` lookup by hand, to keep `lib/map/{basemap,zones}.ts` off index.html's static
// graph. That is exactly the "no second copy" rule the phase's own review checklist forbids (a
// duplicated basemap URL or label rule WILL drift), so it is reverted: `composeStyle()`,
// `basemapForTheme()` and `zoneLabelsFromBoot()` are imported and reused verbatim. The map
// CONSTRUCTION (`createMap()`) is reused the same way, from `Report.svelte`'s own dynamic import
// (see that file). The accepted cost is ~6 KB gzip on index.html's static budget (414.8 KB of 450,
// still comfortable) -- `tests/report/noSecondMapCopy.wiring.test.ts` is the seeded-fault-backed
// proof that this module and `Report.svelte` never restate a basemap URL, a MapLibre constructor
// call or a glyphs endpoint again.
import type { AreaGeometry, Ring } from "../lib/geo/types";
import { bboxOf } from "../lib/geo/types";
import { pointOnSurface } from "./pointOnSurface";
import type { LegendStop, PaletteStops } from "../lib/raster/ramps";
import { colorForValue, legendStops } from "../lib/raster/ramps";
import { composeStyle } from "../lib/map/style";
import { GLYPHS_URL, loadBasemapStyle } from "../lib/map/layers/basemap";
import {
  zoneKeyProperty,
  zoneLabelsFromBoot,
  zoneSourceId,
  zoneSources,
} from "../lib/map/layers/zones";
import type { LayerSpecification, StyleSpecification, ZoneUnitSpec } from "../lib/map/types";
import {
  REPORT_MAP_LABEL_HALO,
  REPORT_MAP_LABEL_TEXT,
  REPORT_MAP_OUTLINE,
  REPORT_NODATA_COLOR,
} from "./colors";

/**
 * `boot.zones[unit][key].label_pt`, via the SAME reader the shell's own zone label layer uses
 * (`lib/map/layers/zones.ts#zoneLabelsFromBoot`) -- never a second parser of that field.
 */
export function zonePointFromBoot(
  boot: unknown,
  unit: string,
  key: string,
): [number, number] | null {
  const spec = zoneLabelsFromBoot(boot, unit);
  if (!spec) return null;
  const feature = spec.points.features.find((f) => f.properties?.key === key);
  if (!feature || feature.geometry.type !== "Point") return null;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  return [lon, lat];
}

export interface ReportMapFeatureInput {
  name: string;
  /** `null` -> drawn with the "no data" fallback color, never omitted from the map. */
  score: number | null;
  /** a custom (drawn) place's decoded geometry. */
  geometry?: AreaGeometry;
  /** a zone place's representative point -- a FALLBACK label anchor/marker for when its release
   * publishes no `label_pt` (this module's own review note used to say the point was ALL a zone
   * place ever drew; P4 fixed that -- see `ReportZoneGroup` below, which draws the real Program-Area
   * polygon from the SAME PMTiles archive the live Atlas already renders it from). A zone place with
   * neither a resolved point NOR a `ReportZoneGroup` match still shows nothing here, but its polygon
   * layer (when the release publishes `boot.units[]`, which every real one does) covers that case. */
  point?: [number, number];
}

/** a FeatureCollection of place polygons/points, `score`/`hasScore` on every feature's properties. */
function placesFeatureCollection(places: readonly ReportMapFeatureInput[]) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((p) => p.geometry || p.point)
      .map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name, score: p.score ?? 0, hasScore: p.score !== null },
        geometry: p.geometry ?? { type: "Point" as const, coordinates: p.point! },
      })),
  };
}

/** a Point per place, at `pointOnSurface()` for a polygon or the supplied point directly -- the
 * label layer's own source, kept separate from the fill/circle source so a label is never clipped
 * to a filled feature's own geometry type. */
function labelsFeatureCollection(places: readonly ReportMapFeatureInput[]) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((p) => p.geometry || p.point)
      .map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name },
        geometry: {
          type: "Point" as const,
          coordinates: p.geometry ? pointOnSurface(p.geometry) : p.point!,
        },
      })),
  };
}

/** the combined bbox over every place that carries one -- `bboxOf` for a polygon, a small box
 * around a zone's representative point. Plain min/max combine (no antimeridian-aware union): correct
 * for the common case of places that do not themselves straddle 180 deg in OPPOSITE senses, which
 * is the shape every fixture and every real report to date actually is. */
export function combinedBbox(
  places: readonly ReportMapFeatureInput[],
): [[number, number], [number, number]] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of places) {
    let box: [number, number, number, number] | null = null;
    if (p.geometry) box = bboxOf(p.geometry);
    else if (p.point)
      box = [p.point[0] - 0.5, p.point[1] - 0.5, p.point[0] + 0.5, p.point[1] + 0.5];
    if (!box) continue;
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  if (!Number.isFinite(x0)) return null;
  return [
    [x0, y0],
    [x1, y1],
  ];
}

// ---- zone places: the REAL Program-Area polygon, from the release's own PMTiles (P4) ------------
//
// B1 (`.claude/plans_todo/atlas-refs/2026-09-24 parity-page audit (Opus 5.5) on 0.10.28.md`): "The
// report map draws no place for any Program-Area report on any published release" -- caused by
// `zonePointFromBoot` needing `label_pt`, which no published boot carries, so a zone place had
// NEITHER a point NOR a polygon and was silently dropped from `places`/`place-labels`, and
// `combinedBbox` (above) never had anything to fly to. The audit's own suggested fix: "draw zone
// places from the unit's PMTiles polygon filtered by key and frame on it" -- exactly what this
// section does, reusing `lib/map/layers/zones.ts#zoneSources()`/`zoneSourceId()`/`zoneKeyProperty()`
// verbatim (the SAME vector archive + property names the live Atlas already draws Program-Area
// outlines from -- "no second copy"), never a second geometry fetch.

/** one zone unit's report polygon: the unit spec (source url/layer) plus a precomputed `{key:
 * color}` map, ALREADY resolved by the caller (`Report.svelte#mountMap`, from `colorForValue()`
 * over this report's own ramp domain -- see `scoreColorExpression`'s own header for why that must
 * be THIS report's domain, never the release's) -- a MapLibre `match` expression can only take
 * literal per-key colors, not a data-driven `["get","score"]` expression, because a raw zone vector
 * tile carries no `score` property of its own (unlike the synthetic `places` GeoJSON source above). */
export interface ReportZoneGroup {
  unit: ZoneUnitSpec;
  keyColors: Readonly<Record<string, string>>;
}

/** `{key: color}` for one unit's zone places, via `colorForValue()` (`lib/raster/ramps.ts` -- the
 * SAME continuous ramp interpolation `scoreColorExpression`'s data-driven `interpolate` expression
 * would apply, just precomputed to a literal because a raw zone vector tile carries no `score`
 * property `["get","score"]` could read -- see `ReportZoneGroup`'s own header). A place with `score:
 * null` gets {@link REPORT_NODATA_COLOR}, matching `scoreColorExpression`'s `hasScore === false`
 * branch. `Report.svelte#mountMap` calls this once per unit, never re-deriving the ramp math. */
export function zoneKeyColors(
  entries: readonly { key: string; score: number | null }[],
  domain: [number, number] | null,
  paletteStops: PaletteStops | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, score } of entries) {
    out[key] =
      score !== null && domain && paletteStops
        ? colorForValue(paletteStops, score, domain[0], domain[1])
        : REPORT_NODATA_COLOR;
  }
  return out;
}

/** `["match", ["get", keyProperty], k1, c1, k2, c2, ..., defaultColor]` -- B3's own precedent
 * (`lib/map/layers/zones.ts#zoneFillLayer`'s header): a MapLibre `match` expression needs at least
 * one label/output pair before its fallback, so an EMPTY `keyColors` returns the literal
 * `defaultColor` instead of an invalid two-argument `match`. */
export function zoneMatchColorExpression(
  keyProperty: string,
  keyColors: Readonly<Record<string, string>>,
  defaultColor: string,
): unknown {
  const entries = Object.entries(keyColors);
  if (entries.length === 0) return defaultColor;
  const match: unknown[] = ["match", ["get", keyProperty]];
  for (const [key, color] of entries) match.push(key, color);
  match.push(defaultColor);
  return match;
}

/** `report-zone-fill-{unit}` / `report-zone-line-{unit}` -- the fill+line pair for one zone unit's
 * report polygons, filtered to exactly the keys this report asked about (never the WHOLE unit --
 * an unrelated Program Area must not paint). Fill color is `zoneMatchColorExpression()`'s literal
 * per-key match (never `scoreColorExpression`'s data-driven one -- see `ReportZoneGroup`'s header);
 * the outline reuses `REPORT_MAP_OUTLINE`, the SAME color `places-fill`'s `fill-outline-color`
 * already uses, so a drawn place and a zone place read as the same visual language. */
export function zonePolygonLayers(group: ReportZoneGroup): LayerSpecification[] {
  const keyProperty = zoneKeyProperty(group.unit.unit);
  const keys = Object.keys(group.keyColors);
  const filter = ["in", ["get", keyProperty], ["literal", keys]] as unknown as never;
  const source = zoneSourceId(group.unit.unit);
  return [
    {
      id: `report-zone-fill-${group.unit.unit}`,
      type: "fill",
      source,
      "source-layer": group.unit.sourceLayer,
      filter,
      paint: {
        "fill-color": zoneMatchColorExpression(
          keyProperty,
          group.keyColors,
          REPORT_NODATA_COLOR,
        ) as never,
        "fill-opacity": 0.6,
        "fill-outline-color": REPORT_MAP_OUTLINE,
      },
    },
    {
      id: `report-zone-line-${group.unit.unit}`,
      type: "line",
      source,
      "source-layer": group.unit.sourceLayer,
      filter,
      paint: { "line-color": REPORT_MAP_OUTLINE, "line-width": 2, "line-opacity": 1 },
    },
  ];
}

/** every ring of a MapLibre `queryRenderedFeatures()` result's geometry (Polygon or MultiPolygon --
 * the only two shapes `zonePolygonLayers()`'s fill/line layers ever query), grouped as `Ring[][]`
 * (one entry per polygon) -- so `bboxOf()` (`geo/types.ts`, the SAME dateline-naive bbox
 * `combinedBbox` above already uses; see that function's own note on why plain min/max is accepted
 * here) can compute their combined extent with no second bbox algorithm. Exported and DOM-free
 * (plain GeoJSON-shaped objects in, `Ring[][]` out) so it is unit-testable without a real MapLibre
 * instance -- `Report.svelte#mountMap` is the only DOM-touching caller. */
export function ringsFromRenderedFeatures(
  features: readonly { geometry: { type: string; coordinates: unknown } }[],
): Ring[][] {
  const polygons: Ring[][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") polygons.push(g.coordinates as Ring[]);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates as Ring[][]) polygons.push(p);
  }
  return polygons;
}

/** `combinedBbox()`'s own `[[x0,y0],[x1,y1]]` shape, computed from ACTUAL rendered zone polygon
 * geometry instead of a fixed box around a label point -- `null` when the query found nothing (no
 * `boot.units[]` published, the pmtiles fetch failed, or the key genuinely is not in the archive),
 * which the caller falls back from rather than treating as "the whole world". */
export function bboxFromRenderedFeatures(
  features: readonly { geometry: { type: string; coordinates: unknown } }[],
): [[number, number], [number, number]] | null {
  const polygons = ringsFromRenderedFeatures(features);
  if (polygons.length === 0) return null;
  const [x0, y0, x1, y1] = bboxOf({ type: "MultiPolygon", coordinates: polygons });
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** the plain min/max union of two `combinedBbox()`-shaped boxes -- SAME no-antimeridian-re-expression
 * convention as `combinedBbox` itself (its own header explains why that is accepted here). Either
 * argument may be `null` (nothing to union); both `null` returns `null`. */
export function unionBounds(
  a: [[number, number], [number, number]] | null,
  b: [[number, number], [number, number]] | null,
): [[number, number], [number, number]] | null {
  if (!a) return b;
  if (!b) return a;
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ];
}

/** `places-circle`'s own `circle-opacity` -- a zone place with a resolved point (a fallback: most
 * releases publish no `label_pt`, see `ReportMapFeatureInput.point`'s own doc) still draws this
 * circle marker ON TOP of its `ReportZoneGroup` polygon, if any; a point with no matching polygon
 * (no `boot.units[]`, or a key the archive does not have) draws the circle alone, same as before P4.
 * Named (not an inline `0.85`) for readability here -- NOT imported by M4's e2e pixel-proof
 * (`e2e/report-hermetic.ts#EXPECTED_PLACE_CIRCLE_OPACITY`), which fix round 2 made a deliberately
 * SEPARATE literal on purpose: a gate whose expectation is derived from the value under test
 * cannot fail for that value (measured -- opacity 0 here used to pass the gate trivially, since
 * the "expected" blend collapsed onto the background too). Changing this constant is a real
 * product decision that must ALSO deliberately update that one. */
export const PLACE_CIRCLE_OPACITY = 0.85;

/** the maplibre `fill-color`/`circle-color` data expression: the 0-1e stop ramp over `domain`,
 * falling back to {@link REPORT_NODATA_COLOR} for a feature with no score. */
export function scoreColorExpression(stops: PaletteStops, domain: [number, number]): unknown[] {
  const legend: LegendStop[] = legendStops(stops, domain[0], domain[1]);
  const interpolate: unknown[] = ["interpolate", ["linear"], ["get", "score"]];
  for (const s of legend) interpolate.push(s.value, s.color);
  return ["case", ["==", ["get", "hasScore"], false], REPORT_NODATA_COLOR, interpolate];
}

export interface BuildReportMapStyleOptions {
  theme?: "navy" | "paper";
  places: readonly ReportMapFeatureInput[];
  domain: [number, number] | null;
  paletteStops: PaletteStops | null;
  /** zone places' REAL polygons (P4), one group per unit in use -- empty/omitted for a report with
   * no zone places or whose release publishes no `boot.units[]`. */
  zoneGroups?: readonly ReportZoneGroup[];
}

/** CARTO's city, capital and town label layers (`place_city_r6`, `place_city_dot_z7`,
 * `place_capital_dot_z7`, `place_town`, ... in both positron and dark-matter) -- short names at a
 * point, the context a report map needs. Matched after `composeStyle()`'s `basemap-` id prefix. */
const KEPT_LABEL_LAYER = /(?:^|-)place_(?:city|capital|town)/;

/**
 * The basemap layers the report map draws: every non-symbol layer, plus only the city/town label
 * layers ({@link KEPT_LABEL_LAYER}). Country, state, continent, water and road names are dropped
 * (R3-B11: their long text clipped at the fitted frame's edge).
 */
export function reportBasemapLayers<L extends { id: string; type: string }>(
  layers: readonly L[],
): L[] {
  return layers.filter((l) => l.type !== "symbol" || KEPT_LABEL_LAYER.test(l.id));
}

/**
 * Composes the ONE style this map ever applies: `composeStyle()` (background + positron basemap,
 * theme-driven, `lib/map/style.ts`/`layers/basemap.ts` -- the app's own function, not a copy of
 * it) with three report-specific layers appended on top (places fill/circle by score, and their
 * label layer) -- `composeStyle()` has no notion of "an arbitrary GeoJSON polygon colored by its
 * own data value", so that part is genuinely new, not a restatement of anything existing.
 *
 * ASYNC: `composeStyle()` itself is synchronous (`lib/map/style.ts`'s own header explains why --
 * it never awaits the basemap fetch inline), but the report's map is a ONE-SHOT sequential flow
 * (never a reactive re-compose racing a second one, unlike the shell), so warming the basemap
 * style cache here -- ONCE, before the only `composeStyle()` call this module ever makes -- is
 * both safe and correct: without it, the report's captured map would carry no CARTO layers at
 * all (just the plain background colour) the first time a given theme is used this session.
 * `Report.svelte#mountMap()` already awaits everything else on this path.
 */
export async function buildReportMapStyle(opts: BuildReportMapStyleOptions): Promise<{
  style: StyleSpecification;
}> {
  const theme = opts.theme ?? "paper";
  await loadBasemapStyle(theme);
  const base = composeStyle({ theme, projection: "mercator" });
  // R3-B11 (Opus eyes-on review, 2026-09-25, desktop-13b-report-map): CARTO's own place-name
  // labels ("LOUISIANA", drawn at a fixed map point but rendered as TEXT that extends well beyond
  // it) sat right at this map's fitted-bounds edge and got clipped by the capture frame -- a flat
  // padding number can chase that for one label's height and still lose to a longer one
  // ("UNITED STATES"), and this map is FOR the report's own places, not CARTO's basemap toponyms
  // (the report already draws its own `place-labels` layer, below). Dropping every CARTO `symbol`
  // layer (the vector GL style's text labels; `composeStyle({zones:[]})` contributes no symbol
  // layers of its own here) removes the clipping failure mode entirely rather than padding around
  // it -- fills/lines/water/roads are all untouched, so the basemap still reads as a real map.
  // #8 (2026-10-16): dropping EVERY symbol layer also took the city labels, and a report map with
  // no towns gives no sense of where a Program Area sits; `reportBasemapLayers()` keeps the short
  // city/town labels and still drops the long toponyms that clipped.
  const baseLayers = reportBasemapLayers(base.layers);
  const color =
    opts.domain && opts.paletteStops
      ? scoreColorExpression(opts.paletteStops, opts.domain)
      : REPORT_NODATA_COLOR;
  const zoneGroups = opts.zoneGroups ?? [];
  // one pmtiles vector source per unit (`zoneSources()`, `lib/map/layers/zones.ts` -- the SAME
  // reader the live Atlas's own zone outlines use), and one fill+line pair per unit, UNDER the
  // synthetic `places`/`place-labels` layers below so a resolved circle/label still draws on top.
  const zoneLayers: LayerSpecification[] = zoneGroups.flatMap(zonePolygonLayers);

  const style: StyleSpecification = {
    ...base,
    sources: {
      ...base.sources,
      ...zoneSources(zoneGroups.map((g) => g.unit)),
      places: { type: "geojson", data: placesFeatureCollection(opts.places) },
      "place-labels": { type: "geojson", data: labelsFeatureCollection(opts.places) },
    },
    layers: [
      ...baseLayers,
      ...zoneLayers,
      {
        id: "places-fill",
        type: "fill",
        source: "places",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": color as never,
          "fill-opacity": 0.6,
          "fill-outline-color": REPORT_MAP_OUTLINE,
        },
      },
      {
        id: "places-circle",
        type: "circle",
        source: "places",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": color as never,
          "circle-opacity": PLACE_CIRCLE_OPACITY,
          "circle-radius": 14,
          "circle-stroke-color": REPORT_MAP_OUTLINE,
          "circle-stroke-width": 1,
        },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "place-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 13,
          "text-font": ["Open Sans Regular"],
        },
        paint: {
          "text-color": REPORT_MAP_LABEL_TEXT,
          "text-halo-color": REPORT_MAP_LABEL_HALO,
          "text-halo-width": 2,
        },
      },
    ],
    // a label layer here always needs glyphs -- report places always carry a `name` (unlike the
    // shell's zone labels, which are conditional on `zonesNeedGlyphs()`), and composeStyle() only
    // sets `glyphs` when ITS OWN zone labels need it -- `GLYPHS_URL` imported (not restated) is
    // the same endpoint it would have used.
    glyphs: base.glyphs ?? GLYPHS_URL,
  };
  return { style };
}

export interface CapturedMapPng {
  dataUrl: string;
  width: number;
  height: number;
}

/** mean and population stdev of 0-255 luminance across a buffer of RGBA pixels. Pure and DOM-free
 * on purpose (CLAUDE.md: core logic lives in an exported, testable function; a canvas readback
 * just calls it) -- `tests/report/reportMap.test.ts` exercises this directly with synthetic pixel
 * arrays, since this repo's vitest environment is `node` (no real canvas to draw a fixture into).
 * The stdev is fix round 2 item 6: a reviewer's captured map was 896x360 of one flat colour -- the
 * hermetic basemap tile has no variation -- and a luminance-only check passed it, because a
 * mid-range flat grey is neither "all black" nor "all white". */
export function luminanceStatsFromRgba(data: ArrayLike<number>): { mean: number; stdev: number } {
  const n = data.length / 4;
  if (n === 0) return { mean: 128, stdev: Number.POSITIVE_INFINITY }; // no pixels -- do not block
  const lum = new Float64Array(n);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const mean = sum / n;
  let sq = 0;
  for (let j = 0; j < n; j++) sq += (lum[j] - mean) ** 2;
  return { mean, stdev: Math.sqrt(sq / n) };
}

/** below this, the capture is treated as a flat, single-colour fill rather than real map imagery
 * (a real basemap/zone fill has anti-aliased edges, labels, or multiple colours -- all of which
 * push the stdev well above this floor; a uniform test fixture or a blank tile reads exactly 0). */
const FLAT_STDEV_FLOOR = 2;

/** the pass/fail rule itself, pure (fix round 2, item 6) -- `null` means "accept this capture",
 * otherwise the string is the rejection reason `captureMapPng` throws. */
export function captureRejectionReason(stats: { mean: number; stdev: number }): string | null {
  if (stats.mean < 1 || stats.mean > 254) {
    return `rejected an all-black/all-white capture (luminance ${stats.mean.toFixed(1)})`;
  }
  if (stats.stdev < FLAT_STDEV_FLOOR) {
    return `rejected a flat, single-colour capture (luminance stdev ${stats.stdev.toFixed(2)}, floor ${FLAT_STDEV_FLOOR})`;
  }
  return null;
}

/** cheap 2D-context readback of a live canvas's current pixels, not a WebGL `readPixels` --
 * `preserveDrawingBuffer` already makes `drawImage` from the live canvas safe. */
function luminanceStats(canvas: HTMLCanvasElement): { mean: number; stdev: number } {
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d");
  if (!ctx) return { mean: 128, stdev: Number.POSITIVE_INFINITY }; // cannot measure -- do not block
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  return luminanceStatsFromRgba(data);
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** how long to wait for `"idle"` before capturing anyway -- the same bound `styleQueue.ts` uses
 * against a hung tile request (fix round 2, item 6's real root cause, below). */
const CAPTURE_IDLE_FALLBACK_MS = 4_000;

/** a raster tile's fetch can resolve (which is what `"idle"`'s own bookkeeping tracks) before its
 * IMAGE DECODE finishes -- measured, fix round 2 item 6, below. Exported (P4): the SAME settle gap
 * `Report.svelte#mountMap` waits before querying a zone unit's rendered polygon -- vector tile
 * parsing has an equivalent post-"idle" gap (measured directly: a single `waitForIdle` after
 * `flyTo(full)` sometimes queried ZERO rendered features on a layer that unquestionably existed and
 * unquestionably had matching data, `report.map.spec.ts`'s own red run before this fix) -- never a
 * second, independently-guessed constant. */
export const CAPTURE_DECODE_SETTLE_MS = 300;

/**
 * Waits for the NEXT `"idle"`, unconditionally, bounded by a fallback timer (`styleQueue.ts`'s own
 * lesson: MapLibre fires `"idle"` every time the map settles -- repeatedly, for the map's whole
 * life -- but a hung tile request would otherwise mean this never resolves).
 *
 * fix round 2, item 6's REAL bug, found while wiring in this item's own e2e fixture (a real, varied
 * basemap tile the map-PNG-capture assertions could actually tell apart from a flat one -- see
 * e2e/map-hermetic.ts's `variedPng()`): the caller (`Report.svelte#mountMap`) calls `applyStyle()`
 * then `flyToBounds()` (an ANIMATED `flyTo`) right before capturing -- but the old code
 * short-circuited on `map.isStyleLoaded()`, which is true the moment the style's OWN metadata is
 * loaded and says NOTHING about whether the camera is still mid-flight or the destination bounds'
 * tiles have painted yet. That raced: `isStyleLoaded()` often flips true before `flyTo` even starts
 * moving, so the capture fired at (or near) the STARTING view/paint -- a flat, uninteresting frame
 * the old luminance-only guard couldn't tell from a real one.
 *
 * Waiting for the NEXT `"idle"` unconditionally fixes THAT race, but not a second one measured
 * right after: `"idle"`'s own bookkeeping considers a raster tile "loaded" once its network fetch
 * resolves, not once the browser's own (separately async) IMAGE DECODE of those bytes finishes --
 * so a capture taken the instant `"idle"` fires can still read the pre-decode (blank/background)
 * frame. `captureMapPng` calls this TWICE, with {@link CAPTURE_DECODE_SETTLE_MS} of real wall-clock
 * time between the two: the second call almost always resolves immediately (truly idle by then),
 * but gives any in-flight decode the time it measurably needs.
 *
 * Exported (P4): `Report.svelte#mountMap` reuses this SAME bounded wait before querying a zone
 * unit's rendered polygon features -- the same "settle before reading the map" need `captureMapPng`
 * already has, never a second wait primitive.
 */
export async function waitForIdle(map: {
  once(ev: "idle", cb: () => void): unknown;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once("idle", finish);
    setTimeout(finish, CAPTURE_IDLE_FALLBACK_MS);
  });
}

/**
 * Captures the map as a PNG data URL, after `idle` settles TWICE (see {@link waitForIdle}'s own
 * header for why once is not enough), forcing a repaint and waiting two animation frames first
 * (`calcofi explore review.md` lesson 8) -- then rejects an all-black/all-white capture, AND a
 * flat single-colour one (fix round 2, item 6), rather than shipping a blank print figure silently.
 */
export async function captureMapPng(map: {
  once(ev: "idle", cb: () => void): void;
  triggerRepaint(): void;
  getCanvas(): HTMLCanvasElement;
}): Promise<CapturedMapPng> {
  await waitForIdle(map);
  await new Promise((r) => setTimeout(r, CAPTURE_DECODE_SETTLE_MS));
  await waitForIdle(map);
  map.triggerRepaint();
  await nextFrame();
  await nextFrame();
  const canvas = map.getCanvas();
  const reason = captureRejectionReason(luminanceStats(canvas));
  if (reason) throw new Error(`captureMapPng: ${reason}`);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
