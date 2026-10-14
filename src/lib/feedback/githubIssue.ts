// U3 "Send feedback": the zero-backend fallback -- "Open as GitHub issue" inside the dialog,
// same idea as the old "Report a problem" control (issueUrl.ts) but built from the FORM's current
// state (kind/title/text), not a fixed template, and labeled with the kind itself (R6: labels are
// exactly `bug`/`idea`/`question`/`data`, no separate "feedback" label). Never offered for a
// restricted release (R6) -- the caller (FeedbackDialog.svelte) is what enforces that by not
// rendering the control; this function itself has no opinion on `restricted` (it only builds a URL).
//
// Pure function, takes a FeedbackPayload -- never reads the live location itself
// (tests/feedback/noHash.test.ts's scan covers this whole directory).
import type { FeedbackPayload } from "./payload";

const ISSUE_BASE = "https://github.com/oceanmetrics/atlas/issues/new";
// GitHub silently truncates a `new/…` issue URL somewhere around 8 KB -- same reasoning as
// issueUrl.ts's own MAX_ISSUE_URL_LENGTH, applied to this dialog's own fields.
export const MAX_GITHUB_ISSUE_URL_LENGTH = 7500;

const FEEDBACK_KIND_TITLE: Record<FeedbackPayload["kind"], string> = {
  bug: "Bug report",
  idea: "Idea",
  question: "Question",
  data: "Data question",
};

function detailsBlock(p: FeedbackPayload): string {
  const lines = [
    `- App version: ${p.version} (${p.sha})`,
    `- Release: ${p.release || "unresolved"}`,
    `- Lens: ${p.lens}`,
    p.url ? `- URL: ${p.url}` : null,
    `- Theme: ${p.theme}`,
    `- Viewport: ${p.viewport}`,
    `- User agent: ${p.user_agent}`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/** the prefilled "new issue" URL for the CURRENT form state -- the screenshot is never embedded (a
 * GitHub issue URL cannot carry one); the caller copies it to the clipboard instead and says so. */
export function githubIssueUrl(payload: FeedbackPayload): string {
  const title = payload.title.trim() || `${FEEDBACK_KIND_TITLE[payload.kind]} — atlas`;
  const body = [payload.text.trim(), "", "---", detailsBlock(payload)].join("\n");
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  params.set("labels", payload.kind);
  let url = `${ISSUE_BASE}?${params.toString()}`;
  if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) return url;

  // trim the body first (never the identifiers block) -- same "identifiers survive last" priority
  // issueUrl.ts's own feedbackIssueUrl() uses.
  const shortBody = [payload.text.trim().slice(0, 500), "", "---", detailsBlock(payload)].join(
    "\n",
  );
  params.set("body", shortBody);
  url = `${ISSUE_BASE}?${params.toString()}`;
  if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) return url;
  return url.slice(0, MAX_GITHUB_ISSUE_URL_LENGTH);
}
