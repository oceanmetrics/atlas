// atlas-8 Deliverable 4 ("Beta feedback"): "Report a problem" opens a prefilled GitHub issue in
// `oceanmetrics/atlas` -- zero backend, the same fallback CalCOFI Explorer used (plan atlas-8's
// own citation). Every field a report needs to be actionable (app version + git SHA, the release,
// the lens, the page URL, user agent, viewport, theme, a short template) is composed HERE, in one
// pure function the caller (src/shell/Shell.svelte) calls with a snapshot of the current view -- this
// module never reads a live global itself.
//
// The page URL is REBUILT from origin + pathname + search -- never the fragment (`#...`), which
// carries a drawn place (`pl=`) or the report title (`t=`; plan D8's privacy rule: "geometry never
// leaves the browser, not even to analytics" -- the same rule src/lib/analytics/pageLocation.ts
// enforces for GA4). `PageLocationLike` deliberately has no `hash`/`href` field, the identical
// compile-time guarantee `pageLocation.ts`'s own `LocationLike` uses, for the identical reason.
// `tests/feedback/noHash.test.ts` is this directory's own copy of
// `tests/analytics/noRawLocation.wiring.test.ts`'s source-scan gate.
import { REPO } from "../brand/instance";

export interface PageLocationLike {
  origin: string;
  pathname: string;
  /** the query string, leading `?` optional -- NOT the fragment. */
  search: string;
}

/** origin + pathname + search, the fragment always excluded -- see the module header. Never reads
 * the live global `location` itself: the caller passes in whatever `loc` it already has (Shell.svelte
 * builds it from the reactive `Sel`, via `formatSel(sel).search` -- never `location.search`
 * directly -- so this recomputes whenever the view state changes, not just once at mount). */
export function pageUrlFromLocation(loc: PageLocationLike): string {
  const search = loc.search && !loc.search.startsWith("?") ? `?${loc.search}` : loc.search;
  return loc.origin + loc.pathname + search;
}

export interface FeedbackContext {
  /** `__APP_VERSION__` (package.json's version, inlined by vite.config.ts's `define`). */
  appVersion: string;
  /** `__APP_SHA__` (git rev-parse --short HEAD at build time; `"unknown"` when git is unavailable,
   * e.g. a CI fixture build -- vite.config.ts's own fallback, never thrown). */
  appSha: string;
  /** the RESOLVED release (`window.__early`'s version), or null before it settles. */
  ver: string | null;
  lens: string;
  /** already fragment-stripped, query kept -- see {@link pageUrlFromLocation}. */
  pageUrl: string;
  userAgent: string;
  /** `"{width}x{height}"` CSS pixels. */
  viewport: string;
  theme: string;
}

const ISSUE_BASE = `https://github.com/${REPO}/issues/new`;
const LABELS = "beta-feedback";
// GitHub silently truncates a `new/…` issue URL somewhere around 8 KB; staying comfortably under
// that keeps every identifier intact even on a browser whose user agent string runs long.
export const MAX_ISSUE_URL_LENGTH = 7500;
// trimmed FIRST (never an identifier) -- a real UA can run past a thousand characters on some
// Android/embedded browsers; this cap is generous for anything a person would actually read.
const MAX_USER_AGENT_LENGTH = 300;

const TEMPLATE = ["**What happened**", "", "", "**What you expected**", "", ""].join("\n");

function detailsBlock(ctx: FeedbackContext, userAgent: string): string {
  return [
    `- App version: ${ctx.appVersion} (${ctx.appSha})`,
    `- Release: ${ctx.ver ?? "unresolved"}`,
    `- Lens: ${ctx.lens}`,
    `- URL: ${ctx.pageUrl}`,
    `- Theme: ${ctx.theme}`,
    `- Viewport: ${ctx.viewport}`,
    `- User agent: ${userAgent}`,
  ].join("\n");
}

function buildUrl(ctx: FeedbackContext, opts: { template: boolean; userAgent: string }): string {
  const body = opts.template
    ? `${TEMPLATE}\n---\n${detailsBlock(ctx, opts.userAgent)}`
    : detailsBlock(ctx, opts.userAgent);
  const params = new URLSearchParams();
  params.set("title", `Beta feedback — ${ctx.lens} lens${ctx.ver ? `, ${ctx.ver}` : ""}`);
  params.set("body", body);
  params.set("labels", LABELS);
  return `${ISSUE_BASE}?${params.toString()}`;
}

/**
 * The full, prefilled "new issue" URL. Encoded with `URLSearchParams` (never hand-built query
 * concatenation), kept under {@link MAX_ISSUE_URL_LENGTH}: the user agent is trimmed first, then the
 * "What happened / What you expected" template is dropped -- the identifiers (app version, SHA,
 * release, lens, URL, theme, viewport) are never trimmed, in that order of priority.
 */
export function feedbackIssueUrl(ctx: FeedbackContext): string {
  let url = buildUrl(ctx, { template: true, userAgent: ctx.userAgent });
  if (url.length <= MAX_ISSUE_URL_LENGTH) return url;

  const trimmedUA =
    ctx.userAgent.length > MAX_USER_AGENT_LENGTH
      ? `${ctx.userAgent.slice(0, MAX_USER_AGENT_LENGTH)}…`
      : ctx.userAgent;
  url = buildUrl(ctx, { template: true, userAgent: trimmedUA });
  if (url.length <= MAX_ISSUE_URL_LENGTH) return url;

  url = buildUrl(ctx, { template: false, userAgent: trimmedUA });
  if (url.length <= MAX_ISSUE_URL_LENGTH) return url;

  // last resort (a pathologically long `pageUrl`/`appVersion` -- never expected in practice, since
  // state/'s own codec keeps the query short): a hard cap beats an unbounded string, even though a
  // plain slice can land mid-percent-escape. GitHub's own ~8 KB truncation would do the same thing.
  return url.slice(0, MAX_ISSUE_URL_LENGTH);
}
