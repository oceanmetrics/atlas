// report/model.ts -- atlas-7 step 1: ONE pure function from (release, places) to a plain object
// whose every number equals what R produces for the same places.
//
// WHAT THIS IS, AND WHAT IT IS NOT. `buildReport()` fetches nothing, queries nothing and is
// synchronous: the caller hands it the queries it already ran (`ReportPlaceInput.scores` /
// `.species`), and every one of those fields is nullable so the document can render a section the
// moment its data lands and show the rest as pending (atlas-7 step 2's progressive rendering). The
// model's whole job is DERIVATION -- the ramp domain, the flowers, the scores table and its
// footnotes, the species cross-tab, the top 20, the provenance -- and derivation is exactly what a
// unit test can hold against R (`tests/lib/report/numbers.test.ts` against
// `tests/fixtures/report/{v7,v9}/report_*.json`).
//
// NOTHING HERE IS A SECOND COPY (the phase's review checklist). The flowers go through the lens's
// own `dedupeFlowerComponents()` + `computeFlowerGeometrySafe()`; the categories through
// `lib/ui/categories.ts`; the permalink and the Species-lens deep links through
// `lib/state/codec.ts#formatSel`; the citations through the one `lib/release/cite.ts` path (new in
// this phase -- see that file's header for why it is not under `report/`); the component labels
// through `lens/scores/flower.ts#componentLabel`. The SQL twins are not read here at all: the
// caller ran them.
//
// TWO NUMBERS THAT LOOK LIKE ONE, and a decision about them:
//  1. A ZONE place reports its release's PUBLISHED `zone_metric` rows; the SAME area traced as a
//     custom place reports the D7b-clipped blend over its own cells. They differ -- measured on
//     v9 GAA, 40.4484 published vs 40.4982 traced (+0.0498), which is `tests/fixtures/report/v9/
//     report_gaa.json`'s `traced_as_custom_place` block. That is the boundary-vs-grid difference
//     master plan D7b bounded ("a traced Program Area still reproduces its published composite
//     within 0.08 points"), not a defect, and the fixture records both so a reader can see which
//     kind of place produced which number.
//  2. The flower DRAWS one petal per resolved category, so v8/v9's `primary producer` and
//     `primprod` collapse to one slot (`lens/scores/flower.ts`'s header). The Table of Scores keeps
//     both, because both genuinely feed the composite. The flower's CENTRE is therefore taken from
//     the table's `Overall` (all components), NOT from the drawn petals' own mean: a document whose
//     flower centre and whose table disagree by 4 points is a defect whatever the reason. The
//     petals' own mean is still reported, as `centreOfDrawnPetals`, and `droppedLabels` names what
//     the ring could not show.
import { bboxOf, polygonsOf, type AreaGeometry } from "../geo/types";
import { citedDatasets, type Citation } from "../release/cite";
import {
  componentColumns,
  overallScore,
  scoresTable,
  type ReportComponent,
  type ScoresTable,
  type ScoresTablePlace,
} from "./scores";
import {
  computeFlowerGeometrySafe,
  describeFlowerSummary,
  type FlowerGeometry,
} from "../ui/flowerGeometry";
import { categoryLabel } from "../ui/categories";
import {
  componentLabel as componentLabelOf,
  dedupeFlowerComponents,
} from "../../lens/scores/flower";
import { paLabel } from "../../places/zoneStats";
import { DEFAULT_SEL, type Sel } from "../state/types";
import { REPORT, WORDMARK_TEXT } from "../brand/instance";
import { DOCS_ROOT } from "../release/docsUrl";
import { encodePlace, type Place } from "../geo/placeCodec";
import { formatCount, formatScore0, isoInstant, slugify, utcStamp } from "./format";
import { formatSel } from "../state/codec";
import { mapScore, rampDomain } from "./ramp";
// W4 fix: the single-place swatch colour (below) is DERIVATION, same as everything else this file
// computes -- both functions are pure/DOM-free (raster/ramps.ts's own header), so the model can
// resolve it here rather than handing reportMap.ts/Report.svelte a bare score to recolour a second
// way.
import { colorForValue, paletteStopsFromBoot } from "../raster/ramps";
import { speciesCounts, type SpeciesCounts } from "./er";
import { sortSpeciesRows, topSpecies, SPECIES_CSV_COLUMNS, type TopSpeciesRow } from "./species";
import { buildProvenance, type Provenance, type SqlRun } from "./provenance";
import type { SpeciesRow } from "../analysis/queries";

export type { ReportComponent } from "./scores";

/** the title of a report whose link carries no `#t=`. #8 (2026-10-16): it used to be the old
 * Shiny report's "BOEM Marine Sensitivity Report" (`apps/scores/app.R:1557`), which sat beside the
 * Marine Minerals Administration seal after the rebrand. The agency is named once, by the header's
 * lockup (`VITE_AGENCY`, `lib/ui/sealVisibility.ts`), so the default title names none. */
