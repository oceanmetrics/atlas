import { describe, expect, it } from "vitest";
import {
  feedbackIssueUrl,
  MAX_ISSUE_URL_LENGTH,
  pageUrlFromLocation,
  type FeedbackContext,
  type PageLocationLike,
} from "../../src/lib/feedback/issueUrl";

const BASE_CTX: FeedbackContext = {
  appVersion: "0.10.16",
  appSha: "abc1234",
  ver: "v9",
  lens: "scores",
  pageUrl: "https://marinesensitivity.org/atlas/?lens=scores&ver=v9",
  userAgent: "Mozilla/5.0 (test)",
  viewport: "1280x800",
  theme: "navy",
};

function decodedBody(url: string): string {
  return new URL(url).searchParams.get("body") ?? "";
}

describe("pageUrlFromLocation", () => {
  it("composes origin + pathname + search, hash never present", () => {
    const loc: PageLocationLike = {
      origin: "https://marinesensitivity.org",
      pathname: "/atlas/",
      search: "?lens=species&ver=v9",
    };
    expect(pageUrlFromLocation(loc)).toBe(
      "https://marinesensitivity.org/atlas/?lens=species&ver=v9",
    );
  });

  it("tolerates a search value with no leading '?'", () => {
    const loc: PageLocationLike = {
      origin: "https://marinesensitivity.org",
      pathname: "/atlas/",
      search: "lens=species",
    };
    expect(pageUrlFromLocation(loc)).toBe("https://marinesensitivity.org/atlas/?lens=species");
  });

  it("an empty search produces no trailing '?'", () => {
    const loc: PageLocationLike = { origin: "https://x", pathname: "/atlas/", search: "" };
    expect(pageUrlFromLocation(loc)).toBe("https://x/atlas/");
  });

  it("never reads a hash/href field even if the object happens to carry one (defense in depth)", () => {
    // a real `Location` structurally satisfies `PageLocationLike` too (it has MORE fields, not
    // fewer) -- this proves the function only ever reads origin/pathname/search, never the extra
    // ones, by handing it a value typed loosely enough to carry a poisoned hash/href.
    const loc = {
      origin: "https://marinesensitivity.org",
      pathname: "/atlas/",
      search: "?lens=species",
      hash: "#pl=g1.SECRET-GEOMETRY",
      href: "https://marinesensitivity.org/atlas/?lens=species#pl=g1.SECRET-GEOMETRY",
    } as PageLocationLike;
    const out = pageUrlFromLocation(loc);
    expect(out).not.toContain("#");
    expect(out).not.toContain("SECRET-GEOMETRY");
    expect(out).toBe("https://marinesensitivity.org/atlas/?lens=species");
  });
});

describe("feedbackIssueUrl: base shape", () => {
  it("targets the atlas repo's new-issue endpoint with the beta-feedback label", () => {
    const url = feedbackIssueUrl(BASE_CTX);
    expect(url.startsWith("https://github.com/oceanmetrics/atlas/issues/new?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("labels")).toBe("beta-feedback");
  });

  it("is encoded with URLSearchParams -- round-trips through a real URL parse", () => {
    const ctx: FeedbackContext = { ...BASE_CTX, pageUrl: "https://x/atlas/?a=1&b=two words" };
    const url = feedbackIssueUrl(ctx);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("labels")).toBe("beta-feedback");
    expect(decodedBody(url)).toContain(ctx.pageUrl);
  });
});

describe("feedbackIssueUrl: rule — hash never appears in the body", () => {
  it("a pageUrl that (by construction) never carries a hash produces a body with none", () => {
    const url = feedbackIssueUrl(BASE_CTX);
    expect(decodedBody(url)).not.toContain("#");
  });
});

describe("feedbackIssueUrl: rule — the query is kept", () => {
  it("the full pageUrl, query string included, appears verbatim in the body", () => {
    const ctx: FeedbackContext = {
      ...BASE_CTX,
      pageUrl: "https://marinesensitivity.org/atlas/?ver=v9&lens=species&sp=whale",
    };
    const body = decodedBody(feedbackIssueUrl(ctx));
    expect(body).toContain("https://marinesensitivity.org/atlas/?ver=v9&lens=species&sp=whale");
  });
});

describe("feedbackIssueUrl: rule — labels=beta-feedback", () => {
  it("the labels param is exactly beta-feedback, no other labels appended", () => {
    const url = feedbackIssueUrl(BASE_CTX);
    expect(new URL(url).searchParams.getAll("labels")).toEqual(["beta-feedback"]);
  });
});

describe("feedbackIssueUrl: rule — length cap trims the UA (then the template), never an identifier", () => {
  it("a pathologically long user agent is trimmed to stay under the cap, identifiers survive", () => {
    const ctx: FeedbackContext = { ...BASE_CTX, userAgent: "M".repeat(20000) };
    const url = feedbackIssueUrl(ctx);
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    const body = decodedBody(url);
    expect(body).toContain(ctx.appVersion);
    expect(body).toContain(ctx.appSha);
    expect(body).toContain(ctx.ver as string);
    expect(body).toContain(ctx.lens);
    expect(body).toContain(ctx.pageUrl);
    // the UA itself was cut down, not left at its full 20,000-char length
    const uaLine = body.split("\n").find((l) => l.startsWith("- User agent:")) ?? "";
    expect(uaLine.length).toBeLessThan(20000);
    expect(uaLine.length).toBeGreaterThan(0);
  });

  it("a huge pageUrl (query) forces the 'drop the template' branch even after the UA is capped -- identifiers survive", () => {
    // measured: at this pageUrl length, trimming the UA alone still doesn't fit under the cap, so
    // the template gets dropped too -- but every identifier (version/sha/release/lens/url) must
    // still appear verbatim.
    const ctx: FeedbackContext = {
      ...BASE_CTX,
      userAgent: "M".repeat(20000),
      pageUrl: `https://x/atlas/?note=${"y".repeat(6830)}`,
    };
    const url = feedbackIssueUrl(ctx);
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    const body = decodedBody(url);
    expect(body).not.toContain("What happened");
    expect(body).toContain(ctx.appVersion);
    expect(body).toContain(ctx.appSha);
    expect(body).toContain(ctx.ver as string);
    expect(body).toContain(ctx.lens);
    expect(body).toContain(ctx.pageUrl);
  });

  it("a short UA is never trimmed at all", () => {
    const url = feedbackIssueUrl(BASE_CTX);
    expect(decodedBody(url)).toContain(BASE_CTX.userAgent);
    expect(decodedBody(url)).toContain("What happened");
  });
});

describe("feedbackIssueUrl: rule — SHA fallback ('unknown') is handled like any other value", () => {
  it("appSha: 'unknown' (vite.config.ts's own fallback when git is unavailable) renders cleanly", () => {
    const ctx: FeedbackContext = { ...BASE_CTX, appSha: "unknown" };
    const url = feedbackIssueUrl(ctx);
    expect(decodedBody(url)).toContain(`${ctx.appVersion} (unknown)`);
  });

  it("ver: null (not yet resolved) renders as 'unresolved', never 'null'", () => {
    const ctx: FeedbackContext = { ...BASE_CTX, ver: null };
    const url = feedbackIssueUrl(ctx);
    const body = decodedBody(url);
    expect(body).toContain("Release: unresolved");
    expect(body).not.toContain("null");
  });
});
