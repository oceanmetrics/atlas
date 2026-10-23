// atlas-8 P-round Q1 (owner-reported defect, live 0.10.50, 390px phone/v7): the top-bar search box
// did nothing in the Scores lens -- a stub `<input>` with a placeholder and no handler at all
// (`ScoresLens.svelte`'s own note: "The Nominatim geocoder was never attempted"). This module is the
// pure matching/parsing logic behind its replacement, `ScoresSearch.svelte` -- deliberately NOT a
// geocoder: no third-party service, no network call, no API key. It only searches what the release
// already published in `boot.json` (zones) plus arithmetic on the release's own grid (coordinates),
// so it works exactly as well offline as online (CHANGELOG.md).
//
// Two match kinds, ONE combined, capped result list (`scoresSearch`):
//  - a zone (Program Area, and any subregion/ecoregion archive the release happens to also
//    publish in `boot.zones`) by key or by name;
//  - a typed "lon, lat" coordinate pair, jumped to and resolved into a cell selection.
import { paLabel, resolvedZoneName } from "../../places/zoneStats";
import { primaryUnitType, zoneRows } from "./boot";
// W6 (Ben, 2026-09-25): "Regions move into the Search bar" -- the Layers pane's own "Zoom to
// region" select read the SAME `studyAreasFromBoot(boot)` rows this module now searches too; the
// select is removed (`LayersPanel.svelte`/`ScoresLens.svelte`), so this is its one remaining
// reader.
import { studyAreasFromBoot } from "../../lib/map/interaction";

export interface ZoneSearchMatch {
  kind: "zone";
  unit: string;
  key: string;
  /** `paLabel`-style "Name (KEY)" -- falls back to the bare key when the bundle publishes no name
   * for it (or the name equals the key), same rule every other zone-facing label in this lens
   * follows (`zonesTable.ts`, `places/zoneStats.ts`). */
  label: string;
}

/** W6: a whole-study-area camera preset (`boot.study_areas`, `lib/map/interaction.ts`'s own
 * `StudyArea` row) -- "picking a region does exactly what the Layers pane's 'Zoom to region' select
 * did" (D7: the study area is a CAMERA, never a data filter -- `boot.ts#fullSubregion`'s own header
 * -- so this is a pure zoom, the raster/legend never change). */
export interface RegionSearchMatch {
  kind: "region";
  key: string;
  label: string;
}

export interface CoordSearchMatch {
  kind: "coord";
  lon: number;
  lat: number;
  label: string;
}

export type ScoresSearchMatch = ZoneSearchMatch | RegionSearchMatch | CoordSearchMatch;

export const MAX_RESULTS = 8;
export const MAX_REGION_RESULTS = 6;

/** the zone unit TYPES this search matches against, in listing order: the release's own SELECTABLE
 * unit (Program Areas -- `primaryUnitType`) first, then `subregion`/`ecoregion` when the release
 * ALSO happens to publish either archive under `boot.zones` (D17: neither is ever the selectable
 * spatial unit -- `fallback.ts#effectiveUnit` still clamps a `unit=subregion` URL back to "cell" --
 * but `boot.zones` is a plain object keyed by whatever the release published, and a person may
 * still know a place by its subregion/ecoregion name). Deduped so v1's `planarea` (which IS
 * `primaryUnitType`) is never listed twice.
 */
