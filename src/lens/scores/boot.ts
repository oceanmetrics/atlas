// atlas-4 step 1 — pure readers over `boot.json`'s scores-relevant shape: the drawable unit (D17:
// exactly one per release), the layer picker's groups/default, the study-area note and the
// "everything this release scored" zone key. No DOM, no map, no engine — every function here takes
// a plain `boot` and returns plain data, so a component only calls it (CLAUDE.md).
//
// `boot.units[]` carries exactly ONE row (master plan D17: programarea on v2-v9, planarea on v1;
// no subregion/ecoregion unit is ever published as a SELECTABLE spatial unit, whatever the geometry
// would support), so "the ONE `boot.units` row" is read positionally (`units[0]`), never by
// filtering for a type — there is nothing to filter among.
//
// R3 orchestrator audit item 2 (2026-09-24): `boot.units[]` NEVER publishes ecoregion, but the
// release's MANIFEST does (`manifest.json`'s own `zones[]`, verified live on v7: a
// `zone_set_key: "ecoregion_2025-06"` row with `fld: "ecoregion_key"` + a real `pmtiles` URL) —
// the ARCHIVE exists, it is simply never offered as a selectable unit. The ported Shiny app draws
// a standalone black 3px ecoregion outline on every scores view regardless of the selected spatial
// unit; this app drew none, so the Atlantic/Hawaii/Puerto Rico portions of the study area (outside
// every Program Area) had NO outline at all. `ecoregionZoneUnitFromManifest` (below) is the fix:
// an ALWAYS-ON outline (never a fill, never a choropleth — D17 stands, this is decoration, not a
// second selectable unit), read from the manifest, independent of `sel.unit`/`sel.out`.
import { unitFromFld } from "../../lib/map/layers/zones";
import type { ZoneUnitSpec } from "../../lib/map/types";
// `componentLabel` is a pure metric_key -> label transform (no scores-lens STATE) -- reused here so
// `flowerMaxComponentScore`'s own "which metrics are the flower's components" filter can never drift
// from the SAME rule `flower.ts#fromMetrics` uses to build the petals themselves. A type-only import
// already runs the other way (`flower.ts` -> `ZoneRow` from this file), so this adds no runtime cycle.
import { componentLabel } from "./flower";

export interface BootLayerRow {
  metric_key: string;
  label?: string;
  category: string;
  order: number;
  colormap?: string;
  by_subregion?: Record<string, { cog?: string; rescale?: [number, number] }>;
}

interface RawUnitRow {
  fld?: unknown;
  label?: unknown;
}

/** the release's one drawable unit's label (`boot.units[0].label`), or `null` when unpublished
 * (a boot with no units at all — e.g. before atlas-1 has published `boot.json`). */
export function primaryUnitLabel(boot: unknown): string | null {
  const units = (boot as { units?: unknown } | null | undefined)?.units;
  const row = Array.isArray(units) ? (units[0] as RawUnitRow | undefined) : undefined;
  return row && typeof row.label === "string" ? row.label : null;
}

/** the release's one drawable unit's TYPE (`fld` minus `_key`) — `"programarea"` everywhere except
 * v1, which is `"planarea"` (D17). `null` when unpublished. */
export function primaryUnitType(boot: unknown): string | null {
  const units = (boot as { units?: unknown } | null | undefined)?.units;
  const row = Array.isArray(units) ? (units[0] as RawUnitRow | undefined) : undefined;
  return row && typeof row.fld === "string" ? unitFromFld(row.fld) : null;
}

/** the Spatial units toggle's options: `Raster cells` always first, then the release's one
 * drawable unit (derived from `boot.units[0]`, never hardcoded) when it publishes one.
 *
 * R3 (Ben, live-review 2026-09-25): "drop clunky '(0.05°)'" -- the resolution note is not load-
 * bearing on the toggle itself; a caller that still wants it available can read the grid's own
 * resolution from elsewhere (it was never sourced from THIS string in the first place). */
export function unitOptions(boot: unknown): { value: string; label: string }[] {
  const options = [{ value: "cell", label: "Raster cells" }];
  const type = primaryUnitType(boot);
  const label = primaryUnitLabel(boot);
  if (type && label) options.push({ value: type, label });
  return options;
}

