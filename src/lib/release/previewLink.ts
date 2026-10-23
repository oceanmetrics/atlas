// D15 (master plan, 2026-09-21), handed over from atlas-3 to "whoever first builds the version
// picker" — this phase (atlas-4 step 3). A restricted release on the PUBLIC host is offered ONLY
// as a link to the preview host's `/{ver}/atlas/` path, carrying the current query + hash, NEVER
// `?ver={ver}` on Pages: the preview host's Cloudflare Access application is scoped by the
// `/{ver}` path PREFIX (exactly like today's `/{ver}/scores/`), so a query-string version never
// reaches the reviewer policy that would actually let the request through.
//
// Pure: no fetch, no DOM. `loc` is whatever the caller already has (typically `location` itself).

import { RELEASE } from "../brand/instance";

export interface PreviewLinkLoc {
  search: string;
  hash: string;
}

/** the instance's preview origin (`release.preview`). */
export const PREVIEW_HOST = RELEASE?.preview ?? "";

/**
 * The preview-host URL for `ver`, carrying the CURRENT query string and hash verbatim (a stray
 * `?ver=` left over from the public request is harmless there — path beats query in the version
 * -resolution precedence every host follows, `release/version.ts`).
 */
export function previewLinkFor(ver: string, loc: PreviewLinkLoc): string {
  return `${PREVIEW_HOST}/${ver}/atlas/${loc.search}${loc.hash}`;
}

// round 2, Q4 (P8 item 8, deferred): atlas-9 (the preview-host deployment) has not shipped the
// Atlas's own `/{ver}/atlas/` route yet -- `previewLinkFor` above points at a path that 404s a
// reviewer who follows it in good faith. Gated behind build-time `VITE_PREVIEW_ATLAS_ROUTE`
// (a Pages repository variable, `.github/workflows/pages.yml`) so flipping it live, once atlas-9
// deploys, is a variable change rather than a code change.

/**
 * Whether the preview host serves the Atlas app at all. Fails closed: unset, `"0"`, or anything
 * other than the literal string `"1"` means "not yet" (`VersionPickerModal.svelte` then falls
 * back to `previewScoresLinkFor`/`previewSpeciesLinkFor` instead of `previewLinkFor`). This is
 * the seeded-fault gate for "the Atlas preview link renders even though atlas-9 has not deployed
 * the route it points at."
 */
export function previewAtlasRouteEnabled(flag: string | undefined): boolean {
  return flag === "1";
}

/**
 * The preview host's Scores app for `ver` -- the honest fallback while `previewAtlasRouteEnabled`
 * is false. No query/hash carried: the Atlas's own params (drawn-place ids, viewport) name nothing
 * in a different app.
 */
export function previewScoresLinkFor(ver: string): string {
  return `${PREVIEW_HOST}/${ver}/scores/`;
}

/** same as `previewScoresLinkFor`, for the Species app. */
export function previewSpeciesLinkFor(ver: string): string {
  return `${PREVIEW_HOST}/${ver}/species/`;
}