function searchableZoneUnits(boot: unknown): string[] {
  const units = [primaryUnitType(boot), "subregion", "ecoregion"].filter((u): u is string => !!u);
  return [...new Set(units)];
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

/** lower is a better match; `null` = no match at all. Exact key beats a key prefix beats a key
 * substring beats a name prefix beats a name substring -- so a query that is itself an exact key
 * (the common case: typing a Program Area's own acronym) always sorts first, even when the SAME
 * text also happens to substring-match some other zone's name (e.g. "ALA" inside "Alaska"). */
function matchRank(query: string, key: string, name: string | undefined): number | null {
  const k = fold(key);
  const n = name ? fold(name) : "";
  if (k === query) return 0;
  if (k.startsWith(query)) return 1;
  if (k.includes(query)) return 2;
  if (n && n.startsWith(query)) return 3;
  if (n && n.includes(query)) return 4;
  return null;
}

interface Ranked<T> {
  m: T;
  rank: number;
  order: number;
}

/** every zone (across `searchableZoneUnits`) whose key or name matches `q` (already `fold`ed,
 * never blank), as UNSORTED, UNCAPPED `{m, rank, order}` triples -- `matchZones` and `scoresSearch`
 * (below) both build on this ONE ranking pass so an exact zone match and an exact region match can
 * be compared and merged by rank, not just concatenated group-after-group (see `scoresSearch`'s own
 * header for the bug two separate, unmerged budgets caused: "ALA" typed as a zone's exact KEY match
 * still lost to "Alaska" the REGION's mere name-prefix match, because every region was pushed ahead
 * of every zone regardless of which one actually matched better). `orderStart` offsets `order` so a
 * caller merging this with `rankRegions` can make ties prefer whichever list starts at 0 -- the
 * "Regions group visually ahead of Program Areas" rule (W6) becomes a TIE-break only, never an
 * override of a genuinely better match in the other list. */
function rankZones(boot: unknown, q: string, orderStart = 0): Ranked<ZoneSearchMatch>[] {
  const ranked: Ranked<ZoneSearchMatch>[] = [];
  let order = orderStart;
  for (const unit of searchableZoneUnits(boot)) {
    for (const z of zoneRows(boot, unit)) {
      // V6 fix (owner-reported, 2026-09-24): rank against the SAME resolved name the option label
      // shows (`resolvedZoneName`, unit-scoped exactly as `paLabel` scopes it) -- not the bundle's
      // raw `z.name`, which a real release never publishes for `zones.programarea`. Before this,
      // "Aleutian" found nothing on the real v7/v9 shape even though the dropdown's own option text
      // ("Aleutian Arc (ALA)") came from that same fallback table; only the bare key matched.
      const rank = matchRank(q, z.key, resolvedZoneName(z.key, z.name, unit));
      if (rank === null) continue;
      ranked.push({
        m: { kind: "zone", unit, key: z.key, label: paLabel(z.key, z.name, unit) },
        rank,
        order: order++,
      });
    }
  }
  return ranked;
}

/** the region-side twin of `rankZones` -- see its header. */
function rankRegions(boot: unknown, q: string, orderStart = 0): Ranked<RegionSearchMatch>[] {
  const ranked: Ranked<RegionSearchMatch>[] = [];
  let order = orderStart;
  for (const a of studyAreasFromBoot(boot)) {
    const rank = matchRank(q, a.key, a.label);
    if (rank === null) continue;
    ranked.push({
      m: { kind: "region", key: a.key, label: a.label ?? a.key },
      rank,
      order: order++,
    });
  }
  return ranked;
}

/**
 * Every zone (across `searchableZoneUnits`) whose key or name matches `query`, ranked and capped —
 * a `query` that folds to the empty string (blank/whitespace) matches nothing, never "everything".
 */
export function matchZones(boot: unknown, query: string, limit = MAX_RESULTS): ZoneSearchMatch[] {
  const q = fold(query);
  if (!q) return [];
  const ranked = rankZones(boot, q);
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.m);
}

/**
 * Every study-area REGION whose key or label matches `query`, ranked the same way `matchZones`
 * ranks a zone (exact key, then key prefix/substring, then label prefix/substring). A blank `query`
 * matches nothing -- same "blank matches nothing, never everything" rule `matchZones` follows;
 * `defaultRegions` below is the separate "nothing typed yet" listing.
 */
export function matchRegions(
  boot: unknown,
  query: string,
  limit = MAX_REGION_RESULTS,
): RegionSearchMatch[] {
  const q = fold(query);
  if (!q) return [];
  const ranked = rankRegions(boot, q);
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.m);
}

/** every published region, in `boot.study_areas`' own order -- the "Regions" group's DEFAULT
 * listing (nothing typed yet, item "Regions move into the Search bar": "Clicking into the Search
 * box should open the dropdown... before any typing"). Capped, never ranked (there is no query to
 * rank against). */
export function defaultRegions(boot: unknown, limit = MAX_REGION_RESULTS): RegionSearchMatch[] {
  return studyAreasFromBoot(boot)
    .slice(0, limit)
    .map((a) => ({ kind: "region" as const, key: a.key, label: a.label ?? a.key }));
}

/** every published zone of the release's one SELECTABLE unit (`primaryUnitType`), sorted by its
 * own resolved label -- the "Program Areas" group's DEFAULT listing (nothing typed yet), same
 * alphabetical-by-name convention `places/zoneStats.ts#allZoneStats` uses for the Places panel's
 * own "Add a Program Area" chooser. `[]` for a release with no selectable unit at all. */