/** the instance's `report.title`. */
export const DEFAULT_TITLE = REPORT?.title ?? "Report";

// ---- inputs --------------------------------------------------------------------------------

/** the already-run scores for ONE place. `null` anywhere above means "not yet". */
export interface PlaceScoreInput {
  components: readonly ReportComponent[];
  /** the cells the numbers were computed over -- D7b's clipped set for a custom place,
   * `boot.zones[*].n_cells` for a zone place. */
  nCells: number | null;
  areaKm2: number | null;
  /** D7b: `nCellsStudyArea / nCellsTouched * 100`. `null` for a zone place (a published zone IS
   * the study area; there is no clip to report). */
  studyAreaPct?: number | null;
  /** the cells the geometry touched before the D7b clip, when the caller measured it. */
  nCellsTouched?: number | null;
}

export interface ReportPlaceInput {
  /** the place as the URL carries it. A zone place with SEVERAL keys is passed once per key --
   * `expandPlaces()` performs that split, so the table has one row per reported area exactly as
   * the old report did. */
  place: Place;
  /** for a zone place: the one key this entry reports on. */
  zoneKey?: string;
  /** `encodePlace(place)` -- supplied, not computed, so a caller that already has the token from
   * the URL does not re-derive (and re-quantize) it. */
  token: string;
  name: string;
  /** a custom place's DECODED geometry (master plan D8: what was analysed, not what was drawn). */
  geometry?: AreaGeometry;
  scores?: PlaceScoreInput | null;
  species?: readonly SpeciesRow[] | null;
}

export interface ReportPermalinkParts {
  /** e.g. `https://marinesensitivity.org` -- supplied; the model never reads `location`. */
  origin: string;
  /** e.g. `/atlas/report.html`. */
  path: string;
}

export interface BuildReportInput {
  ver: string;
  /** `boot.json`, parsed. */
  boot: unknown;
  places: readonly ReportPlaceInput[];
  /** the `boot.tables` keys this report read, for the provenance digests. */
  tables: readonly string[];
  now: Date;
  /** the app's git SHA. */
  appSha: string;
  title?: string;
  /** the access gate's answer (`release/access.ts#decideAccess().preview`). */
  preview?: boolean;
  /** overrides for `boot.release.{status,access}`, when the caller resolved them from
   * `versions.json` instead. */
  status?: string | null;
  access?: string | null;
  duckdbWasm?: string | null;
  permalink?: ReportPermalinkParts;
  /** the `sql/*.sql` twins that actually ran. */
  sql?: readonly SqlRun[];
}

// ---- outputs -------------------------------------------------------------------------------

export interface ReportHeader {
  title: string;
  ver: string;
  status: string | null;
  access: string | null;
  /** `v9 · prerelease · restricted` -- the release chip (§0). */
  releaseChip: string;
  generatedAt: string;
  generatedLabel: string;
  permalink: { href: string; origin: string; path: string; search: string; hash: string };
  /** true when this document was rendered from a restricted release on a preview session. */
  preview: boolean;
  /** the gold banner's text (§0), or `null` on a public release. */
  previewBanner: string | null;
  /** `PREVIEW_` on a restricted release (§0), else `""`. */
  filePrefix: string;
  /** `MarineSensitivity_{slug}_{ver}_{YYYY-MM-DD}` -- the export stem. */
  fileStem: string;
}

export interface ReportIntro {
  ver: string;
  text: string;
  /** the Atlas map, same release, relative (CLAUDE.md: never an absolute in-app URL). */
  appHref: string;
  docsHref: string;
}

export interface ReportParameter {
  name: string;
  kind: Place["kind"];
  /** a zone place: the keys it reports on. */
  zoneKeys: string[] | null;
  /** a custom place: its vertex count (every ring, every part). */
  vertexCount: number | null;
  bbox: [number, number, number, number] | null;
  areaKm2: number | null;
  nCells: number | null;
  /** D7b's "share of this place inside the study area", as a PERCENT (0-100). */
  studyAreaPct: number | null;
  token: string;
  /** fix round 2, item 2: D7b's own disclosure, present ONLY for a drawn (`kind: "geom"`) place --
   * a zone place IS the study area (nothing to disclose). `null` for every other kind. */
  d7bNote: string | null;
}

