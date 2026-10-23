// places/zoneStats.ts -- a defensive `boot.zones[unit][key]` reader for the places list's area
// km²/coverage %/composite chip (Deliverable 1, "Tier 0": no engine, no fetch -- it's already in
// `boot.json`).
//
// P8 item 2 (P7 handback + Opus docs review finding #27): the ORIGINAL guess here was a flat
// `composite`/`score`/`pct_covered`/`coverage` on each row, and NONE of those exist in a real
// release's `boot.json` -- every Program-Area row was reading undefined fields and falling back to
// "not analysed yet" forever, even though the composite is right there, published. The real shape
// (verified live, `s3://.../marine-atlas/v7/app/boot.json`, `zones.programarea[0]`):
//   { key: "ALA", n_cells: 45790, area_km2: 875225.03, n_taxa: 2503,
//     metrics: { ..., score_extriskspcat_primprod_ecoregionrescaled_equalweights: 28.28, ... },
//     coverage: null }
// The composite lives NESTED under `metrics`, keyed by THIS RELEASE's own composite metric_key --
// `boot.layers.find(l => l.category === "composite").metric_key` is the same rule
// `lens/scores/boot.ts#defaultLayerKey` uses to pick the layer `<select>`'s default (re-derived
// here, not imported, so this stays out of `src/lens/**`; the two can never disagree on WHICH key
// is the composite because both read the identical `boot.layers` contract). `coverage` is
// published EXPLICITLY as `null` on every v7 row -- "not published for this release", a permanent
// fact about the release, never "not analysed yet" (which implies a later step will fill it in;
// there is none for a zone -- its numbers are baked in at release time or they are not).
//
// Still defensive (this file's original rule stands): a boot with no `layers`/`metrics` at all, or
// a future shape that publishes the old flat fields directly, is read without throwing.

import type { Point } from "geojson";
import { zoneLabelsFromBoot } from "../lib/map/layers/zones";
import { componentMetricKeys } from "../lib/analysis/queries";
import { componentLabel } from "../lens/scores/flower";
import { PROGRAM_AREA_NAMES } from "../lib/zones/programAreaNames";
import { bboxOf, type Ring } from "../lib/geo/types";

export interface ZoneStat {
  key: string;
  name: string;
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
  /** `"unpublished"` when this release genuinely carries no composite for the zone (distinct from
   * a `kind: "geom"` row's `"loading"`/`"error"` -- a zone row is read synchronously off `boot`, so
   * a missing number here is never "not yet" -- P8 item 2. */
  status?: "unpublished";
}

interface BootZoneRow {
  key?: unknown;
  name?: unknown;
  area_km2?: unknown;
  pct_covered?: unknown;
  coverage?: unknown;
  composite?: unknown;
  score?: unknown;
  metrics?: unknown;
  n_cells?: unknown;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `boot.layers`' one `category: "composite"` row's `metric_key` -- the key a zone row's `metrics`
 * object publishes the composite under (see the module header). `null` for a boot with no such
 * row. */
function compositeMetricKey(boot: unknown): string | null {
  const layers = (boot as { layers?: unknown } | null | undefined)?.layers;
  if (!Array.isArray(layers)) return null;
  for (const l of layers as { metric_key?: unknown; category?: unknown }[]) {
    if (l && l.category === "composite" && typeof l.metric_key === "string") return l.metric_key;
  }
  return null;
}

/** a zone row's composite: `metrics[compositeMetricKey(boot)]` first (the real shape), falling
 * back to a flat `composite`/`score` field in case a future release ever publishes one there
 * directly (this module's original defensive rule). */
function compositeOf(boot: unknown, raw: BootZoneRow): number | null {
  const key = compositeMetricKey(boot);
  const metrics = raw.metrics;
  if (key && metrics && typeof metrics === "object") {
    const v = num((metrics as Record<string, unknown>)[key]);
    if (v !== null) return v;
  }
  return num(raw.composite) ?? num(raw.score);
}

function statOf(boot: unknown, raw: BootZoneRow, key: string, name: string): ZoneStat {
  const composite = compositeOf(boot, raw);
  return {
    key,
    name,
    areaKm2: num(raw.area_km2),
    coveragePct: num(raw.pct_covered) ?? num(raw.coverage),
    composite,
    ...(composite === null ? { status: "unpublished" as const } : {}),
  };
}

/** one row of `boot.zones[unit]`, by key -- `null` when the release publishes no row for it (a key
 * from an old link that a later release retired, or a shape this reader has not seen yet). */
export function zoneStatFromBoot(boot: unknown, unit: string, key: string): ZoneStat | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || String(raw.key) !== key) continue;
    return statOf(boot, raw, key, typeof raw.name === "string" && raw.name ? raw.name : key);
  }
  return null;
}