export function defaultZones(boot: unknown, limit = MAX_RESULTS): ZoneSearchMatch[] {
  const unit = primaryUnitType(boot);
  if (!unit) return [];
  return zoneRows(boot, unit)
    .map((z) => ({
      kind: "zone" as const,
      unit,
      key: z.key,
      label: paLabel(z.key, z.name, unit),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, limit);
}

// --- coordinates ---------------------------------------------------------------------------------

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const LAT_LABEL_RE = /\blat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;
const LON_LABEL_RE = /\blon(?:g|gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;

function labeledNumber(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function inRange(lon: number, lat: number): boolean {
  return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

export interface CoordParseResult {
  lon: number;
  lat: number;
  /** true when the pair was read as "lat, lon" rather than the default "lon, lat" -- either an
   * explicit `lat`/`lon` label in the text, or the default reading's latitude falling outside
   * +-90 deg while the swapped reading is valid. Surfaced so the result label can show the user how
   * their text was read (item 2's "with a hint"). */
  swapped: boolean;
}

/**
 * Parse a typed coordinate pair. "lon, lat" is the default order (the SAME convention
 * `places/coords.ts`'s own "lon,lat" line rule and `grid.ts#cellLonLat` use) — NOT re-imported from
 * there: that module belongs to the upload pipeline (a heavier, async, geometry-validating parser
 * for shapes) and this is a much smaller, synchronous "jump to a point" parse with no geometry
 * involved at all.
 *
 * "lat, lon" is also accepted, two ways:
 *  - an explicit `lat`/`lon` label anywhere in the text ("lat 57, lon -140", "lat: 57 lon: -140");
 *  - inferred when the default "lon, lat" reading would put the SECOND number outside latitude's
 *    +-90 deg range but the SWAPPED reading is valid both ways ("57, -140" -> lon -140, lat 57).
 *
 * `null` for anything that is not exactly two numbers (comma and/or whitespace separated), or is
 * out of range under BOTH readings.
 */
export function parseCoordinateQuery(text: string): CoordParseResult | null {
  const t = text.trim();
  if (!t) return null;

  const latLabeled = labeledNumber(t, LAT_LABEL_RE);
  const lonLabeled = labeledNumber(t, LON_LABEL_RE);
  if (latLabeled !== null && lonLabeled !== null) {
    return inRange(lonLabeled, latLabeled)
      ? { lon: lonLabeled, lat: latLabeled, swapped: true }
      : null;
  }

  const parts = t.split(/[,\s]+/).filter((s) => s.length > 0);
  if (parts.length !== 2) return null;
  if (!NUMBER_RE.test(parts[0]) || !NUMBER_RE.test(parts[1])) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (inRange(a, b)) return { lon: a, lat: b, swapped: false }; // default: "lon, lat"
  if (inRange(b, a)) return { lon: b, lat: a, swapped: true }; // the default reading was out of range
  return null;
}

export function formatCoordLabel(r: CoordParseResult): string {
  const lon = r.lon.toFixed(2);
  const lat = r.lat.toFixed(2);
  return r.swapped ? `Fly to lat ${lat}, lon ${lon}` : `Fly to lon ${lon}, lat ${lat}`;
}

/**
 * The combined, capped result list the search field renders: a parsed coordinate (at most one)
 * first, then REGION matches (W6: "Regions move into the Search bar"), then zone matches filling
 * whatever room is left.
 */
export function scoresSearch(
  boot: unknown,
  query: string,
  limit = MAX_RESULTS,
): ScoresSearchMatch[] {
  const out: ScoresSearchMatch[] = [];
  const coord = parseCoordinateQuery(query);
  if (coord)
    out.push({ kind: "coord", lon: coord.lon, lat: coord.lat, label: formatCoordLabel(coord) });
  const remaining = limit - out.length;
  if (remaining > 0) {
    const q = fold(query);
    if (q) {
      // W6 fix (found while testing "Regions move into the Search bar"): regions and zones are
      // ranked TOGETHER here, by match quality, and only THEN merged -- not "every region ahead of
      // every zone" (that first draft let "Alaska" the region's mere name-PREFIX match to "ala"
      // outrank the "ALA" zone's own EXACT key match, so typing a Program Area's own acronym could
      // silently select the wrong kind of thing). `rankRegions` starts its `order` at 0 and
      // `rankZones` starts after every region, so a TIE in rank still prefers a region (the
      // "Regions group first" rule survives, but only as a tie-break, never an override).
      const regionRanks = rankRegions(boot, q);
      const zoneRanks = rankZones(boot, q, regionRanks.length);
      const merged = [...regionRanks, ...zoneRanks].sort(
        (a, b) => a.rank - b.rank || a.order - b.order,
      );
      out.push(...merged.slice(0, remaining).map((r) => r.m));
    }
  }
  return out;
}

/**
 * The BLANK-query dropdown ("open on focus... before any typing"): Regions, then Program Areas --
 * no coordinate hint match (there is nothing typed to parse). `ScoresSearch.svelte` renders a
 * separate static hint line for the coordinate syntax below this list; it is not itself a result.
 */
export function scoresSearchDefault(boot: unknown): ScoresSearchMatch[] {
  return [...defaultRegions(boot), ...defaultZones(boot)];
}
