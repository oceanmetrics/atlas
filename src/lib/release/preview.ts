// Cross-host navigation for the preview gate (plan D1, D6; atlas-2 Step 2). Two things live here:
// where the "switch release" control sends the browser on the preview host, and what data an
// "under review" modal needs on the public host when a restricted `ver` is denied. Pure
// string-building only — plan atlas-2 is explicit that this phase ships "data and pure functions
// only: no UI"; the modal itself is a later phase's work.
import { RELEASE } from "../brand/instance";
import type { DenialReason } from "./access";

/** the instance's preview origin (`release.preview`, mirroring msens `atlas_preview_url()`'s default;
 * plan D1). */
export const PREVIEW_BASE_URL = RELEASE?.preview ?? "";

export interface LocationHashLike {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * `{PREVIEW_BASE_URL}/{v}/atlas/...`, keeping the path AFTER `/atlas/` (so `report.html` survives a
 * version switch) plus the current query and hash verbatim (plan: "switching release ... navigates to
 * `/{v}/atlas/` with the same query + hash so that path's own Access policy decides"). Works from
 * either host: called from the preview host itself (`/{oldV}/atlas/...`) it replaces the old version
 * segment; called from the public host (`/atlas/...`, no version segment) it prepends one — which is
 * exactly the link the "under review" modal needs (`underReviewInfo`, below).
 */
export function previewSwitchUrl(v: string, loc: LocationHashLike): string {
  const afterAtlas = loc.pathname.replace(/^.*?\/atlas\//, "");
  return `${PREVIEW_BASE_URL}/${v}/atlas/${afterAtlas}${loc.search}${loc.hash}`;
}

export interface UnderReview {
  /** the restricted release that was denied. */
  ver: string;
  reason: DenialReason;
  /** the preview URL to follow, carrying the current query + hash (plan atlas-2 Step 2). */
  previewHref: string;
}

/**
 * Data for the "under review" modal (plan atlas-2 Step 2): in public mode a restricted `ver` renders
 * nothing from that release; this is what a (later) modal needs to say why and offer a way in — which
 * release, the denial reason, and the preview URL reproducing the current view for a reviewer to sign
 * in at. Returns `null` when nothing was denied (`AccessDecision.denied`, access.ts).
 */
export function underReviewInfo(
  denied: { ver: string; reason: DenialReason } | null,
  loc: LocationHashLike,
): UnderReview | null {
  if (!denied) return null;
  return { ver: denied.ver, reason: denied.reason, previewHref: previewSwitchUrl(denied.ver, loc) };
}

// --- session expiry (plan atlas-2 Step 2) -------------------------------------------------------

export interface FetchResultLike {
  status: number;
  /** a `fetch()` `Response.type`; `"opaqueredirect"` is what a same-origin request with
   * `redirect: "manual"` observes when Cloudflare Access redirects it to a sign-in page instead of
   * answering — the shape a same-origin fetch takes once the Access session has expired mid-visit. */
  type?: string;
}

/** an opaque redirect or a 401 on a same-origin fetch: the two observable shapes of an expired
 * Cloudflare Access session (plan atlas-2 Step 2). */
export function isSessionExpiry(res: FetchResultLike): boolean {
  return res.status === 401 || res.type === "opaqueredirect";
}

/**
 * A latch that raises the "Session expired — reload to sign in" signal exactly ONCE per page load,
 * however many same-origin fetches go on to observe the expiry afterwards — "never a broken panel"
 * per request, one banner for the whole session. Returns a probe function: `true` the first time it
 * sees an expired response, `false` on every call after (including later calls that are themselves
 * expired).
 */
export function sessionExpiryLatch(): (res: FetchResultLike) => boolean {
  let fired = false;
  return (res) => {
    if (fired || !isSessionExpiry(res)) return false;
    fired = true;
    return true;
  };
}