/** every key of a zone place resolved against boot, in the place's own key order; a key with no
 * boot row still gets an entry (name = key, every number `null`) so the list never drops a row the
 * person picked -- it just cannot show its numbers yet. */
export function zoneStatsFor(boot: unknown, unit: string, keys: readonly string[]): ZoneStat[] {
  return keys.map(
    (k) =>
      zoneStatFromBoot(boot, unit, k) ?? {
        key: k,
        name: k,
        areaKm2: null,
        coveragePct: null,
        composite: null,
        status: "unpublished",
      },
  );
}

/**
 * Every zone of `unit` the release publishes at all -- the Places panel's "Add a Program Area"
 * chooser (orchestrator-directed, 2026-09-24: "the Places tool currently has NO Program Area list
 * at all, only Pick mode on the map"), sorted by its own resolved `paLabel` text ("Full Name (KEY)"
 * when published, else the bare key) so the list reads alphabetically by name, not by boot's own
 * publish order. `[]` for a unit the release does not publish (never a throw).
 */
export function allZoneStats(boot: unknown, unit: string): ZoneStat[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: ZoneStat[] = [];
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string") continue;
    out.push(
      statOf(boot, raw, raw.key, typeof raw.name === "string" && raw.name ? raw.name : raw.key),
    );
  }
  return out.sort((a, b) => paLabel(a.key, a.name).localeCompare(paLabel(b.key, b.name)));
}

/** the list row's summary over several keys (a multi-pick zone place): areas SUM, composite is the
 * plain mean of the ones known. Display only -- the SAME published composite figures the row shows
 * are computed by msens at publish time; this never re-derives or feeds a score.
 *
 * P8 item 2: `status: "unpublished"` when NONE of `stats` carries a composite (every constituent
 * zone's own row says so) -- distinct from the geom-row `"loading"`/`"error"` states `Places.svelte`
 * reads for a drawn place, so the row never claims "not analysed yet" for a number this release
 * simply never published. */
export function summarizeZoneStats(stats: readonly ZoneStat[]): {
  areaKm2: number | null;
  coveragePct: number | null;
  composite: number | null;
  status?: "unpublished";
} {
  const areas = stats.map((s) => s.areaKm2).filter((v): v is number => v !== null);
  const covs = stats.map((s) => s.coveragePct).filter((v): v is number => v !== null);
  const comps = stats.map((s) => s.composite).filter((v): v is number => v !== null);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return {
    areaKm2: areas.length ? areas.reduce((a, b) => a + b, 0) : null,
    coveragePct: mean(covs),
    composite: mean(comps),
    ...(stats.length && !comps.length ? { status: "unpublished" as const } : {}),
  };
}

