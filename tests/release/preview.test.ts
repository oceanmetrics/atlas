import { describe, expect, it } from "vitest";
import {
  PREVIEW_BASE_URL,
  isSessionExpiry,
  previewSwitchUrl,
  sessionExpiryLatch,
  underReviewInfo,
} from "../../src/lib/release/preview";

describe("previewSwitchUrl (switching release on the preview host: '/{v}/atlas/', query + hash kept)", () => {
  it("replaces the version segment, keeping the rest of the path, query and hash", () => {
    const loc = { pathname: "/v9/atlas/report.html", search: "?lens=species", hash: "#t=Title" };
    expect(previewSwitchUrl("v7", loc)).toBe(
      `${PREVIEW_BASE_URL}/v7/atlas/report.html?lens=species#t=Title`,
    );
  });

  it("prepends the version segment when called from the public host (no version in the path)", () => {
    const loc = { pathname: "/atlas/", search: "", hash: "" };
    expect(previewSwitchUrl("v9", loc)).toBe(`${PREVIEW_BASE_URL}/v9/atlas/`);
  });

  it("carries an empty query and hash through as empty strings, not literal '?'/'#'", () => {
    const loc = { pathname: "/atlas/", search: "", hash: "" };
    expect(previewSwitchUrl("v9", loc)).not.toContain("?");
    expect(previewSwitchUrl("v9", loc).endsWith("/atlas/")).toBe(true);
  });

  it("preserves query AND hash together, un-mangled", () => {
    const loc = { pathname: "/v7/atlas/", search: "?sp=x,y&pal=magma", hash: "#pl=g1.a.b~z.pa.1" };
    expect(previewSwitchUrl("v9", loc)).toBe(
      `${PREVIEW_BASE_URL}/v9/atlas/?sp=x,y&pal=magma#pl=g1.a.b~z.pa.1`,
    );
  });
});

describe("underReviewInfo (data for the 'under review' modal — no UI in this phase)", () => {
  it("is null when nothing was denied", () => {
    expect(underReviewInfo(null, { pathname: "/atlas/", search: "", hash: "" })).toBeNull();
  });

  it("carries ver, reason, and a preview link with query + hash, for a denied restricted release", () => {
    const loc = { pathname: "/atlas/", search: "?lens=species", hash: "#t=My%20Report" };
    const info = underReviewInfo({ ver: "v9", reason: "restricted" }, loc);
    expect(info).toEqual({
      ver: "v9",
      reason: "restricted",
      previewHref: `${PREVIEW_BASE_URL}/v9/atlas/?lens=species#t=My%20Report`,
    });
  });

  it("carries the same shape for an unknown-version denial", () => {
    const info = underReviewInfo(
      { ver: "v42", reason: "unknown-version" },
      { pathname: "/atlas/", search: "", hash: "" },
    );
    expect(info?.reason).toBe("unknown-version");
  });
});

describe("isSessionExpiry", () => {
  it("is true for a 401", () => {
    expect(isSessionExpiry({ status: 401 })).toBe(true);
  });

  it("is true for an opaque redirect (status 0, type 'opaqueredirect')", () => {
    expect(isSessionExpiry({ status: 0, type: "opaqueredirect" })).toBe(true);
  });

  it("is false for an ordinary 200", () => {
    expect(isSessionExpiry({ status: 200, type: "basic" })).toBe(false);
  });

  it("is false for a plain 404 (not an expiry — that is just 'no session.json here')", () => {
    expect(isSessionExpiry({ status: 404 })).toBe(false);
  });

  it("is false for a 403 (forbidden is not the same signal as expired)", () => {
    expect(isSessionExpiry({ status: 403 })).toBe(false);
  });
});

describe("sessionExpiryLatch (raises ONE signal, never one per request)", () => {
  it("fires true on the first expiry it sees", () => {
    const probe = sessionExpiryLatch();
    expect(probe({ status: 401 })).toBe(true);
  });

  it("never fires again after the first expiry, even for more expired responses", () => {
    const probe = sessionExpiryLatch();
    expect(probe({ status: 401 })).toBe(true);
    expect(probe({ status: 401 })).toBe(false);
    expect(probe({ status: 0, type: "opaqueredirect" })).toBe(false);
  });

  it("never fires for a non-expiry response", () => {
    const probe = sessionExpiryLatch();
    expect(probe({ status: 200 })).toBe(false);
    expect(probe({ status: 404 })).toBe(false);
  });

  it("two independent latches (two page loads) each get their own first firing", () => {
    const a = sessionExpiryLatch();
    const b = sessionExpiryLatch();
    expect(a({ status: 401 })).toBe(true);
    expect(b({ status: 401 })).toBe(true); // a fresh latch, not sharing state with `a`
  });
});
