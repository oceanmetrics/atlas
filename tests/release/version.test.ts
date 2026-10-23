import { describe, expect, it } from "vitest";
import {
  VERSION_RE,
  isVersionLabel,
  resolveVersion,
  versionFromPath,
  versionFromQuery,
} from "../../src/lib/release/version";

// exactly the plan's shape, byte for byte — not "matches these examples", which a looser regex
// (e.g. `[a-z]?` weakened to `[a-z]*`) can pass while still being the wrong rule. This is what
// makes the rule falsifiable rather than merely "matches the ok list".
const EXPECTED_SOURCE = "^v[0-9]+[a-z]?$";

// tokens that must be rejected everywhere, chosen to bracket the shape from every side: two
// trailing letters ("v9ab" — the one that a `[a-z]?` -> `[a-z]*` typo would silently start
// accepting), an uppercase suffix letter, an uppercase leading "v", no digits at all, no leading
// "v" at all, leading/trailing whitespace, a trailing newline, a trailing slash, and a hyphen.
const REJECTED = ["v9ab", "v9A", "V9", "v", "9", "v9 ", " v9", "v9\n", "v9/", "v-9"];

describe("VERSION_RE", () => {
  it("is exactly /^v[0-9]+[a-z]?$/, source and all — the same shape as msens::atlas_resolve_ver()", () => {
    expect(VERSION_RE.source).toBe(EXPECTED_SOURCE);
    expect(VERSION_RE.flags).toBe("");
  });

  it("matches valid labels", () => {
    for (const ok of ["v1", "v8", "v10", "v4b"]) expect(VERSION_RE.test(ok)).toBe(true);
  });

  it("rejects every malformed label, including the ones the ok-list alone wouldn't catch", () => {
    for (const bad of [
      "",
      "v",
      "8",
      "V8",
      "v8b2",
      "v8-a",
      "latest",
      "../etc",
      "v8; DROP",
      ...REJECTED,
    ]) {
      expect(VERSION_RE.test(bad)).toBe(false);
    }
  });
});

describe("isVersionLabel rejects every malformed label", () => {
  it.each(REJECTED)("rejects %j", (bad) => {
    expect(isVersionLabel(bad)).toBe(false);
  });
});

describe("a malformed label falls through at every position of the resolver", () => {
  it.each(REJECTED)("falls through in the PATH position: %j", async (bad) => {
    // the bad token sits where a version segment would. Most of these leave the path segment
    // unmatched entirely, so the resolver falls through to the good query value below — except
    // "v9/", which (correctly) still lets a real "/v9/" prefix resolve to "v9" before the extra
    // slash; either way, the exact bad token itself must never come back out.
    const fetchLatest = async () => "v6";
    const resolved = await resolveVersion(
      { pathname: `/${bad}/atlas/`, search: "?ver=v3" },
      fetchLatest,
    );
    expect(resolved).not.toBe(bad);
    // versionFromPath itself must never hand back the bad token verbatim either.
    expect(versionFromPath(`/${bad}/atlas/`)).not.toBe(bad);
  });

  it.each(REJECTED)("falls through in the QUERY position: %j", async (bad) => {
    const fetchLatest = async () => "v6";
    expect(
      await resolveVersion(
        { pathname: "/atlas/", search: `?ver=${encodeURIComponent(bad)}` },
        fetchLatest,
      ),
    ).toBe("v6"); // falls all the way through to latest.txt
    expect(versionFromQuery(`?ver=${encodeURIComponent(bad)}`)).toBeNull();
  });

  it.each(REJECTED)("falls through in the LATEST.TXT position: %j", async (bad) => {
    const fetchBad = async () => bad;
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, fetchBad)).toBeNull();
  });
});

describe("versionFromPath", () => {
  it("reads the leading /v9/ segment (the preview host's shape)", () => {
    expect(versionFromPath("/v9/atlas/")).toBe("v9");
    expect(versionFromPath("/v4b/atlas/index.html")).toBe("v4b");
  });

  it("is null with no version segment, even if a later segment looks like one", () => {
    expect(versionFromPath("/atlas/")).toBeNull();
    expect(versionFromPath("/atlas/v9/")).toBeNull();
  });
});

describe("versionFromQuery", () => {
  it("reads a well-formed ?ver=", () => {
    expect(versionFromQuery("?ver=v7")).toBe("v7");
  });

  it("a malformed ver falls through (returns null) instead of being surfaced", () => {
    expect(versionFromQuery("?ver=../etc")).toBeNull();
    expect(versionFromQuery("?ver=v8;%20DROP")).toBeNull();
    expect(versionFromQuery("")).toBeNull();
  });
});

describe("resolveVersion", () => {
  const fetchLatest = async () => "v7";

  it("path beats query beats latest.txt", async () => {
    expect(await resolveVersion({ pathname: "/v9/atlas/", search: "?ver=v3" }, fetchLatest)).toBe(
      "v9",
    );
    expect(await resolveVersion({ pathname: "/atlas/", search: "?ver=v3" }, fetchLatest)).toBe(
      "v3",
    );
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, fetchLatest)).toBe("v7");
  });

  it("a malformed ver falls through to latest.txt rather than erroring", async () => {
    expect(await resolveVersion({ pathname: "/atlas/", search: "?ver=../etc" }, fetchLatest)).toBe(
      "v7",
    );
  });

  it("resolves to null (never a throw) when latest.txt is unreachable and nothing else names a version", async () => {
    const fail = async () => {
      throw new Error("network error");
    };
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, fail)).toBeNull();
  });

  it("treats a malformed latest.txt body as unresolved rather than propagating garbage", async () => {
    const garbage = async () => "not-a-version";
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, garbage)).toBeNull();
  });
});