/**
 * P3 fix (owner-reported, 2026-09-24): "Program area selection should list full names and
 * parenthetical acronyms" -- everywhere a Program Area (or any zone) is presented to the user, it
 * reads "Aleutian Arc (ALA)", never the bare key alone. `name` is whatever the release's app
 * bundle publishes for this key (`ZoneStat.name`, already falls back to `key` when the bundle
 * carries no `name` row -- `zoneStatFromBoot` above) -- when it is missing OR happens to equal the
 * key, this falls back to the bare key rather than printing "ALA (ALA)". URLs/state stay keyed by
 * the acronym; this is display text only.
 *
 * V1 fix (Opus eyes-on review, 2026-09-24): the P3 fix above never actually showed a full name
 * live -- NO published app bundle (v6-v9) carries a `name` on its `zones.programarea` rows at all
 * (verified against the real v7 `boot.json`: every row is `{key, n_cells, area_km2, n_taxa,
 * metrics, coverage}`), so `name` was always `undefined` and every Program Area label was the bare
 * acronym forever. `PROGRAM_AREA_NAMES` (generated from the canonical Program-Area geometry,
 * `scripts/gen-program-area-names.mjs`) is a second, app-side fallback consulted when the bundle
 * publishes nothing: bundle `name` first, then this table, then the bare key. `unit` scopes the
 * table to Program Areas alone -- a caller searching/reporting across OTHER zone units
 * (subregion/ecoregion/planarea, e.g. `lens/scores/search.ts`, `lib/report/model.ts`) passes its
 * own `unit` so a same-named key in a different unit's namespace is never mislabeled; every other
 * caller in this app only ever deals in Program Areas (the release's one selectable unit, D17), so
 * omitting `unit` still resolves the table -- unchanged for every existing call site.
 */
/**
 * The resolved NAME alone (no "(KEY)" suffix) — bundle `name` first, else the app-side
 * `PROGRAM_AREA_NAMES` fallback (unit-scoped exactly as {@link paLabel} scopes it), else
 * `undefined` when nothing resolves (the caller falls back to the bare key). Split out of
 * `paLabel` (V6 fix, owner-reported, 2026-09-24) so `lens/scores/search.ts#matchZones` can rank a
 * query against the SAME text the option label shows, instead of only the bundle's raw (usually
 * absent) `name` — on a real release, which publishes no `zones.programarea[*].name` at all,
 * typing a Program Area's full name ("Aleutian") found nothing; only its bare key ("ALA") worked,
 * even though the option itself already read "Aleutian Arc (ALA)" via this same fallback table.
 */
export function resolvedZoneName(
  key: string,
  name: string | null | undefined,
  unit?: string,
): string | undefined {
  if (name && name !== key) return name;
  if (unit === undefined || unit === "programarea") {
    const fallback = PROGRAM_AREA_NAMES[key];
    if (fallback && fallback !== key) return fallback;
  }
  return undefined;
}

export function paLabel(key: string, name: string | null | undefined, unit?: string): string {
  const resolved = resolvedZoneName(key, name, unit);
  return resolved ? `${resolved} (${key})` : key;
}

/** the display name for a zone place's row: every resolved "Name (KEY)" label (`paLabel`, above),
 * ", "-joined -- "St. George Basin (GAA), Western Gulf of Alaska (WGA)" once boot has a row for
 * them; falls back to the bare key per zone when the bundle publishes none. */
export function zoneDisplayName(stats: readonly ZoneStat[]): string {
  return stats.map((s) => paLabel(s.key, s.name)).join(", ");
}

/**
 * "Zoom to place" for a zone place (Deliverable 1): the mean of the picked keys' own label points
 * (`boot.zones[unit][*].label_pt`, the same points `map/layers/zones.ts` renders labels from) --
 * `null` when boot carries no labels for this unit, or none of `keys` has one, so the caller can
 * leave the camera alone rather than jump somewhere wrong.
 */
export function zoneCenterFromBoot(
  boot: unknown,
  unit: string,
  keys: readonly string[],
): { lon: number; lat: number } | null {
  const spec = zoneLabelsFromBoot(boot, unit);
  if (!spec) return null;
  const wanted = new Set(keys.map(String));
  const pts = spec.points.features.filter((f) => wanted.has(String(f.properties?.key)));
  if (!pts.length) return null;
  let lon = 0;
  let lat = 0;
  for (const f of pts) {
    const [x, y] = (f.geometry as Point).coordinates;
    lon += x;
    lat += y;
  }
  return { lon: lon / pts.length, lat: lat / pts.length };
}

