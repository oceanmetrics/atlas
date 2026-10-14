// D8 (Opus 5.5 eyes-on, 2026-09-24; orchestrator round 2, real-v7-build eyes-on): the LAST resort
// in the species camera's fallback chain, for a taxon that publishes NO bbox on any input or on
// `card.merged` at all — measured on v7 (every asset's `bbox` is `null`, `assets: []` on the
// walrus, mdl_seq 54383; camera.ts's own header: "v7 publishes no bbox at all"). `camera.ts` itself
// stays network-free by contract (its own header: "WHY THERE IS NO QUERY HERE"), so this is a
// SEPARATE module the species lens' wiring (`state.svelte.ts`) calls only once camera.ts's own
// bundle-only chain has already fallen to the study area.
//
// ROUND 2 (real build): the round-1 version of this file called stock titiler's `/cog/bounds` —
// verified LIVE against titiler-v8 to 404 ("Not Found"; that route is not registered on this
// deployment). `/cog/info` IS live (verified: 200, `{bounds:[...], width, height, ...}`) and its
// `bounds` field is what this module now reads.
//
// A SECOND, real problem `/cog/info`'s bounds alone does not solve: the walrus's own v7 merged COG
// reports `bounds: [-180, 53.15, 180, 73.75]` — a genuinely FULL 360-degree longitude span, not a
// metadata artifact. Verified with `/cog/point` samples along that latitude: only ONE of fourteen
// longitudes tried (-170) held real data; every other (-160 through 170, spanning the rest of the
// globe) answered `null`. The file's own extent is honestly whole-longitude/narrow-latitude (a
// usa05-grid COG the publish pipeline never cropped past a shared latitude band), so `/cog/info`
// alone would frame the entire globe's width at a thin Arctic band — not the range. `narrowLongitude`
// below is the fix: when the info bbox's longitude span is degenerate (`bboxSpansGlobe`-wide),
// probe a SMALL, FIXED set of candidate longitudes (the real US EEZ's own rough footprint — Aleutians
// through the Gulf/Atlantic/Caribbean/Hawaii/CNMI, the same regions `boot.study_areas` already names)
// at the bbox's own latitude midpoint via `/cog/point` (plan D4's one sanctioned tile-server read for
// species values — this reuses that exact endpoint, never a new one), and once ANY of them hits real
// data, frames a MODEST window around it rather than the file's own (correct but useless) full width.
// Bounded cost (at most `CANDIDATE_LONS.length` extra requests, fired only on this already-rare
// last-resort path) and an honest approximation — documented as such, never claimed to be exact.
//
// R3-rr fix 1, round 2 (2026-09-25, real-build eyes-on): the walrus is ONE compact location, but
// not every degenerate COG is -- the leatherback (mdl_seq 54241) holds real data at FOUR widely
// separated candidates (Aleutians, Atlantic/Caribbean, Hawaii, Guam/CNMI), a genuinely wide-ranging
// species a single "modest window" cannot honestly frame. `narrowLongitude` now probes every
// candidate (not just the first hit) and, when the hits are spread wide (`multiRegionSpread` past
// `MULTI_REGION_SPREAD_DEG`), hands the RAW degenerate bbox back instead of a narrow window --
// letting `camera.ts#cogBoundsCamera`'s own wide-range/US-study-area narrowing (already fixed in
// round 1, for a bundle-published globe-spanning bbox) apply here too, "Whole range" toggle and all.
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";
import { titilerPointUrl } from "./point";
import { bboxSpansGlobe } from "../grid/grid";
import type { Bbox } from "../../lens/species/data/shards";

/** `{host}/cog/info?url=<enc>` — stock titiler's own endpoint (verified live; `/cog/bounds` is
 * NOT registered on titiler-v8), same encoding as every other `/cog/*` URL this app builds
 * (tiles.ts/point.ts). */
