// Regression (0.3.4): a report sent while viewing an UNLISTED collection (a `?collection=` share link,
// picker group "Unlisted (shared by link)") was filed as a PUBLIC GitHub issue with a screenshot:
// Shell.svelte handed the feedback dialog no `access` at all, so the payload's `restricted` was
// always false -- and the shared Ocean Metrics Apps Script the app posts to does not read that flag
// anyway (src/lib/feedback/endpoint.ts). The fix, rule by rule:
//   1. catalog/access.ts: an unlisted or `atlas:access: "restricted"` collection, or a view whose URL
//      carries `?collection=`/`?catalog=`, is restricted;
//   2. a restricted view's page link drops the share link (`collection`, `catalog`) before it reaches
//      the payload or the zero-backend issue link;
//   3. a restricted payload is never POSTed while restricted reports are held back;
//   4. Shell.svelte wires 1-2 into the dialog (`access={feedbackAccess}`).
// 0.3.5 (Ben, 2026-10-22): restricted reports are no longer held back by default -- they are filed as
// public issues like any other, so rule 2 is what keeps the share link (and so the data) out of them.
// Seeded faults (npm run test:faults): feedback-unlisted-not-restricted, feedback-restricted-posted,
// feedback-access-unwired, feedback-share-link-in-issue.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectionAccess,
  searchForAccess,
  viewAccess,
  type AccessEntry,
} from "../../src/lib/catalog/access";
import { loadCatalog, type CatalogCache } from "../../src/lib/catalog/load";
import { buildFeedbackPayload, type FeedbackPayloadInput } from "../../src/lib/feedback/payload";
import {
  canSendFeedback,
  RESTRICTED_MAY_SEND,
  RESTRICTED_PUBLIC_ISSUE_OK,
} from "../../src/lib/feedback/endpoint";
import {
  RESTRICTED_NOT_SENT,
  sendFeedback,
  type FetchLike,
} from "../../src/lib/feedback/postFeedback";
import { FIXTURE_BASE, fakeFetch, jsonResponse } from "../catalog/support";

const SHARE =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas-restricted/01TESTPREFIX/swfsc_cce_becker2020b/collection.json";
const SEARCH = `?lens=collection&collection=${encodeURIComponent(SHARE)}&map=3/-120/35`;

const unlisted: AccessEntry = { group: "unlisted", collection: {} };
const listedRestricted: AccessEntry = {
  group: "oceanmetrics",
  collection: { "atlas:access": "restricted" },
};
const listedPublic: AccessEntry = { group: "oceanmetrics", collection: {} };

const BASE: FeedbackPayloadInput = {
  kind: "data",
  title: "",
  text: "the humpback density looks off",
  email: "",
  includeUrl: true,
  pageUrl: "https://oceanmetrics.io/atlas/?lens=collection",
  hash: "",
  ver: null,
  appVersion: "0.3.4",
  appSha: "abc1234",
  lens: "collection",
  viewport: "1280x800",
  theme: "light",
  userAgent: "test",
  image: "data:image/png;base64,AAAA",
};

describe("regression 0.3.4: a report from an unlisted (shared-by-link) collection is restricted", () => {
  it("an unlisted entry is restricted, so the payload says restricted", () => {
    expect(collectionAccess(unlisted)).toBe("restricted");
    const access = viewAccess({ lens: "collection", entry: unlisted });
    expect(access).toBe("restricted");
    expect(buildFeedbackPayload({ ...BASE, access }).restricted).toBe(true);
  });

  it("the real loader puts a ?collection= link in the unlisted group, which reads as restricted", async () => {
    const coll = {
      type: "Collection",
      stac_version: "1.1.0",
      id: "swfsc_cce_becker2020b",
      description: "x",
      license: "other",
      extent: { spatial: { bbox: [[-131, 30, -117, 49]] }, temporal: { interval: [[null, null]] } },
      links: [],
    };
    const f = fakeFetch((u) => (u === SHARE ? jsonResponse(coll) : undefined));
    const cache: CatalogCache = new Map();
    const res = await loadCatalog({
      base: FIXTURE_BASE,
      fetchImpl: f.fetch,
      cache,
      extraCollections: [SHARE],
    });
    if (!res.ok) throw new Error("catalog failed");
    const entry = res.value.entries.find((e) => e.id === "swfsc_cce_becker2020b")!;
    expect(entry.group).toBe("unlisted");
    expect(collectionAccess(entry)).toBe("restricted");
    // and every listed fixture collection stays public
    for (const e of res.value.entries.filter((x) => x.group !== "unlisted"))
      expect(collectionAccess(e)).toBe("public");
  });
});

describe("collectionAccess / viewAccess: what counts as restricted", () => {
  it('a listed collection declaring atlas:access "restricted" is restricted', () => {
    expect(collectionAccess(listedRestricted)).toBe("restricted");
  });
  it("a listed collection without it is public; no entry is public", () => {
    expect(collectionAccess(listedPublic)).toBe("public");
    expect(collectionAccess(null)).toBe("public");
    expect(collectionAccess({ group: "oceanmetrics", collection: null })).toBe("public");
  });
  it("a ?collection= or ?catalog= in the URL makes the view restricted in either lens", () => {
    expect(viewAccess({ lens: "collection", collectionParam: SHARE, entry: listedPublic })).toBe(
      "restricted",
    );
    expect(viewAccess({ lens: "species", collectionParam: SHARE })).toBe("restricted");
    expect(viewAccess({ lens: "species", catalogParam: "https://staging.test/atlas/" })).toBe(
      "restricted",
    );
  });
  it("the species lens with no override is public whatever entry is passed", () => {
    expect(viewAccess({ lens: "species", entry: unlisted })).toBe("public");
    expect(viewAccess({ lens: "collection", entry: listedPublic })).toBe("public");
  });
});