// fix round 2, item 2 (master plan D7b): a drawn place is never scored against ITS OWN raw
// coverage -- `sql/cells_in_study_area.sql` clips to the cells inside the U.S. study area first,
// the SAME published zone-metric method a Program Area's own score already uses. Undisclosed,
// the only way a reader would learn this is by tracing a Program Area and finding the two numbers
// disagree (v9 GAA: 40.4484 published vs 40.4982 traced, +0.0498 -- model.ts's own header).
const D7B_NOTE =
  "This place is scored by the same method a published Program Area uses: the coverage-weighted " +
  "mean over the cells that fall inside the U.S. study area, never the place's own raw " +
  "coverage. A drawn place that traces a Program Area can therefore differ slightly from that " +
  "Area's own published score (measured up to about 0.05 on a released Program Area).";

export interface ReportMapPlace {
  name: string;
  /** what the fill is interpolated from: `round(composite, 1)` (report.qmd:152). */
  score: number | null;
}

export interface ReportMap {
  places: ReportMapPlace[];
  /** `range()` over THIS report's places, widened ±0.5 when equal; `null` when none has a score. */
  domain: [number, number] | null;
  legendTitle: string;
  summary: string;
  /** the static method narrative (fix round 2, item 1 -- spec §2.4, verbatim). */
  narrative: string;
  /** W4 fix (design call noted twice by reviewers, then Ben's phone report): the ONE place, when
   * this report has exactly one, so the caller can draw a single swatch + value instead of a
   * two-ended gradient legend. A lone place's `domain` is still `[score-0.5, score+0.5]`
   * (`rampDomain`'s own tie-break, kept so `colorForValue` still lands on a real mid-ramp colour --
   * see reportMap.ts), but a "ramp 33 to 34" legend/caption for ONE value states a precision no
   * data supports and has no "highest"/"lowest" to contrast. `null` for 0 or >=2 places, or a lone
   * place whose score has not landed yet. */
  single: { name: string; score: number; color: string } | null;
}

export interface ReportFlower {
  name: string;
  geometry: FlowerGeometry;
  /** the number printed in the ring's centre: `round(Overall)` -- see this module's header. */
  centre: number | null;
  /** the drawn petals' own mean, which differs from `centre` whenever a category collision dropped
   * a component from the ring (v8/v9's `primprod`). */
  centreOfDrawnPetals: number | null;
  /** components the ring could not draw because they resolved to an already-taken category. */
  droppedLabels: string[];
  /** the accessibility gate's phrasing (atlas-7 Gates): "GAA: highest component Fish 71, lowest
   * Turtle 3; overall 42." */
  summary: string;
  /** the fuller listing, from the SAME shared function the lens's flower panel uses. */
  detail: string;
  /** fix round 2, item 1 (spec §2.5, corrected -- the old report's own text was STALE, still
   * saying "reptile, other", both retired on v8/v9): names THIS release's actual components
   * (`scores.components`, never a hardcoded list), states the equal-weight/mean rule, and -- only
   * when `droppedLabels` is non-empty -- says a duplicated component was folded rather than drawn
   * as its own petal. */
  narrative: string;
}

export interface ReportSpeciesTop {
  rows: TopSpeciesRow[];
  /** one href per row, same order: the Species lens, in this release. */
  hrefs: string[];
  summary: string;
}

export interface ReportSpecies {
  name: string;
  /** `null` while the species query is still running (progressive rendering). */
  counts: SpeciesCounts | null;
  top: ReportSpeciesTop | null;
  /** the full list, in `arrange(sp_cat, sp_scientific)` order -- the CSV's rows. */
  full: SpeciesRow[] | null;
  csvColumns: readonly string[];
  csvFilename: string;
  caption: string | null;
  /** `"No species found for this area."` when the query ran and found none (§6c). */
  empty: string | null;
  summary: string | null;
}

export interface ReportSources {
  text: string[];
  docsHref: string;
  citations: Citation[];
}

export interface ReportModel {
  header: ReportHeader;
  intro: ReportIntro;
  parameters: ReportParameter[];
  map: ReportMap;
  flowers: ReportFlower[];
  scores: ScoresTable;
  species: ReportSpecies[];
  /** the static method narrative for the WHOLE Summary of Species section (fix round 2, item 1
   * -- spec §2.7, verbatim): the counts/top-20/CSV description, then the ER-consolidation note.
   * One narrative for the section, not per place -- it describes the method, not a place. */
  speciesNarrative: string;
  sources: ReportSources;
  provenance: Provenance;
  /** every figure's text equivalent, in document order -- the accessibility gate reads THIS. */
  summaries: string[];
}

// ---- boot readers ---------------------------------------------------------------------------

interface BootZoneRow {
  key?: unknown;
  name?: unknown;
  n_cells?: unknown;
  area_km2?: unknown;
  metrics?: Record<string, unknown>;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function zoneRow(boot: unknown, unit: string, key: string): BootZoneRow | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  return (rows as BootZoneRow[]).find((r) => r && String(r.key) === key) ?? null;
}