/** every Polygon/MultiPolygon ring of a MapLibre `querySourceFeatures()`/`queryRenderedFeatures()`
 * result -- the same shape `report/reportMap.ts#ringsFromRenderedFeatures` extracts, kept as its
 * own small copy here (never imported from `report/`) so the interactive bundle never pulls in
 * that module's maplibre-gl-heavy neighbours (`composeStyle`, `loadBasemapStyle`) just for this one
 * pure helper -- `report/reportMap.ts` is reached only through a dynamic `import()` on purpose.
 * Exported (not just used by `zoneBboxFromFeatures` below) so `places/download.ts`'s "Download
 * places" GeoJSON export (owner review item 2) can embed the REAL polygon rings it finds, not just
 * their bbox. */
export function ringsFromFeatures(
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

/**
 * "Zoom to place" for a zone place, FALLBACK 2 (owner review item 1, live 0.10.62): the real
 * polygon bbox from the release's own PMTiles vector-tile source, queried live off the map --
 * `zoneCenterFromBoot` above needs `boot.zones[unit][*].label_pt`, which NO published release
 * carries yet (docs/parity.html's own "known gap G-01"), so a Program-Area search pick never had
 * anywhere to fly to and silently fell through to an announcement alone. `null` when the query
 * found no feature (the covering tile has not loaded, or the key genuinely is not in the archive)
 * -- the caller falls back further rather than assuming "the whole world".
 */
export function zoneBboxFromFeatures(
  features: readonly { geometry: { type: string; coordinates: unknown } }[],
): [[number, number], [number, number]] | null {
  const polygons = ringsFromFeatures(features);
  if (polygons.length === 0) return null;
  const [x0, y0, x1, y1] = bboxOf({ type: "MultiPolygon", coordinates: polygons });
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** W6 fix (Ben's live-site report, 2026-09-25): "a SECOND Program-Area search pick does not zoom."
 * Root cause: `zoneBoundsFromMap` (state.svelte.ts) queried `querySourceFeatures` FILTERED to the
 * one key just picked -- MapLibre only answers that from tiles currently loaded for the viewport
 * NOW, and the first pick's own `flyToBounds` had already zoomed the camera in tight on the FIRST
 * zone, so the second zone's tile (elsewhere on the map, never visited) was never requested and the
 * filtered query came back empty every time after the first. The first pick "worked" only because
 * the app's initial, wide default camera happens to have every Program Area's outline already
 * loaded (they are always-on chrome, `layerStack.ts`'s "Outlines" group).
 *
 * The fix (this function): query UNFILTERED instead, once, and group EVERY key seen into its own
 * bbox in one pass -- so a caller building a persistent cache (`state.svelte.ts`'s
 * `zoneBoundsCache`) absorbs every OTHER zone's tile that happened to already be loaded (which, at
 * the initial wide camera, is normally all of them) in the same call that resolves the one zone it
 * actually needs, and every LATER pick is a cache hit that needs no live map query at all. */
export function zoneBboxesByKeyFromFeatures(
  features: readonly {
    properties?: Record<string, unknown> | null;
    geometry: { type: string; coordinates: unknown };
  }[],
  keyProperty: string,
): Map<string, [[number, number], [number, number]]> {
  const byKey = new Map<string, { geometry: { type: string; coordinates: unknown } }[]>();
  for (const f of features) {
    const raw = f.properties?.[keyProperty];
    if (raw === undefined || raw === null) continue;
    const key = String(raw);
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }
  const out = new Map<string, [[number, number], [number, number]]>();
  for (const [key, feats] of byKey) {
    const bounds = zoneBboxFromFeatures(feats);
    if (bounds) out.set(key, bounds);
  }
  return out;
}

// --- Q3 (P round, 2026-09-24): "Selecting a Program Area place opens no results panel in
// Places" -- the same `ResultsPanel.svelte` a drawn/uploaded place gets now renders for a
// `kind: "zone"` place too, reading everything below straight off `boot` (published, synchronous
// -- unlike a custom place's own SQL-computed scores, there is no engine round trip for a zone's
// coverage/flower/components). Species is the one piece that still needs the engine (the
// `zone_taxon` table `speciesForZone` reads); n_cells/area/composite/flower/components do not.

/** `boot.zones[unit][*].n_cells` (the module header's real v7 shape), summed over every key of a
 * (possibly multi-pick) zone place -- the coverage note's "N cells" figure. `null` when the
 * release publishes no `n_cells` for any of `keys` (never a throw: an old/synthetic bundle that
 * predates this field just shows "--", matching every other unpublished-number convention here). */
export function zoneNCellsFor(boot: unknown, unit: string, keys: readonly string[]): number | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  const wanted = new Set(keys.map(String));
  let total = 0;
  let any = false;
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object" || !wanted.has(String(raw.key))) continue;
    const n = num(raw.n_cells);
    if (n !== null) {
      total += n;
      any = true;
    }
  }
  return any ? total : null;
}

export interface ZoneComponentScore {
  metric_key: string;
  /** `flower.ts#componentLabel()`'s label -- the SAME text the flower's own petals use, so the
   * table beside it can never disagree about a component's name. */
  component: string;
  score: number;
}

/**
 * ONE zone's component table (Deliverable 5's zone twin, item 1): every one of this release's
 * component `metric_key`s (`componentMetricKeys(boot)` -- the identical list `scoresForCells()`
 * substitutes for a custom place, `analysis/queries.ts`) that the zone's own published `metrics`
 * actually carries a finite number for. Unlike the FLOWER (which collapses a v8/v9 category
 * collision to one petal, `flower.ts`'s own header), this keeps every key: both terms genuinely
 * feed the published composite, and the table's job is to show what fed it, not to draw a shape.
 * `[]` for an unknown zone/unit or a release with no component layers (never a throw).
 */
export function zoneComponentScores(
  boot: unknown,
  unit: string,
  key: string,
): ZoneComponentScore[] {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return [];
  const raw = (rows as BootZoneRow[]).find((r) => r && String(r.key) === key);
  const metrics = raw?.metrics;
  if (!metrics || typeof metrics !== "object") return [];
  const out: ZoneComponentScore[] = [];
  for (const metricKey of componentMetricKeys(boot)) {
    const v = num((metrics as Record<string, unknown>)[metricKey]);
    if (v !== null)
      out.push({ metric_key: metricKey, component: componentLabel(metricKey), score: v });
  }
  return out;
}

/**
 * "Show analysis cells" for a ZONE place would paint the zone's own cell set from a `zone_cell`
 * source, the same way it already paints a drawn place's D7b-clipped cells (item 1's rule: "if the
 * data path exists"). It does not exist yet -- confirmed by grep, nothing under `src/places/**` or
 * `src/lib/analysis/**` mounts a `zone_cell` object, and the workflows pipeline that would publish
 * it (`tests/fixtures/report/README.md`'s own reference to "the zone's own `zone_cell` rows") is a
 * SEPARATE, not-yet-wired dataset. This always returns `false` today; the day a `zone_cell` reader
 * lands, this is the one place that flips, and every caller (`Places.svelte`'s toggle) already
 * reads it rather than hard-coding "zone places never get this button".
 */
export function zoneCellsAvailable(boot: unknown): boolean {
  void boot;
  return false;
}

/** the one-line reason `Places.svelte` shows in place of the "Show analysis cells" button for a
 * selected zone place, while {@link zoneCellsAvailable} is false. */
export const ZONE_CELLS_UNAVAILABLE_REASON =
  "Show analysis cells isn't available for Program Area places yet — this release doesn't publish per-zone cell data to the app.";