export function titilerInfoUrl(config: TitilerConfig, cogUrl: string): string {
  return `${config.host}/cog/info?url=${encodeUrlReserved(cogUrl)}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network (module
 * contract: "No network call in tests: inject the transport" — the same rule point.ts's
 * `PointJsonFetcher` follows). */
export type BoundsJsonFetcher = (url: string) => Promise<unknown>;

export interface BoundsSource {
  /** the COG's own `[xmin, ymin, xmax, ymax]` (from `/cog/info`), narrowed by `narrowLongitude`
   * when the raw extent is a degenerate (whole-globe-width) longitude span — or `null` on any
   * failure (network, a non-JSON body, a malformed `bounds` array, or a degenerate extent whose
   * longitude narrowing also failed to find real data). Never a throw, matching every other
   * raster/ reader's "a bad answer degrades to null, not a crash" rule. */
  cogBounds(cogUrl: string): Promise<Bbox | null>;
}

/** an extent this wide cannot be the taxon's real range (`msens::bbox_spans_globe`'s own threshold,
 * already ported as `bboxSpansGlobe` — camera.ts's `GLOBE_SPAN_DEG` uses the same value for the
 * SAME reason: a bundle-published bbox this wide is rejected there, never obeyed). */
const GLOBE_SPAN_DEG = 350;

/** a handful of longitudes covering the US EEZ's own rough footprint (Aleutians through the
 * Gulf/Atlantic/Caribbean, plus Hawaii and the Pacific Island Territories) — the same regions
 * `boot.study_areas` already names as presets, not invented geography. -170 is the walrus's own
 * real longitude (verified live, this module's own header), kept in the list rather than rounded
 * away to a nearby candidate. One `/cog/point` sample each, at the degenerate bbox's own latitude
 * midpoint, is the cheapest way to find WHERE in that full-width band the taxon's real data
 * actually sits. Exported for the test that pins "every candidate is still probed" (R3-rr fix 1,
 * round 2) to its exact count, rather than a magic number that could silently drift. */
export const CANDIDATE_LONS: readonly number[] = [
  -177, -170, -165, -150, -135, -120, -108, -97, -88, -80, -70, -66, -157, 145,
];

/** half-width of the framed window once a candidate longitude hits real data (degrees) — modest
 * on purpose: this is a best-effort approximation, not a tight fit, and erring wide is the safe
 * direction (never crops the actual range further than the file's own metadata already implies). */
const NARROWED_HALF_WIDTH_DEG = 20;

async function hasDataAt(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig,
  cogUrl: string,
  lon: number,
  lat: number,
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = await fetchJson(titilerPointUrl(config, lon, lat, cogUrl));
  } catch {
    return false;
  }
  const values = (raw as { values?: unknown } | null)?.values;
  const first = Array.isArray(values) ? values[0] : undefined;
  return typeof first === "number" && Number.isFinite(first);
}

/** R3-rr fix 1, round 5: at most this many `/cog/point` probes in flight at once -- bounded so a
 * genuinely wide-range species (every candidate probed) never fires all `CANDIDATE_LONS.length`
 * requests at once, but still fast: measured live against titiler-v8, 4-way concurrency for the
 * real leatherback's 14-candidate sweep dropped ~11-14s (sequential) to well under 4s (see the
 * round's own report for the exact before/after numbers). */
export const PROBE_CONCURRENCY = 4;

/** runs `fn` over `items` with at most `limit` in flight at once, returning results in the SAME
 * order as `items` regardless of which one finishes first (a simple worker-pool: each of `limit`
 * workers repeatedly claims the next unclaimed index until none remain). Exists here rather than
 * as a general utility because its one contract — order-preserving despite concurrent completion —
 * is specific to why {@link narrowLongitude} needs it: `hits` must come out in `CANDIDATE_LONS`'s
 * own fixed order for {@link hitLonArc}'s dateline math to see byte-identical input to a purely
 * sequential probe of the same real data. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * The smallest arc (west/east, in the SAME continuous, never-normalized frame `camera.ts`'s own
 * `minimalFrame` produces — `east` may exceed 180) that contains every hit longitude, wrapping
 * across the antimeridian: sort the points, find the single largest GAP between
 * circularly-consecutive points, and the arc runs from right after that gap to right before it —
 * whatever is left once the circle is cut at its widest empty stretch. This is what keeps two
 * Pacific-side hits that are only close together THROUGH the dateline (e.g. 145 and -165, ~50 deg
 * apart via the Pacific, not the naive 310 deg measured the other way) from being mistaken for "far
 * apart" by a plain `max - min`. `hits` must be non-empty (checked by the one caller). The returned
 * span (`east - west`) also doubles as "how spread out are these hits" for {@link narrowLongitude}'s
 * own multi-region decision — a single function, one definition of "spread".
 */
function hitLonArc(hits: readonly number[]): [west: number, east: number] {
  if (hits.length === 1) return [hits[0], hits[0]]; // the trivial case: a single point IS the arc
  const sorted = [...hits].sort((a, b) => a - b);
  const n = sorted.length;
  let bestGap = sorted[0] + 360 - sorted[n - 1]; // the wraparound gap, last -> first
  let cutAfter = n - 1; // the gap is between sorted[cutAfter] and sorted[(cutAfter+1) % n] + 360
  for (let i = 1; i < n; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      cutAfter = i - 1;
    }
  }
  // walk the circle starting right after the widest gap, adding a whole turn to every point that
  // wrapped past the array's own end, so the result is one continuous, monotonically increasing
  // run (never re-normalized — the SAME rule this module's own header names for the whole app).
  let west = 0;
  let east = 0;
  for (let k = 0; k < n; k++) {
    const idx = (cutAfter + 1 + k) % n;
    const v = sorted[idx] + (idx <= cutAfter ? 360 : 0);
    if (k === 0) west = v;
    east = v;
  }
  return [west, east];
}

/** R3-rr fix 1, round 2 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25 — real-build
 * eyes-on found the round-1 `cogBoundsCamera` fix alone never reaches the live leatherback: its
 * `/cog/info` bbox IS degenerate, so THIS module intercepts first, and the narrowed point-probe
 * window it used to hand back was `[-185, -17.7, -145, 60.45]` — only 40 deg of LONGITUDE, well
 * under `WIDE_RANGE_SPAN_DEG`, so `wideRangeAware()` never narrowed it and the toggle stayed
 * hidden, even though the resulting box was still 78 deg TALL (the single-candidate window kept
 * the ORIGINAL degenerate bbox's own full latitude range) — a "modest window" in name only.
 * Measured live (2026-09-25): the leatherback holds real data at FOUR widely separated candidates
 * (-165 Aleutians, -66 Atlantic/Caribbean, -157 Hawaii, 145 Guam/CNMI) — a genuinely Pacific-AND-
 * Atlantic-wide species, not a single compact location the walrus-style narrowing was designed for
 * (walrus: exactly ONE hit, -170, nothing else). Past this many degrees of {@link hitLonArc} spread,
 * several hits are treated as a genuinely wide range rather than one imprecise point. */
const MULTI_REGION_SPREAD_DEG = 60;

/**
 * When `bbox`'s longitude span is degenerate (whole-globe-width — this module's own header has the
 * measured walrus example), probe {@link CANDIDATE_LONS} at `bbox`'s own latitude midpoint.
 *
 * - No candidate holds data: `null` (the caller falls back to the study area, same as before this
 *   module existed).
 * - The hits fit within {@link MULTI_REGION_SPREAD_DEG} of each other (a single hit is the walrus
 *   shape; several CLOSE hits are one real, if imprecise, coastal range): frame a modest window
 *   around their {@link hitLonArc} — the ORIGINAL single-hit behaviour, generalized.
 * - The hits are spread WIDER than that (the leatherback shape, round 2 above): a "modest window"
 *   would either miss most of the real range or, built wide enough to cover them all, stop being
 *   modest at all. EARLIER this handed the RAW (still-degenerate, `-180..180`) bbox back —
 *   verified live (2026-09-25) that a raw whole-globe box's `cameraForBounds()` fit lands on
 *   `lng=0` (Africa), the OPPOSITE side of the world from any of the actual data, for "Whole
 *   range" (never a sensible "show me everywhere this model has data"). {@link hitLonArc}'s own
 *   arc (e.g. 145..294 continuous for the leatherback, ~149 deg — real, data-backed, and never
 *   re-normalized) is handed back instead: still wide enough to trigger
 *   `camera.ts#wideRangeAware`'s US-study-area narrowing (so the toggle appears, "US waters"
 *   default), but "Whole range" now fits an arc every degree of which is confirmed to hold data,
 *   not an arbitrary bisection of the globe.
 *
 * Returns `bbox` UNCHANGED (skipping the probe entirely) when it is not degenerate to begin with.
 */
