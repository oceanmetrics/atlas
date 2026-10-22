// The optional `VITE_FEEDBACK_URL` leg (originally atlas-8 Deliverable 4; U3, round 2, is the real
// dialog that calls this). When that build-time env var (or its `atlas.feedback_url` localStorage
// override, endpoint.ts) is set, FeedbackDialog.svelte POSTs the built payload (payload.ts) here --
// and falls back to the zero-backend "Open as GitHub issue" link on ANY failure (network error, a
// non-2xx/non-ok response), so a misconfigured or unreachable endpoint never silently swallows
// feedback.
//
// `doFetch` is injected (same seam `src/lib/analytics/transport.ts` uses) so this stays unit-testable
// with no real network call, and so the browser default never runs under Node/Vitest by accident.
//
// NO `keepalive: true` (U3 fix, real defect found writing e2e/feedback.spec.ts): the ORIGINAL
// Deliverable 4 control fired this on the SAME click that could open a new tab, so `keepalive` kept
// it alive across that navigation. U3's dialog stays open through the whole send -- nothing
// navigates away -- and `keepalive` fetches are capped at a 64 KiB combined body quota (WHATWG fetch
// spec): a payload carrying a screenshot (routinely well over that) makes `fetch()` reject
// IMMEDIATELY, before any network attempt, with no distinguishable error and no request Playwright
// (or a real browser's network panel) ever sees -- it silently looked like "the endpoint is
// unreachable" instead of "the request was too big to keep alive." Dropping the flag removes the
// quota entirely; there is no more competing navigation for it to survive.
import { RESTRICTED_MAY_SEND } from "./endpoint";

/** the verdict's `error` when a restricted report is held back (never sent). */
export const RESTRICTED_NOT_SENT = "restricted view: not sent";

function isRestrictedPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { restricted?: unknown }).restricted === true
  );
}

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; text?: () => Promise<string> }>;

/**
 * The Apps Script answers every POST with HTTP 200 and a JSON body `{ok, error?}` (after a redirect to
 * script.googleusercontent.com), so an HTTP-level `ok` says nothing: an unknown app, a filled honeypot or
 * a hit rate cap all come back as 200 `{ok:false}`. Read the body when the transport exposes it; an
 * unreadable (opaque) body keeps the HTTP verdict. Exported for tests.
 */
export interface FeedbackVerdict {
  ok: boolean;
  /** the Sheet row id the script assigned (when the body was readable). */
  id?: string;
  /** the public GitHub issue the script opened (when it did: unrestricted app with a token). */
  issueUrl?: string;
  /** the script's own error text on a 200 `{ok:false}`. */
  error?: string;
}

/** the script's JSON verdict with its ids, or the HTTP verdict alone when the body is opaque. */
export async function readVerdict(res: {
  ok: boolean;
  text?: () => Promise<string>;
}): Promise<FeedbackVerdict> {
  if (!res.ok) return { ok: false };
  if (typeof res.text !== "function") return { ok: true };
  try {
    const body = (await res.text()).trim();
    if (!body.startsWith("{")) return { ok: true };
    const parsed = JSON.parse(body) as {
      ok?: unknown;
      id?: unknown;
      issue_url?: unknown;
      error?: unknown;
    };
    const v: FeedbackVerdict = { ok: parsed.ok !== false };
    if (typeof parsed.id === "string" && parsed.id) v.id = parsed.id;
    if (typeof parsed.issue_url === "string" && /^https:\/\/github\.com\//.test(parsed.issue_url))
      v.issueUrl = parsed.issue_url;
    if (typeof parsed.error === "string" && parsed.error) v.error = parsed.error;
    return v;
  } catch {
    return { ok: true };
  }
}

export async function bodySaysOk(res: {
  ok: boolean;
  text?: () => Promise<string>;
}): Promise<boolean> {
  return (await readVerdict(res)).ok;
}

/**
 * POST `payload` (JSON) to `url`. Returns whether it succeeded -- the caller falls back to the
 * GitHub issue link when this resolves `false`. `text/plain` keeps the request a CORS "simple
 * request" (an Apps Script `/exec` endpoint answers no `OPTIONS`, so an `application/json` preflight
 * would be dropped) -- the same reasoning `transport.ts`'s `createBrowserTransport` documents.
 */
export async function postFeedback(
  url: string,
  payload: unknown,
  doFetch: FetchLike,
): Promise<boolean> {
  return (await sendFeedback(url, payload, doFetch)).ok;
}

/** `postFeedback` with the script's verdict: the dialog shows the issue link it carries. */
export async function sendFeedback(
  url: string,
  payload: unknown,
  doFetch: FetchLike,
  restrictedMaySend: boolean = RESTRICTED_MAY_SEND,
): Promise<FeedbackVerdict> {
  // the last gate before the network: a restricted report never leaves the device while restricted
  // reports are held back (endpoint.ts), whatever the dialog did
  if (isRestrictedPayload(payload) && !restrictedMaySend) {
    return { ok: false, error: RESTRICTED_NOT_SENT };
  }
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    return await readVerdict(res);
  } catch {
    return { ok: false }; // network error, CORS failure, endpoint down -- the caller falls back to GitHub
  }
}
