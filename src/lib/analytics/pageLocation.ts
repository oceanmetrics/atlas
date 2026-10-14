// `page_location` is REBUILT from origin + path + an allow-list of query keys — NEVER the fragment
// portion of the URL. The fragment carries places (`#pl=`) and the report title (`#t=`) exactly so
// they cannot reach a server, a referrer header, or analytics (plan D8, master-plan first table's
// privacy row: "geometry never leaves the browser, not even to analytics"). `LocationLike`
// deliberately has no field for that fragment, so even a caller that hands this a real, live page
// location object (which does carry one) gets a compile-time guarantee this module never reads it.
// tests/analytics/noRawLocation.wiring.test.ts is the source-scan gate that keeps every file in this
// directory off the live global entirely, not just this one interface.
//
// The allow-list is state/types.ts's own `QUERY_KEYS` — the exact list of query keys `Sel` ever
// writes (state/'s header: "Query holds short, non-sensitive scalars") — imported rather than
// duplicated so the two cannot drift apart. Minus `catalog` and `collection`: a data-origin override (a staging
// folder, a localhost URL, a private preview link to an unlisted collection) is not something to send
// to analytics. `HASH_KEYS` (`pl`, `t`) never appears here because this
// module never even looks at the fragment.
import { QUERY_KEYS as SEL_QUERY_KEYS } from "../state/types";

const QUERY_KEYS = SEL_QUERY_KEYS.filter((k) => k !== "catalog" && k !== "collection");

export interface LocationLike {
  origin: string;
  pathname: string;
  /** the query string, leading `?` optional — NOT the URL's fragment (`#...`) portion. */
  search: string;
}

function filteredSearch(search: string, allowedKeys: readonly string[]): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  // iterate allowedKeys (not the incoming param order) so output key order is stable and any key
  // outside the allow-list is dropped, never merely reordered
  for (const key of allowedKeys) {
    for (const value of params.getAll(key)) kept.append(key, value);
  }
  const qs = kept.toString();
  return qs ? `?${qs}` : "";
}

/** the full `page_location` GA4 wants: origin + path + allow-listed query — never the fragment. */
export function buildPageLocation(
  loc: LocationLike,
  allowedKeys: readonly string[] = QUERY_KEYS,
): string {
  return loc.origin + loc.pathname + filteredSearch(loc.search, allowedKeys);
}

/** the Sheet log's `page` column (`ms_log_header()`'s `page` field, analytics.R's
 * `location.pathname + location.search`) — same allow-listing, no origin. */
export function buildPagePath(
  loc: LocationLike,
  allowedKeys: readonly string[] = QUERY_KEYS,
): string {
  return loc.pathname + filteredSearch(loc.search, allowedKeys);
}

/**
 * `page_title` — a fixed, non-sensitive label, NEVER the live document title. Fix round 1: a real
 * `document.title` was found to be a second leak surface for the same reason `page_location` is
 * rebuilt (nothing here guarantees some later component won't stash the report title there), so
 * this deliberately never reads it — `preview` is the only input, matching `content_group`'s own
 * atlas/atlas-preview split, so there is nothing here a report title or place name could reach.
 */
export function buildPageTitle(preview: boolean): string {
  return preview ? "Atlas (preview)" : "Atlas";
}