export async function narrowLongitude(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig,
  cogUrl: string,
  bbox: Bbox,
): Promise<Bbox | null> {
  const [xmin, ymin, xmax, ymax] = bbox;
  if (xmax - xmin < GLOBE_SPAN_DEG) return bbox; // not degenerate — nothing to narrow
  const midLat = (ymin + ymax) / 2;
  // R3-rr fix 1, round 5 (orchestrator eyes-on: the toggle took 11-14s to appear -- CANDIDATE_LONS
  // sequentially, one /cog/point round-trip at a time): bounded concurrency, never sequential and
  // never unbounded ("never hammer titiler" -- this module's own header). The RESULT stays
  // order-independent of completion timing: `hits` is filtered back into CANDIDATE_LONS's own
  // fixed order below, not the order responses happen to arrive in, so hitLonArc()'s own dateline
  // math (which only cares about the SET of hits, not their order) sees byte-identical input to
  // the old sequential version for the same real data.
  const flags = await mapWithConcurrency(CANDIDATE_LONS, PROBE_CONCURRENCY, (lon) =>
    hasDataAt(fetchJson, config, cogUrl, lon, midLat),
  );
  const hits = CANDIDATE_LONS.filter((_, i) => flags[i]);
  if (hits.length === 0) return null;
  const [arcWest, arcEast] = hitLonArc(hits);
  if (arcEast - arcWest <= MULTI_REGION_SPREAD_DEG) {
    return [arcWest - NARROWED_HALF_WIDTH_DEG, ymin, arcEast + NARROWED_HALF_WIDTH_DEG, ymax];
  }
  // wide spread: hand back the confirmed-data arc itself (no extra padding -- it is already a
  // real, wide range, and padding it past 180 deg would trip camera.ts#minimalFrame's own
  // "re-derive the narrower complementary frame" rule into picking the WRONG, empty side).
  return [arcWest, ymin, arcEast, ymax];
}

