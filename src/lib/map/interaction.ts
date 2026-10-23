// Click, hover and camera moves — the three things a lens asks the map about.
//
// Two rules are load-bearing and both are enforced by tests:
//
//  1. A CELL ID COMES FROM THE RELEASE'S GRID, never a constant. `boot.grid` is read through
//     `grid/grid.ts` (a verbatim port of `msens::cell_from_lonlat()`); usa05 (v1-v7) and global05
//     (v8+) disagree about what `cell_id` means, and hardcoding either is how v7 ids get painted on
//     v8's grid and land in the wrong ocean (grid.ts's own header).
//  2. NO `fitBounds`, EVER — not here, not in a lens. All camera moves are centre+zoom from
//     `boot.study_areas` (atlas-4 §6.5: "there is no `fit_bounds` anywhere — deliberately"),
//     because a bbox inverts across the antimeridian: EBS and PIS both cross it and PIS's true
//     67.5° span reads as 360°. `tests/map/no-fitbounds.test.ts` scans `src/lib/map` and `src/lens`
//     for the call and fails on it.
import { cellFromLonLat, gridFromBoot, type GridSpec } from "../grid/grid";
import { zoneKeyProperty, zoneNameProperty, zoneQueryLayerIds } from "./layers/zones";
import type { ZoneUnitSpec } from "./types";

export interface LngLat {
  lng: number;
  lat: number;
}

/** the study-area camera: `boot.study_areas[key]` (`msens::study_areas()`, centre + zoom). */
export interface StudyArea {
  key: string;
  label?: string;
  lon: number;
  lat: number;
  zoom: number;
}

/**
 * The fallback camera when a release publishes no `study_areas` at all. It is `FULL` from
 * `msens::study_areas()` (atlas-4 §5.3's table), which the plan records as a baked constant
 * identical for every release — unlike the GRID, which must never be guessed. `studyAreaFromBoot`
 * prefers boot's own row whenever there is one.
 */
export const FALLBACK_FULL_STUDY_AREA: StudyArea = {
  key: "FULL",
  label: "All US waters",
  lon: -101.304,
  lat: 46.9,
  zoom: 2.16,
};

interface StudyAreaRow {
  key?: unknown;
  label?: unknown;
  lon?: unknown;
  lat?: unknown;
  zoom?: unknown;
}

function toStudyArea(key: string, raw: unknown): StudyArea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as StudyAreaRow;
  if (typeof r.lon !== "number" || typeof r.lat !== "number" || typeof r.zoom !== "number")
    return null;
  return {
    key: typeof r.key === "string" ? r.key : key,
    label: typeof r.label === "string" ? r.label : undefined,
    lon: r.lon,
    lat: r.lat,
    zoom: r.zoom,
  };
}

/** every study area a release publishes, in boot's order. Accepts both shapes atlas-1 may settle
 * on: an array of rows carrying `key`, or an object keyed by it. */
export function studyAreasFromBoot(boot: unknown): StudyArea[] {
  const raw = (boot as { study_areas?: unknown } | null | undefined)?.study_areas;
  if (Array.isArray(raw)) {
    return raw
      .map((row) => toStudyArea("", row))
      .filter((a): a is StudyArea => a !== null && !!a.key);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, row]) => toStudyArea(key, row))
      .filter((a): a is StudyArea => a !== null);
  }
  return [];
}

/**
 * `boot.study_areas[key]`, falling back to `FULL` and then to {@link FALLBACK_FULL_STUDY_AREA} —
 * the same "an unknown value clamps to the default, never an error" rule `state/codec.ts` follows
 * for every URL field (`?area=` is user input).
 */
export function studyAreaFromBoot(boot: unknown, key: string): StudyArea {
  const areas = studyAreasFromBoot(boot);
  return (
    areas.find((a) => a.key === key) ??
    areas.find((a) => a.key === "FULL") ??
    areas[0] ??
    FALLBACK_FULL_STUDY_AREA
  );
}

/** the narrow slice of MapLibre's `Map` a camera move needs. `eventData` is MapLibre's own
 * pass-through: it reaches the `move`/`moveend` handlers, which is how `map.ts` tells a
 * programmatic move from a user one without a mutable flag. */
