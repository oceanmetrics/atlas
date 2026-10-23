// gazetteer/config.ts -- where the Ocean Metrics places gazetteer lives, and the one credit line the
// atlas can always say about it. Tiny ON PURPOSE (it imports only the instance's strings): the map
// shell (static graph) imports this file; everything that pulls in hyparquet is in ./resolve.ts, reached by dynamic
// import() only (scripts/size-budget-core.mjs forbids "hyparquet" in the entry's static graph).
//
// TWO BASES, ONE TREE. The published root is https://storage.oceanmetrics.io/gazetteer/, but that
// host answers every object request with a 302 to the S3 bucket, INCLUDING the CORS preflight a
// cross-origin `Range` read triggers (checked 2026-10-08: `OPTIONS` -> 302), and a browser refuses a
// redirected preflight. Parquet row-group reads and PMTiles are all `Range` reads, so the app reads
// the bucket URL directly, exactly as `marine-atlas/` data does (src/lib/release/dataBase.ts) and as
// erddap-places' Then-vs-Now does. `GAZETTEER_ROOT` is the canonical, human-facing address (used in
// docs, citations and the credit link); `GAZETTEER_DATA_BASE` is what is fetched. Override both with
// `VITE_GAZETTEER_BASE` (a staging copy of the tree); the trailing slash is optional.

import { INSTANCE } from "../brand/instance";
import { store } from "../catalog/storage";

/** the canonical, published root of the gazetteer (what a person is told and cited). */
export const GAZETTEER_ROOT = "https://storage.oceanmetrics.io/gazetteer/";

/** the same tree on this build's storage host (catalog/storage.ts). */
export const GAZETTEER_BUCKET_BASE = store("gazetteer/");

const withSlash = (s: string): string => (s.endsWith("/") ? s : `${s}/`);

/** the base every gazetteer fetch (layers.json, parquet, PMTiles) is formed from. */
export function gazetteerDataBase(override?: string | null): string {
  const o = override ?? (import.meta.env?.VITE_GAZETTEER_BASE as string | undefined);
  return o ? withSlash(o) : GAZETTEER_BUCKET_BASE;
}

/**
 * A URL the published manifest names under {@link GAZETTEER_ROOT}, re-based onto the data base (see
 * the header: the canonical host's 302 breaks `Range` preflights). Any other URL passes through.
 */
export function toDataUrl(url: string, base = gazetteerDataBase()): string {
  return url.startsWith(GAZETTEER_ROOT) ? base + url.slice(GAZETTEER_ROOT.length) : url;
}

/** `<base>index/layers.json`: the layers manifest (403 until published; callers degrade). */
export const layersManifestUrl = (base = gazetteerDataBase()): string => `${base}index/layers.json`;

/** the `places` collection's PMTiles: 20 polygons (NMS:*, MRGID:*, PSGID:*), live today. */
export const PLACES_SLUG = "places";
export const placesTilesUrl = (base = gazetteerDataBase()): string =>
  `${base}${PLACES_SLUG}/${PLACES_SLUG}.pmtiles`;
export const PLACES_SOURCE_LAYER = "places";

/** the shared tail every gazetteer credit ends with (said once in a joined line). */
export const PROCESSED_BY = "Processed by Ocean Metrics.";

/**
 * The `places` collection's credit (its STAC providers: NOAA ONMS, Marine Regions, ProtectedSeas),
 * the fallback for a `places` tile or a place whose own credit cannot be fetched.
 */
export const PLACES_ATTRIBUTION = INSTANCE.places.attribution;

/** the credit for a place_id whose collection is unknown and whose index entry cannot be read. */
export const GENERIC_ATTRIBUTION = `Ocean Metrics places gazetteer (${GAZETTEER_ROOT}). ${PROCESSED_BY}`;

/** authorities served by the `places` collection (place_id prefix before the colon). */
const PLACES_AUTHORITIES = new Set(["NMS", "MRGID", "PSGID"]);

/** a place_id's authority: "BOEM:OCS-P 0562" -> "BOEM". */
export const authorityOf = (placeId: string): string => placeId.split(":")[0];

/** is this authority served by the built-in `places` collection? */
export const isPlacesAuthority = (authority: string): boolean => PLACES_AUTHORITIES.has(authority);

/** the built-in credit for a place_id, used when layers.json / the index are unreachable. */
export function fallbackAttribution(placeId: string): string {
  return PLACES_AUTHORITIES.has(authorityOf(placeId)) ? PLACES_ATTRIBUTION : GENERIC_ATTRIBUTION;
}

const SUFFIX = /\s*Processed by Ocean Metrics\.?\s*$/i;

/**
 * Join credit strings into one line: whitespace-normalised, deduplicated, and the shared
 * "Processed by Ocean Metrics." said once at the end (the same rule as `creditLine` of
 * @oceanmetrics/places, which is not imported here to keep hyparquet out of the static graph).
 */
export function joinCredits(parts: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const cores: string[] = [];
  let processed = false;
  for (const raw of parts) {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (SUFFIX.test(t)) processed = true;
    const core = t.replace(SUFFIX, "").replace(/[.;\s]+$/, "");
    if (core && !seen.has(core)) {
      seen.add(core);
      cores.push(core);
    }
  }
  if (!cores.length) return processed ? PROCESSED_BY : "";
  return `${cores.join("; ")}.${processed ? ` ${PROCESSED_BY}` : ""}`;
}