/**
 * A zone place's components, straight out of `boot.zones[unit][key].metrics` (= the published
 * `zone_metric`), NEVER recomputed -- which is what makes "the zone flower and zones table equal
 * `zone_metric` exactly" trivially true here as it is in `lens/scores/zonesTable.ts`.
 *
 * `coverage` is not published under that name, but both the post-weight value and its
 * `_prepctareaweighting` twin are, and `score = coverage * mean_where_present` is an identity of
 * how `zone_metric` was built (`workflows/score_zone_metrics.qmd:72-92`, steps (a) and (c)). So
 * coverage is exactly `post / pre` and `mean_where_present` IS the pre value -- which is what lets
 * a zone place carry the same D7b footnotes a custom place does. A release that publishes no `_pre`
 * twin yields `null` for both, and `scores.ts` then footnotes nothing for that component (see its
 * `COVERAGE_FOOTNOTE_FLOOR_PCT` note: "we cannot say" is not "it is complete").
 */
export function zoneComponents(boot: unknown, unit: string, key: string): ReportComponent[] {
  const row = zoneRow(boot, unit, key);
  const metrics = row?.metrics;
  if (!metrics || typeof metrics !== "object") return [];
  const keys = Object.keys(metrics)
    .filter((k) => /_ecoregion_rescaled$/.test(k))
    .sort();
  const out: ReportComponent[] = [];
  for (const metricKey of keys) {
    const score = num(metrics[metricKey]);
    if (score === null) continue;
    const component = componentLabelOf(metricKey);
    if (component === "all") continue;
    const pre = num(metrics[`${metricKey}_prepctareaweighting`]);
    out.push({
      metric_key: metricKey,
      component,
      score,
      even: 1,
      coverage: pre !== null && pre !== 0 ? score / pre : null,
      mean_where_present: pre,
    });
  }
  return out;
}

/** the zone's published `n_cells` / `area_km2` (§"Numbers": a zone place's N cells and area come
 * from boot, not from a coverage run). */
export function zoneScoreInput(boot: unknown, unit: string, key: string): PlaceScoreInput {
  const row = zoneRow(boot, unit, key);
  return {
    components: zoneComponents(boot, unit, key),
    nCells: num(row?.n_cells),
    areaKm2: num(row?.area_km2),
    studyAreaPct: null,
  };
}

// ---- place expansion -------------------------------------------------------------------------

const ZONE_SET_TO_UNIT: Readonly<Record<string, string>> = {
  pa: "programarea",
  pl: "planarea",
  er: "ecoregion",
  sr: "subregion",
};

export interface PlaceStub {
  place: Place;
  zoneKey?: string;
  name: string;
  token: string;
  unit?: string;
}

/**
 * The reported places, in the URL's order, with a multi-key zone place split into one entry PER
 * KEY. The caller runs one query set per entry and hands the results back through
 * `ReportPlaceInput` -- so the split happens once, here, rather than in every caller.
 *
 * A zone place's name comes from `boot.zones[unit][key].name`, formatted "Full Name (KEY)"
 * (`paLabel`, P3 fix, owner-directed 2026-09-24: "its caption / first mention should use the full
 * name") -- falling back to the bare key when the release publishes none (an old link naming a key
 * a later release retired still gets a row, with its key as its name, rather than being silently
 * dropped).
 */
export function expandPlaces(
  places: readonly Place[],
  boot: unknown,
  /** a place whose report token is NOT its own encoding: a `p.` gazetteer place resolved to a
   * `geom` place keeps its original `p.` token (report/gazPlaces.ts). */
  tokenOverride?: ReadonlyMap<Place, string>,
): PlaceStub[] {
  const out: PlaceStub[] = [];
  for (const place of places) {
    if (place.kind === "zone") {
      const unit = ZONE_SET_TO_UNIT[place.set] ?? place.set;
      for (const key of place.keys) {
        const row = zoneRow(boot, unit, key);
        const single: Place = { kind: "zone", set: place.set, keys: [key] };
        out.push({
          place: single,
          zoneKey: key,
          unit,
          // V1 fix: pass `unit` so the app-side PROGRAM_AREA_NAMES fallback (zoneStats.ts#paLabel)
          // only fires for a Program Area place, never for an er/sr/pl place that happens to share
          // a key with one.
          name: paLabel(key, typeof row?.name === "string" ? row.name : undefined, unit),
          token: encodePlace(single),
        });
      }
      continue;
    }
    out.push({
      place,
      name: place.kind === "gaz" ? place.name || place.id : place.name,
      token: tokenOverride?.get(place) ?? encodePlace(place),
    });
  }
  return out;
}

// ---- the build -------------------------------------------------------------------------------

function releaseField(boot: unknown, field: "status" | "access"): string | null {
  const rel = (boot as { release?: Record<string, unknown> } | null | undefined)?.release;
  const v = rel && typeof rel === "object" ? rel[field] : undefined;
  return typeof v === "string" && v ? v : null;
}