/** the stock-titiler-backed `BoundsSource`. `fetchJson` is required (no default network
 * implementation baked in here) — the caller wires a real `fetch` in the browser and a fake in
 * tests, same convention as `point.ts#createTitilerValueSource`. */
export function createTitilerBoundsSource(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): BoundsSource {
  return {
    async cogBounds(cogUrl: string): Promise<Bbox | null> {
      let raw: unknown;
      try {
        raw = await fetchJson(titilerInfoUrl(config, cogUrl));
      } catch {
        return null; // network/parse failure -> null, never a throw (mirrors point.ts's own rule)
      }
      const bounds = (raw as { bounds?: unknown } | null)?.bounds;
      if (!Array.isArray(bounds) || bounds.length !== 4) return null;
      const [xmin, ymin, xmax, ymax] = bounds;
      const nums = [xmin, ymin, xmax, ymax];
      if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      const bbox: Bbox = [xmin, ymin, xmax, ymax];
      if (!bboxSpansGlobe(bbox, GLOBE_SPAN_DEG)) return bbox;
      return narrowLongitude(fetchJson, config, cogUrl, bbox);
    },
  };
}

// --- the COG's own footprint, for the raster SOURCE (WP11 item 4) -------------------------------------
//
// A different question from `cogBounds` above: that one answers "where should the CAMERA look" (and
// narrows a degenerate whole-globe-width extent by probing the data); this one answers "which tiles may
// MapLibre ask for", so it is the RAW footprint, never narrowed (a narrowed box would exclude real
// data). A regional COG (the NOAA seabird surfaces cover one coast) 404s every tile outside it; with
// the footprint as the source `bounds` MapLibre never requests them.
//
// It reads `/cog/info.geojson`, NOT `/cog/info`: `/cog/info`'s `bounds` are in the COG's OWN CRS
// (checked live 2026-10-14: the NOAA seabird COGs are Oblique Mercator and answer metres,
// `[-820443, -1234728, 1579556, 2045271]`), while the GeoJSON answer's `bbox` is always WGS84
// (`[-87.02, 23.07, -52.27, 53.30]`), which is what a MapLibre source wants.