/**
 * The sidebar note (atlas-4 §5.3 / parity doc §5.3): shown only when the release's one unit is NOT
 * `programarea` — today that is v1 alone, reporting on Planning Areas. `null` means "no note" (the
 * unit IS `programarea`, or the release publishes no unit at all — nothing to caveat).
 */
export function primaryUnitNote(boot: unknown, ver: string | null): string | null {
  const type = primaryUnitType(boot);
  const label = primaryUnitLabel(boot);
  if (!type || !label || type === "programarea") return null;
  return `${ver ?? "This release"} predates the BOEM Program Areas — it reports on ${label}.`;
}

/** the fixed display order of the layer picker's groups: the overall score first (matching the
 * ported app's "order 1 = Overall" convention — see boot.ts's module test for why this is NOT
 * `boot.layers[].order`, which the publisher numbers the other way, composite last), then the
 * ecoregion-rescaled components, then the raw metrics. */
const CATEGORY_GROUP_ORDER = ["composite", "component", "raw"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  composite: "Overall score",
  component: "Rescaled by ecoregion",
  raw: "Raw",
};

export interface LayerGroup {
  category: string;
  label: string;
  layers: BootLayerRow[];
}

function isLayerRow(raw: unknown): raw is BootLayerRow {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as BootLayerRow).metric_key === "string" &&
    typeof (raw as BootLayerRow).category === "string" &&
    typeof (raw as BootLayerRow).order === "number"
  );
}

/** every `boot.layers` row, validated, in the release's own order. */
export function layerRows(boot: unknown): BootLayerRow[] {
  const rows = (boot as { layers?: unknown } | null | undefined)?.layers;
  return Array.isArray(rows) ? rows.filter(isLayerRow) : [];
}

/**
 * The layer `<select>`'s groups: composite first (there is exactly one — the "overall score"),
 * then component, then raw, each sorted by the row's own `order` ascending. A category the release
 * does not publish is simply absent, never an empty group.
 */
export function layerGroups(boot: unknown): LayerGroup[] {
  const rows = layerRows(boot);
  const groups: LayerGroup[] = [];
  for (const category of CATEGORY_GROUP_ORDER) {
    const layers = rows.filter((r) => r.category === category).sort((a, b) => a.order - b.order);
    if (layers.length) groups.push({ category, label: CATEGORY_LABEL[category], layers });
  }
  // an unrecognized category (a future release) still gets a group, appended last, rather than
  // silently dropping those layers from the picker.
  const known = new Set<string>(CATEGORY_GROUP_ORDER);
  const otherCategories = [...new Set(rows.map((r) => r.category).filter((c) => !known.has(c)))];
  for (const category of otherCategories) {
    groups.push({
      category,
      label: category,
      layers: rows.filter((r) => r.category === category).sort((a, b) => a.order - b.order),
    });
  }
  return groups;
}

/**
 * The default layer: the release's one `category === "composite"` row (the overall score) —
 * derived, never `boot.layers[0]` or a hardcoded metric_key. `null` for a boot with no composite
 * row at all (should not happen on a published release, but this module never assumes it).
 */
export function defaultLayerKey(boot: unknown): string | null {
  const composite = layerRows(boot).find((r) => r.category === "composite");
  return composite?.metric_key ?? null;
}

export function layerByKey(boot: unknown, key: string | undefined | null): BootLayerRow | null {
  if (!key) return null;
  return layerRows(boot).find((r) => r.metric_key === key) ?? null;
}