/**
 * D7b's "share of this place inside the study area", as a PERCENT.
 *
 * DERIVED from the two counts whenever the caller measured the touched set, never taken on trust:
 * `nCells` is the D7b-clipped set that every number in the document was computed over, so
 * `nCells / nCellsTouched` IS the share, and a caller that bypassed the clip (passing the touched
 * count as `nCells`) then states 100 % -- a false claim the seeded fault in
 * `tests/lib/report/faults.ts` plants on purpose and `faults.test.ts` catches. A zone place has no
 * touched set to compare against (a published zone IS the study area) and falls back to the
 * supplied value.
 */
function studyAreaShare(scores: PlaceScoreInput | null | undefined): number | null {
  if (!scores) return null;
  const touched = scores.nCellsTouched;
  if (typeof touched === "number" && Number.isFinite(touched) && touched > 0) {
    return ((scores.nCells ?? 0) / touched) * 100;
  }
  return scores.studyAreaPct ?? null;
}

function vertexCount(geom: AreaGeometry | undefined): number | null {
  if (!geom) return null;
  let n = 0;
  for (const rings of polygonsOf(geom)) for (const ring of rings) n += ring.length;
  return n;
}

/** the Atlas map at this release, RELATIVE (CLAUDE.md's relative-base rule: `report.html` and
 * `index.html` are siblings under whatever mount point serves them). */
function appHref(ver: string, patch: Partial<Sel> = {}): string {
  const sel: Sel = { ...DEFAULT_SEL, ver, ...patch };
  const { search, hash } = formatSel(sel);
  return `./index.html${search}${hash}`;
}

/** "GAA: highest component Fish 71, lowest Turtle 3; overall 42." (atlas-7 Gates shape, P round V2
 * fix: `hi`/`lo`'s raw keys now go through `categoryLabel()` -- this sentence is printed VISIBLY in
 * the report, `<p>{f.summary}</p>`, never sr-only, so "highest component primprod" read exactly as
 * jarring as the report's own table header did (Opus eyes-on). */
export function describeFlower(
  name: string,
  geometry: FlowerGeometry,
  overall: number | null,
): string {
  const petals = geometry.petals;
  if (petals.length === 0) return `${name}: no component has a score.`;
  let hi = petals[0];
  let lo = petals[0];
  for (const p of petals) {
    if (p.score > hi.score) hi = p;
    if (p.score < lo.score) lo = p;
  }
  const overallText = overall === null ? "no data" : formatScore0(overall);
  return (
    `${name}: highest component ${categoryLabel(hi.key)} ${formatScore0(hi.score)}, ` +
    `lowest ${categoryLabel(lo.key)} ${formatScore0(lo.score)}; overall ${overallText}.`
  );
}

function describeMap(places: readonly ReportMapPlace[], domain: [number, number] | null): string {
  const scored = places.filter((p) => p.score !== null);
  if (scored.length === 0 || domain === null) {
    return `Map: ${places.length} place${places.length === 1 ? "" : "s"}, none with a mean score.`;
  }
  // W4 fix (design call noted twice by reviewers, then Ben's phone report): a lone place has no
  // "highest"/"lowest" to contrast against, and `rampDomain`'s ±0.5 tie-break (kept below so the
  // FILL still lands on a real mid-ramp colour, see `ReportMap.single`) would otherwise read here
  // as a fabricated "ramp 33 to 34" -- a precision no single value supports. State its own score.
  if (places.length === 1) {
    const p = scored[0];
    return `Map: 1 place colored by mean score; ${p.name} scored ${formatScore0(p.score as number)}.`;
  }
  const sorted = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  return (
    // P round V5 fix (Opus eyes-on: phone-14's caption spelled "coloured", desktop-13's map intro
    // spelled "colored", in the SAME report) -- American English throughout, matching the docs book.
    `Map: ${places.length} place${places.length === 1 ? "" : "s"} colored by mean score, ` +
    `ramp ${formatScore0(domain[0])} to ${formatScore0(domain[1])} (red = high); ` +
    `highest ${hi.name} ${formatScore0(hi.score)}, lowest ${lo.name} ${formatScore0(lo.score)}.`
  );
}