describe("searchForAccess: a restricted view's page link never carries the share link", () => {
  it("drops `collection` and `catalog` when restricted, keeps the rest", () => {
    const out = searchForAccess(
      `${SEARCH}&catalog=${encodeURIComponent(FIXTURE_BASE)}`,
      "restricted",
    );
    expect(out).not.toContain("collection=");
    expect(out).not.toContain("catalog=");
    expect(out).not.toContain("atlas-restricted");
    expect(new URLSearchParams(out).get("map")).toBe("3/-120/35");
    expect(new URLSearchParams(out).get("lens")).toBe("collection");
  });
  it("leaves a public view's search untouched", () => {
    expect(searchForAccess(SEARCH, "public")).toBe(SEARCH);
  });
  it("returns an empty string when nothing is left", () => {
    expect(searchForAccess(`?collection=${encodeURIComponent(SHARE)}`, "restricted")).toBe("");
  });
});

describe("a restricted report is never POSTed while restricted reports are held back", () => {
  const spy = () => {
    const calls: string[] = [];
    const doFetch: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, text: async () => JSON.stringify({ ok: true }) };
    };
    return { calls, doFetch };
  };

  it("sendFeedback makes no request for a restricted payload when they are held back", async () => {
    const { calls, doFetch } = spy();
    const payload = buildFeedbackPayload({ ...BASE, access: "restricted" });
    const verdict = await sendFeedback("https://script.google.test/exec", payload, doFetch, false);
    expect(calls).toEqual([]);
    expect(verdict).toEqual({ ok: false, error: RESTRICTED_NOT_SENT });
  });
  it("posts it when restricted reports may be sent", async () => {
    const { calls, doFetch } = spy();
    const payload = buildFeedbackPayload({ ...BASE, access: "restricted" });
    await sendFeedback("https://script.google.test/exec", payload, doFetch, true);
    expect(calls).toHaveLength(1);
  });
  it("a public payload is posted as before", async () => {
    const { calls, doFetch } = spy();
    const payload = buildFeedbackPayload({ ...BASE, access: "public" });
    expect((await sendFeedback("https://script.google.test/exec", payload, doFetch)).ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it("canSendFeedback: no endpoint never; restricted only when restricted reports may be sent", () => {
    expect(canSendFeedback(null, false)).toBe(false);
    expect(canSendFeedback(null, true)).toBe(false);
    expect(canSendFeedback("https://x.test/exec", false)).toBe(true);
    expect(canSendFeedback("https://x.test/exec", true, false)).toBe(false);
    expect(canSendFeedback("https://x.test/exec", true, true)).toBe(true);
  });
});

describe("0.3.5: a restricted report is sent by default, and its public issue never carries the share link", () => {
  it("the policy is on (Ben, 2026-10-22), so a restricted view can send", () => {
    expect(RESTRICTED_PUBLIC_ISSUE_OK).toBe(true);
    expect(RESTRICTED_MAY_SEND).toBe(true);
    expect(canSendFeedback("https://x.test/exec", true)).toBe(true);
  });
  it("the posted body has the page link without the share link, even with the link box ticked", async () => {
    const bodies: string[] = [];
    const doFetch: FetchLike = async (_url, init) => {
      bodies.push(String(init?.body ?? ""));
      return { ok: true, text: async () => JSON.stringify({ ok: true }) };
    };
    // the page link as Shell.svelte builds it for a restricted view
    const pageUrl = `https://oceanmetrics.io/atlas/${searchForAccess(SEARCH, "restricted")}`;
    const payload = buildFeedbackPayload({
      ...BASE,
      pageUrl,
      includeUrl: true,
      access: "restricted",
    });
    const verdict = await sendFeedback("https://script.google.test/exec", payload, doFetch);
    expect(verdict.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    const sent = JSON.parse(bodies[0]) as { url?: string; restricted: boolean };
    expect(sent.restricted).toBe(true);
    expect(sent.url).toBe("https://oceanmetrics.io/atlas/?lens=collection&map=3%2F-120%2F35");
    expect(bodies[0]).not.toContain("atlas-restricted");
    expect(bodies[0]).not.toContain("collection=");
  });
});

describe("Shell.svelte wires the view's access into feedback (the 0.3.4 bug was the missing prop)", () => {
  const shell = readFileSync("src/shell/Shell.svelte", "utf8");
  // the FeedbackDialog mount: from `{#if FeedbackDialogComp}` to its `{/if}`
  const mount = shell.slice(
    shell.indexOf("{#if FeedbackDialogComp}"),
    shell.indexOf("{/if}", shell.indexOf("{#if FeedbackDialogComp}")),
  );

  it("passes access={feedbackAccess} to the dialog", () => {
    expect(mount.length).toBeGreaterThan(0);
    expect(mount).toMatch(/\baccess=\{feedbackAccess\}/);
  });
  it("feedbackAccess comes from viewAccess with the ?collection= and ?catalog= params and the lens' entry", () => {
    const def = shell.slice(
      shell.indexOf("const feedbackAccess"),
      shell.indexOf("const feedbackCtx"),
    );
    expect(def).toMatch(/viewAccess\(/);
    expect(def).toMatch(/collectionParam:\s*sel\.collection/);
    expect(def).toMatch(/catalogParam:\s*sel\.catalog/);
    expect(def).toMatch(/collectionLens\??\.entry/);
  });
  it("the feedback page link is built through searchForAccess", () => {
    expect(shell).toMatch(/searchForAccess\(formatSel\(sel\)\.search,\s*feedbackAccess\)/);
  });
});