/**
 * R3-B1 (round-3 plan): the ONE place a bare `metric_key` becomes display text when the release
 * publishes no USEFUL label for it — a release's composite row is sometimes literally `metric_key:
 * "score"` with no `label` and no `manifest.metrics` entry, and every caller's own fallback chain
 * used to end on that raw key verbatim ("score", lowercase) instead of title-casing it, the same
 * class of bug `lib/ui/categories.ts#categoryLabel` already fixes for a raw sp_cat/component key
 * ("primprod" -> "Primary producer" there; this is the metric_key/layer-picker equivalent).
 * Underscores become spaces first (a real key can be `no_data` etc.), then only the FIRST letter is
 * capitalized — "score" -> "Score", "some_key" -> "Some key" — matching `categoryLabel`'s own
 * "sentence case, not Title Case" convention so the two never read inconsistently side by side.
 *
 * Fix round (orchestrator, 2026-09-25): "the select/legend/chip still show 'score' — the
 * manifest's curated label EQUALS the key." A release can publish a real, non-blank
 * `manifest.metrics` row whose `label` is ALSO just the bare key verbatim ("score") — a degenerate
 * curated label, not an absent one, so the OLD `metricLabels[key] ?? layer?.label ??
 * metricKeyLabel(key)` chain found a truthy value on the first `??` and never reached this
 * function at all. `label` is now this function's OWN second argument: title-casing fires when
 * the resolved label is absent/blank OR case-insensitively IDENTICAL to `key` — a real, DIFFERENT
 * curated label (however it was spelled) is returned unchanged either way. Every caller now routes
 * its whole `metricLabels[key] ?? layer?.label` chain through here as `label`, rather than calling
 * this only as the final `??` link.
 *
 * `ScoresLens.svelte`'s `metricLabel()` (the Layer `<select>`), `mapInputs.ts`'s legend `title`
 * (which `ScoresLegend.svelte`'s `<h2>` AND `LegendChip.svelte`'s chip text both read verbatim —
 * one fix covers all three surfaces the plan names) both call this now.
 *
 * R3-W7 follow-up (Ben, 2026-09-25): a v7 manifest publishes a REAL, non-degenerate curated label
 * for the composite row that is itself the literal lowercase word "score" (`label !== key`, so the
 * `isUseful` branch above fired and returned it VERBATIM) — the Layer select, legend and chip all
 * still read lowercase "score" beside every other sentence-cased label on the same panel. Sentence
 * case is now applied to the FIRST character of every label this function returns, useful or
 * fallback alike — the only thing that changed is a real, differently-worded curated label no
 * longer bypasses the casing rule this function exists to enforce.
 */
export function metricKeyLabel(key: string, label?: string | null): string {
  const trimmedKey = key.trim();
  const trimmedLabel = typeof label === "string" ? label.trim() : "";
  const isUseful = trimmedLabel !== "" && trimmedLabel.toLowerCase() !== trimmedKey.toLowerCase();
  const raw = isUseful ? trimmedLabel : trimmedKey.replace(/_/g, " ");
  return raw ? raw[0].toUpperCase() + raw.slice(1) : raw;
}

/** `layer.by_subregion.FULL` — the raster is ALWAYS the FULL COG (D7: "the study area is a camera,
 * never a filter"); `subregionKey` is only ever overridden by a test. */
export function fullSubregion(
  layer: BootLayerRow,
  subregionKey = "FULL",
): { cog?: string; rescale?: [number, number] } | null {
  return layer.by_subregion?.[subregionKey] ?? null;
}

interface RawManifestMetricRescaleRow {
  metric_key?: unknown;
  subregion_key?: unknown;
  rescale_max?: unknown;
}