function describeCounts(name: string, counts: SpeciesCounts): string {
  const byTotal = [...counts.rows].sort((a, b) => b.total - a.total);
  // P round V5 fix (Opus eyes-on: raw lowercase sp_cat leaking into report prose, same class of
  // bug V2 fixed for the flower narrative) -- `r.category` is the raw sp_cat (er.ts's own comment:
  // "categories.ts supplies the display label"); this sentence reads it through categoryLabel().
  const top = byTotal
    .slice(0, 3)
    .map((r) => `${categoryLabel(r.category)} ${formatCount(r.total)}`);
  return (
    `${name}: ${formatCount(counts.nSpecies)} species across ${counts.rows.length} ` +
    `categor${counts.rows.length === 1 ? "y" : "ies"} and ${counts.columns.length} ` +
    `extinction-risk categor${counts.columns.length === 1 ? "y" : "ies"}` +
    (top.length ? `; largest ${top.join(", ")}.` : ".")
  );
}

function describeTop(name: string, rows: readonly TopSpeciesRow[]): string {
  if (rows.length === 0) return `${name}: no species to rank.`;
  const first = rows[0];
  return (
    `${name}: top ${rows.length} species by habitat-weighted extinction risk; ` +
    `highest ${first.sp_scientific} (${first.sp_cat}) ${formatScore0(first.suit_er_area)}.`
  );
}

// UI-15 (round-3 review): reader copy drops "immutable" and "marine atlas" -- both name internal
// data-repo/versioning concepts a reader of the REPORT has no reason to know. "data release {ver}"
// is the same product-naming form the welcome modal and version picker now use.
const INTRO =
  `This report was computed in your browser from data release {ver} of the ${WORDMARK_TEXT} ` +
  "— no geometry left this device and nothing was rendered on a server. The link above " +
  "reproduces it exactly. Scores are ecoregionally rescaled to 0–100 within each BOEM Ecoregion, " +
  "so they reflect relative sensitivity within a region rather than absolute values across " +
  "regions.";

// fix round 2, item 1 (spec §2.4, verbatim) -- static, but still a MODEL field (never a literal
// in Report.svelte): the component just renders whatever this module hands it.
const MAP_NARRATIVE =
  "Areas of interest colored by mean sensitivity score using a Spectral color ramp (red = " +
  "high, blue = low). Scores are ecoregionally rescaled to a 0–100 range within each BOEM " +
  "Ecoregion, so they reflect relative sensitivity within a region rather than absolute values " +
  "across regions.";

/** fix round 2, item 1 (spec §2.5, CORRECTED): names `components` (this report's own, from
 * `scores.components` -- never a hardcoded list, and never the retired "reptile"/"other"), states
 * the equal-weight/mean rule, and -- only when a category collision folded a component -- says so.
 * P round V2 fix: `components`/`droppedLabels` are raw keys ("bird", "primprod") -- this sentence is
 * printed VISIBLY (`<p class="narrative">`, never sr-only), so each name goes through
 * `categoryLabel()` before joining (Opus eyes-on: "components (bird, coral, fish, invertebrate,
 * mammal, other, turtle, primprod)" read straight off the raw metric-key spellings). */
function describeFlowerNarrative(
  components: readonly string[],
  droppedLabels: readonly string[],
): string {
  const list = components.length
    ? components.map((c) => categoryLabel(c)).join(", ")
    : "no components";
  let text =
    `Flower plot where each petal represents one of this release's species-sensitivity ` +
    `components (${list}). Petal length reflects the component sensitivity score (0–100); ` +
    `every component carries equal weight, and the center value is the mean of the equally ` +
    `weighted components.`;
  if (droppedLabels.length) {
    text +=
      ` ${droppedLabels.map((c) => categoryLabel(c)).join(", ")} duplicated an already-drawn ` +
      `category in this release and was folded into the total rather than drawn as its own petal.`;
  }
  return text;
}

// fix round 2, item 1 (spec §2.7, verbatim): the method narrative for the WHOLE species section,
// including the ER-consolidation note (er.ts#erConsolidate's own rule, spelled out for a reader).
const SPECIES_NARRATIVE =
  "Species counts by category and extinction risk, the top 20 highest-scoring species (ranked " +
  "by habitat-weighted extinction risk), and a link to download the full species list as CSV. " +
  'Extinction risk categories are consolidated: "FWS" and "NMFS" codes are combined to ' +
  '"USA"; the parenthetical number is the extinction-risk score (1–100) used in sensitivity ' +
  'weighting. The "other" category includes IUCN:DD (Data Deficient), IUCN:LC (Least ' +
  "Concern), and species with no assigned risk code.";

const SOURCES_TEXT = [
  "Component scores are the eight ecoregion-rescaled metrics of this release: seven " +
    "extinction-risk-weighted species-category surfaces plus primary productivity. Each is the " +
    "coverage-weighted mean over the cells of the area, with cells that carry no value counted as " +
    "zero inside the study area and land and foreign waters excluded entirely.",
  // P3 fix (Opus eyes-on review, 2026-09-24): "modelled" -> "modeled" -- this app's own copy is
  // US spelling throughout (CLAUDE.md/docs convention), this line was the one holdout.
  "Species rows are every distribution model whose range overlaps the area, weighted by modeled " +
    "habitat suitability, the governing extinction-risk score and the overlapping area.",
];

