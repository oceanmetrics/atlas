import { describe, expect, it } from "vitest";
import {
  buildPageLocation,
  buildPagePath,
  type LocationLike,
} from "../../src/lib/analytics/pageLocation";
import { QUERY_KEYS } from "../../src/lib/state/types";

describe("buildPageLocation / buildPagePath — never the hash, never an unlisted query key", () => {
  it("rebuilds origin + path + allow-listed query, dropping nothing that is allowed", () => {
    const loc: LocationLike = {
      origin: "https://oceanmetrics.io",
      pathname: "/atlas/",
      search: "?lens=species&proj=mercator&sp=ms_merge%7CWORMS%3A137209",
    };
    expect(buildPageLocation(loc)).toBe(
      "https://oceanmetrics.io/atlas/?lens=species&proj=mercator&sp=ms_merge%7CWORMS%3A137209",
    );
  });

  it("buildPagePath omits the origin (matches ms_log_header()'s page column)", () => {
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?proj=mercator",
    };
    expect(buildPagePath(loc)).toBe("/atlas/?proj=mercator");
  });

  it("produces no trailing '?' when nothing survives the allow-list", () => {
    const loc: LocationLike = { origin: "https://x.test", pathname: "/atlas/", search: "" };
    expect(buildPageLocation(loc)).toBe("https://x.test/atlas/");
  });

  // seeded fault: a query key outside the allow-list passed through.
  it("seeded fault: drops a query key that is not in the allow-list", () => {
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?proj=mercator&secret_token=abc123&lens=collection",
    };
    const out = buildPageLocation(loc);
    expect(out).not.toContain("secret_token");
    expect(out).not.toContain("abc123");
    expect(out).toBe("https://x.test/atlas/?lens=collection&proj=mercator");
  });

  it("respects a caller-supplied allow-list narrower than QUERY_KEYS", () => {
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?lens=collection&proj=mercator",
    };
    expect(buildPageLocation(loc, ["proj"])).toBe("https://x.test/atlas/?proj=mercator");
  });

  it("the default allow-list is state/types.ts's QUERY_KEYS minus `catalog` and `collection` (a data-origin override or a private preview link never reaches analytics)", () => {
    const search = QUERY_KEYS.map((k) => `${k}=x`).join("&");
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: `?${search}`,
    };
    const out = buildPageLocation(loc);
    for (const key of QUERY_KEYS.filter((k) => k !== "catalog" && k !== "collection"))
      expect(out).toContain(`${key}=x`);
    expect(out).not.toContain("catalog=");
    expect(out).not.toContain("collection=");
  });

  // seeded fault: the hash included in page_location. LocationLike has no `hash` field, so this
  // proves the guarantee holds even when handed an object that DOES carry one (as window.location
  // would) — buildPageLocation must never read it.
  it("seeded fault: never includes the hash, even when the input object also carries one", () => {
    const locWithHash: LocationLike & { hash: string } = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?proj=mercator",
      hash: "#pl=z.pa.1,2,3~t=Sensitive%20Report%20Title",
    };
    const out = buildPageLocation(locWithHash);
    expect(out).not.toContain("#");
    expect(out).not.toContain("pl=z.pa");
    expect(out).not.toContain("Sensitive");
    expect(out).toBe("https://x.test/atlas/?proj=mercator");
  });

  it("hash-only keys (pl, t) are never in the query allow-list to begin with", () => {
    const keys: readonly string[] = QUERY_KEYS;
    expect(keys.includes("pl")).toBe(false);
    expect(keys.includes("t")).toBe(false);
  });
});
