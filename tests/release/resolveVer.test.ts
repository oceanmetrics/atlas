import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  candidateVer,
  previewUser,
  previewVer,
  resolveVer,
} from "../../src/lib/release/resolveVer";
import type { SessionInfo } from "../../src/lib/release/session";
import type { VersionRow } from "../../src/lib/release/access";

const RESOLVE_VER_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/lib/release/resolveVer.ts"),
  "utf8",
);

const PUBLIC: SessionInfo = { preview: false, raw: null };
const previewSession = (raw: unknown): SessionInfo => ({ preview: true, raw });

describe("previewVer (session.raw.ver, Caddy-derived — plan atlas-2 Step 2)", () => {
  it("reads a well-formed ver off a preview session", () => {
    expect(previewVer(previewSession({ preview: true, ver: "v9" }))).toBe("v9");
  });

  it("is null when the session is not preview, however the body looks", () => {
    expect(previewVer({ preview: false, raw: { ver: "v9" } })).toBeNull();
  });

  it("is null when raw has no ver at all", () => {
    expect(previewVer(previewSession({ preview: true }))).toBeNull();
  });

  it("is null when ver is not a well-formed version label (never surfaces garbage)", () => {
    expect(previewVer(previewSession({ ver: "latest" }))).toBeNull();
    expect(previewVer(previewSession({ ver: "../etc" }))).toBeNull();
    expect(previewVer(previewSession({ ver: 9 }))).toBeNull();
  });

  it("is null when raw itself is not an object", () => {
    expect(previewVer({ preview: true, raw: "v9" })).toBeNull();
    expect(previewVer({ preview: true, raw: null })).toBeNull();
  });
});

describe("previewUser (session.raw.user)", () => {
  it("reads a string user off a preview session", () => {
    expect(previewUser(previewSession({ user: "reviewer@example.org" }))).toBe(
      "reviewer@example.org",
    );
  });

  it("is undefined when the session is not preview", () => {
    expect(previewUser({ preview: false, raw: { user: "x" } })).toBeUndefined();
  });

  it("is undefined when user is absent, empty, or not a string", () => {
    expect(previewUser(previewSession({}))).toBeUndefined();
    expect(previewUser(previewSession({ user: "" }))).toBeUndefined();
    expect(previewUser(previewSession({ user: 42 }))).toBeUndefined();
  });
});

describe("candidateVer (the seeded fault: '?ver= honoured in preview mode')", () => {
  const loc = { pathname: "/v9/atlas/", search: "?ver=v7" };

  it("in preview mode, session.ver wins over BOTH the path and ?ver= — the fault this guards", () => {
    // deliberately conflicting: path says v9, query says v7, session says v3 — session.ver must win.
    const session = previewSession({ ver: "v3" });
    expect(candidateVer(loc, session)).toBe("v3");
  });

  it("?ver= alone, with no preview session, never overrides the path (public-mode precedence)", () => {
    expect(candidateVer(loc, PUBLIC)).toBe("v9"); // path beats query, same as version.ts
  });

  it("in public mode, query beats an absent path when the path has no version", () => {
    expect(candidateVer({ pathname: "/atlas/", search: "?ver=v7" }, PUBLIC)).toBe("v7");
  });

  it("is null in public mode when neither path nor query name a version (latest.txt fallback is decideAccess's job)", () => {
    expect(candidateVer({ pathname: "/atlas/", search: "" }, PUBLIC)).toBeNull();
  });

  it("a preview:true session with no valid ver at all falls back to normal precedence, not null", () => {
    const session = previewSession({}); // preview true, but no `ver` in the body
    expect(candidateVer(loc, session)).toBe("v9"); // path/query precedence resumes
  });
});

describe("candidateVer / resolveVer: preview mode has exactly one door (the other seeded faults)", () => {
  it("a query parameter alone can never assert preview — candidateVer needs `session.preview===true`", () => {
    // a session object that is NOT preview, even though its raw body claims preview-like fields,
    // must never let ?ver= (or anything else) act as if it came from a preview session.
    const notPreview: SessionInfo = { preview: false, raw: { ver: "v9", preview: true } };
    expect(candidateVer({ pathname: "/atlas/", search: "?ver=v9" }, notPreview)).toBe("v9");
    // (this resolves to v9 via ORDINARY public-mode ?ver= precedence, not because previewVer fired)
    expect(previewVer(notPreview)).toBeNull();
  });

  it("neither previewVer nor candidateVer ever reads localStorage or compares location.hostname", () => {
    // source-scan guard: preview mode's only door is session.preview === true (session.ts's
    // resolveSession, driven off a same-origin session.json fetch) — grep this module's own source
    // for the two other ways a preview bypass has historically crept in.
    expect(RESOLVE_VER_SRC).not.toMatch(/localStorage/);
    expect(RESOLVE_VER_SRC).not.toMatch(/location\.host/);
  });
});

describe("resolveVer (candidateVer gated through decideAccess)", () => {
  const versions: VersionRow[] = [
    { ver: "v7", status: "released", access: "public" },
    { ver: "v9", status: "prerelease", access: "restricted" },
  ];

  it("renders a public release on the public host", () => {
    const d = resolveVer({
      loc: { pathname: "/atlas/", search: "" },
      session: PUBLIC,
      latest: "v7",
      versions,
    });
    expect(d).toEqual({ ver: "v7", source: "latest", denied: null, preview: false });
  });

  it("a restricted release named by ?ver= on the public host is denied and falls through", () => {
    const d = resolveVer({
      loc: { pathname: "/atlas/", search: "?ver=v9" },
      session: PUBLIC,
      latest: "v7",
      versions,
    });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v9", reason: "restricted" });
  });

  it("a preview session renders its OWN session.ver, even overriding a conflicting path", () => {
    const d = resolveVer({
      loc: { pathname: "/v7/atlas/", search: "" }, // path disagrees with the session on purpose
      session: previewSession({ ver: "v9" }),
      latest: "v7",
      versions,
    });
    expect(d.ver).toBe("v9");
    expect(d.denied).toBeNull();
  });

  it("the seeded fault: a version missing from versions.json is denied even in preview (fail closed)", () => {
    const d = resolveVer({
      loc: { pathname: "/v42/atlas/", search: "" },
      session: previewSession({ ver: "v42" }),
      latest: "v7",
      versions,
    });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v42", reason: "unknown-version" });
  });

  it("the seeded fault: a row without `access` is treated as restricted, not public", () => {
    const rowsMissingAccess: VersionRow[] = [
      { ver: "v7", status: "released", access: "public" },
      { ver: "v8", status: "prerelease" }, // no `access` key at all
    ];
    const d = resolveVer({
      loc: { pathname: "/atlas/", search: "?ver=v8" },
      session: PUBLIC,
      latest: "v7",
      versions: rowsMissingAccess,
    });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v8", reason: "restricted" });
  });
});