/**
 * THE function (atlas-7 step 1). Pure, synchronous, no fetch: every query result is an input, and
 * every one of them may be `null` while it is still running.
 */
export function buildReport(input: BuildReportInput): ReportModel {
  const { ver, boot, now } = input;
  const title = input.title?.trim() || DEFAULT_TITLE;
  const status = input.status !== undefined ? input.status : releaseField(boot, "status");
  const access = input.access !== undefined ? input.access : releaseField(boot, "access");
  const restricted = access === "restricted";
  const gridId =
    (boot as { grid?: { grid_id?: unknown } } | null | undefined)?.grid?.grid_id ?? null;

  // --- header ---------------------------------------------------------------------------------
  const placeTokens = input.places.map((p) => p.token).join("~");
  const { search, hash } = formatSel({
    ...DEFAULT_SEL,
    ver,
    t: title === DEFAULT_TITLE ? undefined : title,
    pl: placeTokens || undefined,
  });
  const origin = input.permalink?.origin ?? "";
  const path = input.permalink?.path ?? "./report.html";
  const header: ReportHeader = {
    title,
    ver,
    status,
    access,
    releaseChip: [ver, status, access].filter((s): s is string => !!s).join(" · "),
    generatedAt: isoInstant(now),
    generatedLabel: utcStamp(now),
    permalink: { href: `${origin}${path}${search}${hash}`, origin, path, search, hash },
    preview: input.preview === true,
    previewBanner: restricted ? "PREVIEW — not for citation or distribution" : null,
    filePrefix: restricted ? "PREVIEW_" : "",
    fileStem:
      `${restricted ? "PREVIEW_" : ""}${REPORT?.stem ?? "report"}_${slugify(title)}_${ver}_` +
      `${isoInstant(now).slice(0, 10)}`,
  };

  // --- parameters -----------------------------------------------------------------------------
  const parameters: ReportParameter[] = input.places.map((p) => ({
    name: p.name,
    kind: p.place.kind,
    zoneKeys: p.place.kind === "zone" ? [...p.place.keys] : null,
    vertexCount: vertexCount(p.geometry),
    bbox: p.geometry ? bboxOf(p.geometry) : null,
    areaKm2: p.scores?.areaKm2 ?? null,
    nCells: p.scores?.nCells ?? null,
    studyAreaPct: studyAreaShare(p.scores),
    token: p.token,
    d7bNote: p.place.kind === "geom" ? D7B_NOTE : null,
  }));

  // --- map ------------------------------------------------------------------------------------
  const overalls = input.places.map((p) => (p.scores ? overallScore(p.scores.components) : null));
  const mapPlaces: ReportMapPlace[] = input.places.map((p, i) => ({
    name: p.name,
    score: mapScore(overalls[i]),
  }));
  const domain = rampDomain(mapPlaces.map((p) => p.score));
  // W4 fix: the ONE place's resolved swatch colour, for the caller to draw instead of a two-ended
  // gradient legend that implies a range a single value never had (see `ReportMap.single`'s own
  // doc). Same palette name and same `colorForValue()` call `zoneKeyColors`/`scoreColorExpression`
  // use (reportMap.ts) -- `colorForValue` on the ±0.5-widened `domain` always lands on the exact
  // MIDDLE stop for a lone value, so this is not a second color rule, just resolving it here too.
  const single =
    mapPlaces.length === 1 && domain !== null && mapPlaces[0].score !== null
      ? (() => {
          const stops = paletteStopsFromBoot(boot as { palettes?: unknown }, "spectral_r");
          if (!stops) return null;
          const score = mapPlaces[0].score as number;
          return {
            name: mapPlaces[0].name,
            score,
            color: colorForValue(stops, score, domain[0], domain[1]),
          };
        })()
      : null;
  const map: ReportMap = {
    places: mapPlaces,
    domain,
    legendTitle: "Mean score",
    summary: describeMap(mapPlaces, domain),
    narrative: MAP_NARRATIVE,
    single,
  };

  // this report's own component columns (the SAME list the Table of Scores has -- componentColumns()
  // itself, not a second derivation), used by the flower narrative below so it can never drift from
  // what the table actually shows.
  const allComponents = componentColumns(
    input.places.map((p) => ({ components: p.scores?.components ?? [] })),
  );

  // --- flowers --------------------------------------------------------------------------------
  const flowers: ReportFlower[] = input.places.map((p, i) => {
    const components = p.scores?.components ?? [];
    // the SAME de-duplication the scores lens applies (one slot per resolved category, the
    // ER-weighted species term winning a collision) -- `lens/scores/flower.ts`, not a copy of it.
    const deduped = dedupeFlowerComponents(
      components.map((c) => ({
        key: c.component,
        score: Number.isFinite(c.score) ? c.score : null,
        preferred: c.metric_key.startsWith("extrisk_"),
      })),
    );
    const safe = computeFlowerGeometrySafe(deduped.components);
    const overall = overalls[i];
    return {
      name: p.name,
      geometry: safe.geometry,
      centre: overall === null ? null : Math.round(overall),
      centreOfDrawnPetals:
        safe.geometry.centerValue === null ? null : Math.round(safe.geometry.centerValue),
      droppedLabels: [...deduped.droppedLabels, ...safe.droppedKeys],
      summary: describeFlower(p.name, safe.geometry, overall),
      detail: describeFlowerSummary(p.name, safe.geometry),
      narrative: describeFlowerNarrative(allComponents, [
        ...deduped.droppedLabels,
        ...safe.droppedKeys,
      ]),
    };
  });

  // --- table of scores ------------------------------------------------------------------------
  const tablePlaces: ScoresTablePlace[] = input.places.map((p, i) => ({
    name: p.name,
    areaKm2: p.scores?.areaKm2 ?? null,
    nCells: p.scores?.nCells ?? null,
    components: p.scores?.components ?? [],
    overall: overalls[i],
  }));
  const scores = scoresTable(tablePlaces);

  // --- species --------------------------------------------------------------------------------
  const dateStamp = isoInstant(now).slice(0, 10);
  const species: ReportSpecies[] = input.places.map((p) => {
    const rows = p.species ?? null;
    if (rows === null) {
      return {
        name: p.name,
        counts: null,
        top: null,
        full: null,
        csvColumns: SPECIES_CSV_COLUMNS,
        csvFilename: `${header.filePrefix}species_${slugify(p.name)}_${ver}_${dateStamp}.csv`,
        caption: null,
        empty: null,
        summary: null,
      };
    }
    const full = sortSpeciesRows(rows);
    const counts = speciesCounts(full);
    const topRows = topSpecies(full);
    return {
      name: p.name,
      counts: rows.length ? counts : null,
      top: rows.length
        ? {
            rows: topRows,
            hrefs: topRows.map((r) =>
              appHref(ver, { lens: "species", sp: r.mdl_key, out: "none" }),
            ),
            summary: describeTop(p.name, topRows),
          }
        : null,
      full,
      csvColumns: SPECIES_CSV_COLUMNS,
      csvFilename: `${header.filePrefix}species_${slugify(p.name)}_${ver}_${dateStamp}.csv`,
      caption: rows.length
        ? `Species counts by category and extinction-risk category (${formatCount(counts.nSpecies)} species).`
        : null,
      // §6c, verbatim: the old report's own empty-case string.
      empty: rows.length ? null : "No species found for this area.",
      summary: rows.length ? describeCounts(p.name, counts) : `${p.name}: no species found.`,
    };
  });

  // --- sources + provenance --------------------------------------------------------------------
  const docsHref = `${DOCS_ROOT}${ver}/`;
  const sources: ReportSources = {
    text: SOURCES_TEXT,
    docsHref,
    citations: citedDatasets(boot),
  };

  const provenance = buildProvenance({
    ver,
    boot,
    status,
    access,
    appSha: input.appSha,
    duckdbWasm: input.duckdbWasm ?? null,
    now,
    tables: input.tables,
    sql: input.sql ?? [],
    targets: input.places.map((p) =>
      p.place.kind === "zone"
        ? {
            ver,
            gridId: typeof gridId === "string" ? gridId : null,
            zoneFld: `${ZONE_SET_TO_UNIT[p.place.set] ?? p.place.set}_key`,
            zoneKeys: p.place.keys,
          }
        : { ver, gridId: typeof gridId === "string" ? gridId : null, token: p.token },
    ),
  });

  const summaries = [
    map.summary,
    ...flowers.map((f) => f.summary),
    scores.summary,
    ...species.flatMap((s) => [s.summary, s.top?.summary].filter((t): t is string => !!t)),
  ];

  return {
    header,
    intro: {
      ver,
      text: INTRO.replace("{ver}", ver),
      // UI-7 (round-3 review): carries the report's OWN place token(s) -- opening "this release in
      // the Atlas" from a multi-place report used to land on the bare default view with none of
      // the report's places loaded; `placeTokens` is the SAME `pl=` value the header's own
      // permalink already encodes (above), just reused as `appHref`'s patch.
      appHref: appHref(ver, { pl: placeTokens || undefined }),
      docsHref,
    },
    parameters,
    map,
    flowers,
    scores,
    species,
    speciesNarrative: SPECIES_NARRATIVE,
    sources,
    provenance,
    summaries,
  };
}

export { componentColumns, overallScore } from "./scores";