export interface FlyTarget {
  flyTo(options: Record<string, unknown>, eventData?: Record<string, unknown>): unknown;
}

/** marks every camera move this module makes, so `map.ts` never writes it back to the URL. */
export const PROGRAMMATIC_EVENT_DATA = { atlasProgrammatic: true } as const;

/**
 * Fly to a study area — centre + zoom, NEVER `fitBounds` over a zone set (see the module header).
 * Takes the row itself (`boot.study_areas[key]`), so the caller cannot accidentally pass a key that
 * this module would then have to resolve against a boot it does not hold.
 */
export function flyToStudyArea(map: FlyTarget, area: StudyArea): void {
  map.flyTo({ center: [area.lon, area.lat], zoom: area.zoom }, { ...PROGRAMMATIC_EVENT_DATA });
}

// --- clicks and hovers -------------------------------------------------------------------------

/** the shape `queryRenderedFeatures` returns, narrowed to what a zone hit needs. */
export interface QueriedFeature {
  layer: { id: string };
  properties?: Record<string, unknown> | null;
}

export interface QueryableMap {
  queryRenderedFeatures(
    point: [number, number] | { x: number; y: number },
    options?: { layers?: string[] },
  ): QueriedFeature[];
  project(lngLat: [number, number]): { x: number; y: number };
}

export interface ZoneHit {
  unit: string;
  key: string;
  name: string;
}

/**
 * The first zone the query hit, resolved against the unit list (a layer id alone is not enough:
 * the key PROPERTY differs per unit). Features come back topmost-first, and `zoneQueryLayerIds`
 * already orders fills before lines, so "the first one" is the intended answer.
 */
export function zoneHitFromFeatures(
  features: readonly QueriedFeature[],
  units: readonly ZoneUnitSpec[],
): ZoneHit | null {
  const byLayer = new Map<string, string>();
  for (const u of units) {
    byLayer.set(`${u.unit}_fill`, u.unit);
    byLayer.set(`${u.unit}_ln`, u.unit);
  }
  for (const f of features) {
    const unit = byLayer.get(f.layer?.id ?? "");
    if (!unit) continue;
    const props = f.properties ?? {};
    const key = props[zoneKeyProperty(unit)];
    if (typeof key !== "string" && typeof key !== "number") continue;
    const name = props[zoneNameProperty(unit)];
    return {
      unit,
      key: String(key),
      name: typeof name === "string" && name ? name : String(key),
    };
  }
  return null;
}

/** the zone under a screen point, or `null`. Used by both click and hover. */
export function zoneAtPoint(
  map: QueryableMap,
  point: { x: number; y: number },
  units: readonly ZoneUnitSpec[],
): ZoneHit | null {
  const layers = zoneQueryLayerIds(units);
  if (!layers.length) return null;
  return zoneHitFromFeatures(map.queryRenderedFeatures(point, { layers }), units);
}

export interface MapClick {
  lngLat: LngLat;
  /** `null` when the click is outside this release's grid — a fact about the COORDINATES, never a
   * clamped index (grid.ts). */
  cellId: number | null;
  zone: ZoneHit | null;
}

export interface ClickContext {
  /** the release's grid, from `gridFromBoot(boot)`. Required: there is no default grid. */
  grid: GridSpec;
  units: readonly ZoneUnitSpec[];
}

/**
 * Resolve a click into `{lngLat, cellId, zone}`. The cell id is arithmetic on the RELEASE's grid
 * — no `/cog/point`, no `cellid.tif` round trip (atlas-4 §6.6 fixes the Shiny app's order of
 * preference; plan D4 keeps `/cog/point` for species values only).
 */
export function mapClick(
  map: QueryableMap,
  lngLat: LngLat,
  point: { x: number; y: number },
  ctx: ClickContext,
): MapClick {
  return {
    lngLat,
    cellId: cellFromLonLat(lngLat.lng, lngLat.lat, ctx.grid),
    zone: zoneAtPoint(map, point, ctx.units),
  };
}

/** `boot.grid` → a `GridSpec`, re-exported so a lens has ONE import for "the release's grid". */
export { gridFromBoot };
export type { GridSpec };