/**
 * P round, "Flower plot should be bigger and needs a reference outer circle... based on the
 * maximum component score for given version" (Ben, live-review 2026-09-24). Coordinator follow-up
 * (2026-09-25): the FIRST version of this function read `boot.layers[].by_subregion.FULL.rescale`.
 * P3 fix (Opus eyes-on review, 2026-09-24) correction: an earlier draft of this comment claimed
 * "no real release publishes [`by_subregion`] for a `category: "component"` row (only the
 * composite carries `by_subregion` today)" — checked directly against the real, live v7
 * `app/boot.json` (2026-09-24) and that is FALSE: every one of the 8 `*_ecoregion_rescaled`
 * component rows (`extrisk_{bird,coral,fish,invertebrate,mammal,other,turtle}_ecoregion_rescaled`,
 * `primprod_ecoregion_rescaled`) publishes `by_subregion.FULL.rescale: [0, 100]`, giving the SAME
 * max, 100, `flowerMaxComponentScore` below already reads off the manifest. The release MANIFEST's
 * `metrics[]` (the SAME array `metricLabelsFromManifest` above reads) is used here regardless —
 * not because `by_subregion` is missing, but as the ONE general, versioned contract (one row per
 * `metric_key`×`subregion_key`, each carrying its own `rescale_min`/`rescale_max`) rather than a
 * second reader of the raster-tiling side's own COG metadata: one row per
 * `metric_key`×`subregion_key` — verified live against v7's own `manifest.json` (2026-09-25): every
 * `*_ecoregion_rescaled` row at `subregion_key: "FULL"` — exactly the 8 the flower draws — carries
 * `rescale_max: 100` (ecoregion-rescaling normalizes each component to reach 100 somewhere in the
 * study area, even though the release's OVERALL composite maxes out lower — v7's own composite row,
 * `score_extriskspcat_primprod_ecoregionrescaled_equalweights`, carries `rescale_max: 93`, the same
 * "0-93" the map's own score legend shows, and the SAME 93 `by_subregion.FULL.rescale` gives on
 * that row too). The filter (`_ecoregion_rescaled$` suffix, `FULL` subregion,
 * `componentLabel(...) !== "all"`) mirrors `flower.ts#fromMetrics`'s OWN "which metrics are the
 * flower's components" rule exactly, so the two can never disagree about what counts. `null` only
 * when the manifest publishes no such row at all (has not loaded yet, or a pre-metrics release) —
 * `Flower.svelte` falls back to 100 and says so in that case, rather than pretending a number
 * exists.
 */
export function flowerMaxComponentScore(manifest: unknown): number | null {
  const rows = (manifest as { metrics?: unknown } | null | undefined)?.metrics;
  if (!Array.isArray(rows)) return null;
  const maxima: number[] = [];
  for (const raw of rows as RawManifestMetricRescaleRow[]) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.metric_key !== "string" ||
      raw.subregion_key !== "FULL" ||
      !/_ecoregion_rescaled$/.test(raw.metric_key) ||
      componentLabel(raw.metric_key) === "all" ||
      typeof raw.rescale_max !== "number" ||
      !Number.isFinite(raw.rescale_max)
    ) {
      continue;
    }
    maxima.push(raw.rescale_max);
  }
  return maxima.length > 0 ? Math.max(...maxima) : null;
}

/**
 * `zone_all_key` (parity doc §2.4): the zone meaning "everything this release scored" — first of
 * `FULL`, `USA` present among the release's `subregion` zone keys, else the first available key,
 * else the literal fallback `"USA"`.
 */
export function zoneAllKey(boot: unknown): string {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const subregion = zones && typeof zones === "object" ? zones.subregion : undefined;
  if (!Array.isArray(subregion)) return "USA";
  const keys = subregion
    .map((z) => (z && typeof z === "object" ? (z as { key?: unknown }).key : undefined))
    .filter((k): k is string => typeof k === "string");
  return keys.find((k) => k === "FULL") ?? keys.find((k) => k === "USA") ?? keys[0] ?? "USA";
}

interface RawZoneRow {
  key?: unknown;
  name?: unknown;
  n_taxa?: unknown;
  metrics?: unknown;
  bbox?: unknown;
}

/** `[west, south, east, north]`, WGS84, as `msens::app_zones()` will publish it (R3-C3) — a
 * dateline-crossing zone (e.g. the Aleutians) publishes `west > east` (never a wrapped/negative
 * trick), the SAME "re-express, don't wrap" convention `lib/map/camera.ts#CameraBoundsInput`
 * requires of every bounds input in this app. */
export type ZoneBbox = readonly [west: number, south: number, east: number, north: number];

export interface ZoneRow {
  key: string;
  name?: string;
  n_taxa: number | null;
  metrics: Record<string, number>;
  /** `undefined` when the release publishes none for this zone (every release before R3-C3, and
   * any zone a future release simply omits) — callers fall back to their own bounds source, never
   * assume `[0,0,0,0]` or similar. */
  bbox?: ZoneBbox;
}

/** validates a raw `bbox` value: exactly 4 finite numbers, `west`/`east` within [-180, 180],
 * `south`/`north` within [-90, 90], and `south <= north` (a crossing zone inverts `west`/`east`,
 * never `south`/`north` — there is no "upside-down" bbox). `undefined` for anything else — a
 * malformed or stale bundle degrades to "no bbox published", never a throw. */