/** `{host}/cog/info.geojson?url=<enc>`: the same encoding as every other `/cog/*` URL. */
export function titilerInfoGeoJsonUrl(config: TitilerConfig, cogUrl: string): string {
  return `${config.host}/cog/info.geojson?url=${encodeUrlReserved(cogUrl)}`;
}

/** the web-mercator latitude limit: titiler tiles end there, and MapLibre's bounds check wants it. */
export const MERCATOR_MAX_LAT = 85.0511;

/**
 * `/cog/info.geojson`'s WGS84 `bbox` -> the `bounds` of a MapLibre raster source: finite, west < east and
 * south < north, longitudes clamped to [-180, 180] and latitudes to the mercator limit. `null` for
 * anything else (a malformed answer draws without a bound rather than with a wrong one).
 */
export function sourceBoundsOf(raw: unknown): [number, number, number, number] | null {
  const b = (raw as { bbox?: unknown } | null)?.bbox;
  if (!Array.isArray(b) || b.length !== 4) return null;
  if (!b.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [w, s, e, n] = b as number[];
  const west = Math.max(-180, w);
  const east = Math.min(180, e);
  const south = Math.max(-MERCATOR_MAX_LAT, s);
  const north = Math.min(MERCATOR_MAX_LAT, n);
  if (!(west < east) || !(south < north)) return null;
  return [west, south, east, north];
}

/**
 * The MapLibre source `bounds` of an Item that states its own `bbox` (a registry row's box): the same
 * clamping as {@link sourceBoundsOf}, no tile-server request. `null` when the Item has no usable `bbox`
 * (the lens then reads the COG's footprint from `/cog/info.geojson`, once).
 */
export function itemSourceBounds(
  item: { bbox?: unknown } | null | undefined,
): [number, number, number, number] | null {
  return sourceBoundsOf({ bbox: item?.bbox });
}

export interface CogExtentCache {
  /** the COG's footprint (`/cog/info.geojson`), read once per COG; `null` when it cannot be read. */
  get(cogUrl: string): Promise<[number, number, number, number] | null>;
  /** how many COGs are cached (successes only; a failure is retried the next time it is asked for). */
  readonly size: number;
  /** how many `/cog/info.geojson` requests have been made. */
  readonly requests: number;
}

export function createCogExtentCache(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): CogExtentCache {
  const done = new Map<string, [number, number, number, number]>();
  const inflight = new Map<string, Promise<[number, number, number, number] | null>>();
  let requests = 0;
  return {
    get(cogUrl) {
      const hit = done.get(cogUrl);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(cogUrl);
      if (pending) return pending;
      const p = (async () => {
        requests++;
        let raw: unknown;
        try {
          raw = await fetchJson(titilerInfoGeoJsonUrl(config, cogUrl));
        } catch {
          return null;
        }
        const b = sourceBoundsOf(raw);
        if (b) done.set(cogUrl, b);
        return b;
      })().finally(() => inflight.delete(cogUrl));
      inflight.set(cogUrl, p);
      return p;
    },
    get size() {
      return done.size;
    },
    get requests() {
      return requests;
    },
  };
}
