import { describe, expect, it } from "vitest";
import {
  accessOf,
  decideAccess,
  requiresSession,
  type VersionRow,
} from "../../src/lib/release/access";
import {
  ACCESS_CASES,
  REGISTRY_ROWS,
  ROWS_MISSING_ACCESS,
  runModulePipeline,
} from "./access-cases";

// one assertion per rule/branch of the gate (plan D6). The pipeline table at the bottom is the
// shared one that index.html's inline copy is driven through too (tests/release/
// inline-early-fetch.test.ts) — these first blocks pin the pure rules underneath it.

describe("accessOf", () => {
  it("a row saying access: public is the only affirmative answer", () => {
    expect(accessOf(REGISTRY_ROWS, "v7")).toBe("public");
  });

  it("a row saying access: restricted is restricted (v7b, v8, v9 today)", () => {
    for (const ver of ["v7b", "v8", "v9"]) expect(accessOf(REGISTRY_ROWS, ver)).toBe("restricted");
  });

  it("a row with NO access key is restricted, never public (fail closed)", () => {
    expect(accessOf(ROWS_MISSING_ACCESS, "v8")).toBe("restricted");
  });

  it("a row with an unrecognized access value is restricted, not public", () => {
    const rows: VersionRow[] = [{ ver: "v9", access: "internal" }];
    expect(accessOf(rows, "v9")).toBe("restricted");
  });

  it("a version with no row at all is unknown", () => {
    expect(accessOf(REGISTRY_ROWS, "v42")).toBe("unknown");
  });

  it("an unreadable registry (null) is unknown for every version", () => {
    expect(accessOf(null, "v7")).toBe("unknown");
  });

  it("a registry that is not a list is unknown, not an empty list", () => {
    expect(accessOf({ versions: REGISTRY_ROWS } as unknown as VersionRow[], "v7")).toBe("unknown");
  });
});

describe("requiresSession (what the public path must NOT wait on)", () => {
  it("is false for a public release: the public path never awaits session.json", () => {
    expect(requiresSession(REGISTRY_ROWS, "v7", "v7")).toBe(false);
  });

  it("is true when the requested release is restricted", () => {
    expect(requiresSession(REGISTRY_ROWS, "v9", "v7")).toBe(true);
  });

  it("is true when the fall-through target is restricted", () => {
    expect(requiresSession(REGISTRY_ROWS, null, "v9")).toBe(true);
  });

  it("is false for an unknown version: it is denied regardless of any session", () => {
    expect(requiresSession(REGISTRY_ROWS, "v42", "v7")).toBe(false);
  });

  it("is false when the registry is unreadable: latest.txt only, session irrelevant", () => {
    expect(requiresSession(null, "v9", "v7")).toBe(false);
  });
});

describe("decideAccess", () => {
  const base = { latest: "v7", versions: REGISTRY_ROWS, session: null };

  it("renders a public release on the public host", () => {
    expect(decideAccess({ ...base, requested: "v7" })).toEqual({
      ver: "v7",
      source: "requested",
      denied: null,
      preview: false,
    });
  });

  it("denies a restricted release with no session and falls through to latest", () => {
    expect(decideAccess({ ...base, requested: "v9" })).toEqual({
      ver: "v7",
      source: "latest",
      denied: { ver: "v9", reason: "restricted" },
      preview: false,
    });
  });

  it("renders a restricted release for a preview session", () => {
    expect(decideAccess({ ...base, requested: "v9", session: { preview: true } })).toEqual({
      ver: "v9",
      source: "requested",
      denied: null,
      preview: true,
    });
  });

  it("denies a restricted release for a session without preview:true", () => {
    const d = decideAccess({ ...base, requested: "v9", session: { preview: false } });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v9", reason: "restricted" });
  });

  it("denies an unknown version even in preview (fail closed)", () => {
    const d = decideAccess({ ...base, requested: "v42", session: { preview: true } });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v42", reason: "unknown-version" });
  });

  it("with an unreadable versions.json allows only latest.txt's version", () => {
    const d = decideAccess({ requested: "v9", latest: "v7", versions: null, session: null });
    expect(d.ver).toBe("v7");
    expect(d.denied).toEqual({ ver: "v9", reason: "registry-unreadable" });
  });

  it("with an unreadable versions.json AND no latest.txt renders nothing", () => {
    expect(decideAccess({ requested: "v9", latest: null, versions: null, session: null })).toEqual({
      ver: null,
      source: null,
      denied: { ver: "v9", reason: "registry-unreadable" },
      preview: false,
    });
  });

  it("renders nothing when the fall-through target is itself denied", () => {
    const d = decideAccess({ ...base, requested: "v8", latest: "v9" });
    expect(d.ver).toBeNull();
    expect(d.denied).toEqual({ ver: "v8", reason: "restricted" });
  });

  it("resolves nothing, and records no denial, when no version resolved at all", () => {
    expect(
      decideAccess({ requested: null, latest: null, versions: REGISTRY_ROWS, session: null }),
    ).toEqual({ ver: null, source: null, denied: null, preview: false });
  });

  it("a path version is gated exactly like a query version (the path grants nothing)", () => {
    // /v9/atlas/ on a host with no session.json resolves requested = v9 the same way ?ver=v9 does.
    expect(decideAccess({ ...base, requested: "v9" }).denied).toEqual({
      ver: "v9",
      reason: "restricted",
    });
  });
});

describe("the shared access case table, run against the modules", () => {
  for (const c of ACCESS_CASES) {
    it(c.name, async () => {
      const res = await runModulePipeline(c);
      expect(res.ver).toBe(c.expect.ver);
      expect(res.denied).toEqual(c.expect.denied);

      const manifests = res.requested.filter((u) => u.endsWith("/manifest.json"));
      expect(manifests).toEqual(c.expect.manifestUrl ? [c.expect.manifestUrl] : []);

      for (const forbidden of c.expect.forbidden ?? []) {
        expect(res.requested.filter((u) => u.includes(forbidden))).toEqual([]);
      }

      // session.json is the ONLY same-origin (relative) request; everything else is an absolute
      // bucket URL. A relative data base — the F1 bug — fails right here.
      for (const url of res.requested) {
        if (url === "session.json") continue;
        expect(url.startsWith("https://")).toBe(true);
      }
    });
  }
});
