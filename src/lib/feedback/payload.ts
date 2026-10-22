// U3 "Send feedback" (round 2, replaces atlas-8 Deliverable 4's "Report a problem"): the pure
// payload builder FeedbackDialog.svelte posts to `VITE_FEEDBACK_URL` -- the exact shape
// `scripts/feedback/Code.gs` expects (docs/feedback.md's runbook). Kept here, not inline in the
// component, so a test asserts the exact shape without mounting anything
// (CLAUDE.md: "keep core logic in an exported function under src/lib/ ... a component calls it").
//
// The privacy rule (plan D8, the same one issueUrl.ts already enforces for the old control): the
// "include my current view link" checkbox is OFF by default, and when it is off the `url` field is
// not merely hash-stripped -- it is ABSENT from the payload entirely, so nothing about the page
// (not even the query) leaves the device unless the user opts in. `hash` (the raw `#...` fragment)
// is a SEPARATE input from `pageUrl` for the identical reason issueUrl.ts's `PageLocationLike` has
// no `hash` field: this module must never read the live location global itself.
// tests/feedback/noHash.test.ts's source scan already covers every file under src/lib/feedback/,
// so this file has to stay honest on its own -- it never references the live `location` global,
// by any spelling, anywhere (not even in a comment).

import { INSTANCE } from "../brand/instance";

export type FeedbackKind = "bug" | "idea" | "question" | "data";

/** the four kinds Ben decided (R6): each becomes both a radio option in the dialog and the exact
 * GitHub issue label `scripts/feedback/Code.gs` files under -- no separate label map, the kind IS
 * the label. */
export const FEEDBACK_KINDS: FeedbackKind[] = ["bug", "idea", "question", "data"];

/** short, segmented-control-sized labels -- the accessible name each option needs is a little
 * longer (see FeedbackDialog.svelte's own `aria-label`s), but the visible text has to fit four
 * options in one row down to a phone width. */
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Bug",
  idea: "Idea",
  question: "Question",
  data: "Data",
};

// matches calcofi4r::cc_feedback_script()'s own MAX_TEXT -- generous for what a person actually
// types, bounded so a pathological paste cannot blow up the Sheet row/mail/issue body.
export const MAX_TEXT_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 200;
// a data: URL image, base64 -- roughly 4/3 the raw byte count. capture.ts's fitBytes() already
// keeps the PNG itself under ~3 MB before it ever reaches this function; this is a second,
// independent cap (pure, no DOM, no dependency on fitBytes actually having run) so a caller that
// skipped it -- a test, a future caller -- cannot post something unbounded.
export const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

export interface FeedbackPayloadInput {
  kind: FeedbackKind;
  title: string;
  text: string;
  email: string;
  /** the "include my current view link" checkbox -- OFF by default in the dialog. */
  includeUrl: boolean;
  /** origin + pathname + search, fragment ALWAYS stripped -- see issueUrl.ts's `pageUrlFromLocation`. */
  pageUrl: string;
  /** the raw `#...` fragment (may be `""`), placed on `url` ONLY when `includeUrl` is true. Kept a
   * separate input -- never read from a live global here -- for the same reason `pageUrl` is. */
  hash: string;
  /** the resolved release, or `null` before it settles. */
  ver: string | null;
  /** the resolved release's `access` field (versions.json row) -- only the literal `"restricted"`
   * flips the payload's `restricted` flag; `"public"`, `"unknown"` and unset all read as false. */
  access?: string;
  appVersion: string;
  appSha: string;
  lens: string;
  viewport: string;
  theme: string;
  userAgent: string;
  /** a `data:image/...` URL, already size-capped by capture.ts's `fitBytes()`; absent when the
   * user removed the screenshot, capture failed, or it did not fit under {@link MAX_IMAGE_DATA_URL_LENGTH}. */
  image?: string;
  /** the honeypot field's typed value -- must stay `""` from a real person. Enforced server-side
   * (`scripts/feedback/Code.gs`), never by this pure function; it is only carried through here. */
  website?: string;
}

export interface FeedbackPayload {
  /** the key the shared Ocean Metrics Apps Script knows this app by (its `APPS` map; an unknown app is refused). */
  app: string;
  kind: FeedbackKind;
  title: string;
  text: string;
  email: string;
  /** present ONLY when the caller ticked "include my current view link". */
  url?: string;
  release: string;
  version: string;
  sha: string;
  lens: string;
  viewport: string;
  theme: string;
  user_agent: string;
  /** present only when a screenshot was captured/kept AND it fits {@link MAX_IMAGE_DATA_URL_LENGTH}. */
  image?: string;
  website: string;
  restricted: boolean;
}

/** builds the exact JSON object `postFeedback()` sends. Pure: no DOM, no network, no global read. */
export function buildFeedbackPayload(input: FeedbackPayloadInput): FeedbackPayload {
  const restricted = input.access === "restricted";
  const payload: FeedbackPayload = {
    app: INSTANCE.feedback.app,
    kind: input.kind,
    title: input.title.trim().slice(0, MAX_TITLE_LENGTH),
    text: input.text.trim().slice(0, MAX_TEXT_LENGTH),
    email: input.email.trim(),
    release: input.ver ?? "",
    version: input.appVersion,
    sha: input.appSha,
    lens: input.lens,
    viewport: input.viewport,
    theme: input.theme,
    user_agent: input.userAgent,
    website: input.website ?? "",
    restricted,
  };
  // the privacy rule, load-bearing: `url` is a key that EXISTS only when the box was ticked --
  // never present-but-empty, never present-with-query-only. tests/feedback/payload.test.ts pins
  // this with `"url" in payload`, not just `payload.url` (which would also pass for `undefined`).
  if (input.includeUrl) payload.url = input.pageUrl + input.hash;
  if (input.image && input.image.length <= MAX_IMAGE_DATA_URL_LENGTH) payload.image = input.image;
  return payload;
}
