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
// collection under review, `catalog/access.ts`) becomes a public issue too. Once the deployed script
// skips the issue for `restricted: true`, set this to `true` (and say so in CHANGELOG.md).
export const ENDPOINT_SKIPS_ISSUE_WHEN_RESTRICTED = false;

// Ben, 2026-10-22 (0.3.5): feedback from a collection under review is ON even though it is filed as a
// public issue. The issue carries the reviewer's text and the screenshot, never the link the
// collection was shared by (`catalog/access.ts#searchForAccess` drops `collection`/`catalog` from
// the page link), so it does not hand anyone the data. `false` holds restricted reports back again
// (0.3.4: the dialog sends nothing and asks for comments to go to whoever shared the link).
export const RESTRICTED_PUBLIC_ISSUE_OK = true;

/** whether a restricted view's report may be POSTed: the endpoint keeps it out of public places, or
 * a public issue is accepted for it. */
export const RESTRICTED_MAY_SEND =
  ENDPOINT_SKIPS_ISSUE_WHEN_RESTRICTED || RESTRICTED_PUBLIC_ISSUE_OK;

/** whether a report may be POSTed: an endpoint exists, and the view is not restricted unless a
 * restricted report may be sent ({@link RESTRICTED_MAY_SEND}). */
export function canSendFeedback(
  endpoint: string | null,
  restricted: boolean,
  restrictedMaySend: boolean = RESTRICTED_MAY_SEND,
): boolean {
  if (!endpoint) return false;
  return !restricted || restrictedMaySend;
}