function parseZoneBbox(raw: unknown): ZoneBbox | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const [w, s, e, n] = raw;
  for (const v of [w, s, e, n]) if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (w < -180 || w > 180 || e < -180 || e > 180) return undefined;
  if (s < -90 || s > 90 || n < -90 || n > 90) return undefined;
  if (s > n) return undefined;
  return [w, s, e, n];
}

/** every zone of `unit` (`boot.zones[unit]`), validated — the zones table and the choropleth's raw
 * material. `[]` for a unit the release does not publish (never a throw: an unknown `?unit=` must
 * fall back, not crash — CLAUDE.md). */
export function zoneRows(boot: unknown, unit: string): ZoneRow[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: ZoneRow[] = [];
  for (const raw of rows as RawZoneRow[]) {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string") continue;
    const metrics: Record<string, number> = {};
    if (raw.metrics && typeof raw.metrics === "object") {
      for (const [k, v] of Object.entries(raw.metrics as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
      }
    }
    out.push({
      key: raw.key,
      name: typeof raw.name === "string" ? raw.name : undefined,
      n_taxa: typeof raw.n_taxa === "number" ? raw.n_taxa : null,
      metrics,
      bbox: parseZoneBbox(raw.bbox),
    });
  }
  return out;
}

/**
 * R3-B14/C3: the search zoom's PREFERRED bounds source — a published `bbox` on the zone's own row
 * (`msens::app_zones()`, once a release carries one), re-expressed into the antimeridian-safe
 * continuous frame `lib/map/camera.ts#CameraBoundsInput` requires (`east` may exceed 180; NEVER
 * re-wrapped). `null` when the release publishes no bbox for this zone (every release before
 * R3-C3, or a zone a release omits it for) or the key does not resolve — the caller falls back to
 * `zoneBoundsFromMap` (a currently-loaded map tile), exactly as before this existed.
 */
export function zoneBboxFromBoot(
  boot: unknown,
  unit: string,
  key: string,
): readonly [readonly [number, number], readonly [number, number]] | null {
  const bbox = zoneRows(boot, unit).find((z) => z.key === key)?.bbox;
  if (!bbox) return null;
  const [w, s, e, n] = bbox;
  const east = w > e ? e + 360 : e; // dateline-crossing zone publishes west > east
  return [
    [w, s],
    [east, n],
  ];
}

/** `state.svelte.ts`'s `zoneBoundsCache` key -- exported so both the cache writer
 * (`refreshZoneBoundsCache`) and this module's own `zoneKnownBounds` (below) use the identical
 * format; a hand-restated string in either place could silently drift out of sync. */
export function zoneCacheKey(unit: string, key: string): string {
  return `${unit}:${key}`;
}

/**
 * R3-CI (CI run 36158947685, webkit 3/3 -- "Enter flies the camera into the Aleutian Arc's own
 * polygon bbox"): the bounds `state.svelte.ts#selectZone` already has WITHOUT firing a fresh live
 * tile query -- a published `zoneBboxFromBoot`, else an earlier live query's cache hit. Pulled out
 * as its own pure function (never touching a map) so the RETRY this bug fix adds is exactly the
 * same call repeated, not a second hand-written copy of the resolution order.
 *
 * Root cause: `selectZone` resolved bounds with exactly ONE synchronous attempt, at the instant
 * Enter is pressed -- published bbox, then this release's `zoneBoundsCache` (state.svelte.ts),
 * populated by a live, UNFILTERED `querySourceFeatures` over the zones PMTiles source. On a full
 * miss (no bbox published -- true for every release today -- and nothing cached yet) it fell
 * straight to the announce-only branch, camera never moving, PERMANENTLY: no retry. That miss is a
 * real, timing-dependent race, not a geometry bug: MapLibre's `querySourceFeatures` only answers
 * from tiles that have already finished BOTH their network fetch and their worker-side vector-tile
 * parse (`report/reportMap.ts#waitForIdle`'s own header documents the identical class of race for
 * `queryRenderedFeatures` — "idle" itself can fire, or a query can run, before a tile's parse is
 * done even though the matching data is already in flight). On a fast, idle machine the zones
 * layer's initial low-zoom tiles are parsed within a few ms of page load, so a script pressing
 * Enter immediately after `waitForFunction(() => !!window.__atlasMap)` almost always wins the race
 * -- exactly why this was invisible on a fast local machine and in CI's own less-contended jobs,
 * but consistently lost it on CI's shared `e2e (chromium, webkit, firefox)` job, which runs all
 * three engines' full suites fully-parallel on one runner (webkit apparently the slowest to parse
 * there; firefox flaky, right at the timing boundary; chromium always fast enough). */
export function zoneKnownBounds(
  boot: unknown,
  unit: string,
  key: string,
  cache: ReadonlyMap<string, readonly [readonly [number, number], readonly [number, number]]>,
): readonly [readonly [number, number], readonly [number, number]] | null {
  return zoneBboxFromBoot(boot, unit, key) ?? cache.get(zoneCacheKey(unit, key)) ?? null;
}

interface RawManifestZoneRow {
  fld?: unknown;
  pmtiles?: unknown;
}

/**
 * The standalone ecoregion OUTLINE (never a fill/choropleth — D17 stands), read from
 * `manifest.zones[]` — the row whose `fld` is `"ecoregion_key"` (present on every v2+ release per
 * the live registry; `null` for a manifest that has not loaded yet, carries no `zones` array, or
 * genuinely does not publish one — e.g. a stub fixture in a test). `sourceLayer` is derived the
 * SAME way `zoneUnitsFromBoot` derives every OTHER unit's (`unitFromFld(fld)`) — msens' own PMTiles
 * builder names a unit's tippecanoe layer after its type, never a hand-maintained second table.
 *
 * `lineVisible: true`, unconditionally: this outline is NOT gated by `sel.out` (that key controls
 * the release's own SELECTABLE unit's outline — see `zoneUnitsWithOutline`'s header) — it is
 * decoration the ported Shiny app always drew, independent of which spatial unit is selected.
 */
export function ecoregionZoneUnitFromManifest(manifest: unknown): ZoneUnitSpec | null {
  const rows = (manifest as { zones?: unknown } | null | undefined)?.zones;
  if (!Array.isArray(rows)) return null;
  for (const raw of rows as RawManifestZoneRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const { fld, pmtiles } = raw;
    if (typeof fld !== "string" || typeof pmtiles !== "string" || !fld || !pmtiles) continue;
    if (unitFromFld(fld) !== "ecoregion") continue;
    return { unit: "ecoregion", pmtiles, sourceLayer: "ecoregion", lineVisible: true };
  }
  return null;
}

interface RawManifestMetricRow {
  metric_key?: unknown;
  label?: unknown;
}

/**
 * `metric_key` -> the manifest's own SHORT label (`manifest.metrics[]`, one row per
 * metric×subregion — verified live on v7: `{metric_key:"extrisk_bird", label:"bird: ext. risk",
 * description:"Extinction risk for bird", ...}`), deduped (first occurrence wins; the label is the
 * same across every subregion for a given key). This is DISTINCT from `boot.layers[].label`, which
 * (orchestrator audit item 3) actually carries the LONG description text ("Primary productivity:
 * Oregon State Vertically Generalized Production Model (VGPM) from ... 2014 to 2023" for
 * `primprod`) — the ported Shiny app's short names ("score", "fish: ext. risk, ecorgn") come from
 * here, never truncated boot-layer text. `{}` when the manifest has not loaded yet or carries no
 * `metrics` array (a caller falls back to `boot.layers[].label`, never a blank option).
 */
export function metricLabelsFromManifest(manifest: unknown): Record<string, string> {
  const rows = (manifest as { metrics?: unknown } | null | undefined)?.metrics;
  const out: Record<string, string> = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows as RawManifestMetricRow[]) {
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.metric_key === "string" &&
      typeof raw.label === "string" &&
      !(raw.metric_key in out)
    ) {
      out[raw.metric_key] = raw.label;
    }
  }
  return out;
}
