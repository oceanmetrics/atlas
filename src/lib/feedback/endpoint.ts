// U3 "Send feedback": which endpoint the dialog POSTs to. Build-time `VITE_FEEDBACK_URL` (set once
// the runbook's Apps Script is deployed, docs/feedback.md) with a `localStorage` override for
// testing against a second deployment or a local fixture without a rebuild -- the same escape hatch
// CalCOFI Explorer's own `feedbackEndpoint()` uses (../../CalCOFI/explore/src/feedback.tsx).
//
// Both legs are validated (`^https?://`) before use: an empty/unset env var or a garbage
// localStorage value must resolve to `null` (no endpoint), not silently become a broken fetch
// target the dialog then blames on "the network".

const OVERRIDE_KEY = "atlas.feedback_url";
const URL_RE = /^https?:\/\//;

export function feedbackEndpoint(): string | null {
  const env = (import.meta.env.VITE_FEEDBACK_URL as string | undefined)?.trim();
  if (env && URL_RE.test(env)) return env;
  try {
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored && URL_RE.test(stored)) return stored;
  } catch {
    /* private mode / storage disabled -- no override, not an error */
  }
  return null;
}

// --- restricted views ---------------------------------------------------------------------------
// The endpoint this app posts to is the SHARED Ocean Metrics Apps Script (oceanmetrics/erddap-places
// scripts/feedback/Code.gs, `APPS["oceanmetrics-atlas"]`). Unlike this repo's own
// scripts/feedback/Code.gs, it does not read the payload's `restricted` flag: it files the public
// GitHub issue (and commits the screenshot to the repo) for every report. So a restricted view (a
// collection under review, `catalog/access.ts`) is never posted at all until the deployed script
// skips the issue for `restricted: true`; then set this to `true` (and say so in CHANGELOG.md).
export const ENDPOINT_SKIPS_ISSUE_WHEN_RESTRICTED = false;

/** whether a report may be POSTed: an endpoint exists, and the view is not restricted unless the
 * endpoint is known to keep restricted reports out of public places. */
export function canSendFeedback(
  endpoint: string | null,
  restricted: boolean,
  endpointSkipsIssue: boolean = ENDPOINT_SKIPS_ISSUE_WHEN_RESTRICTED,
): boolean {
  if (!endpoint) return false;
  return !restricted || endpointSkipsIssue;
}
