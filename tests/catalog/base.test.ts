import { describe, expect, it } from "vitest";
import {
  CATALOG_BASE,
  catalogUrl,
  resolveCatalogBase,
  resolveHref,
  validateCatalogBase,
} from "../../src/lib/catalog/base";

describe("CATALOG_BASE: the path-style S3 default", () => {
  it("is the public bucket's atlas/ prefix, read path-style (the storage host 302s without CORS)", () => {
    expect(CATALOG_BASE).toBe("https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/");
  });
});

describe("validateCatalogBase: https only, validated, normalised to end in /", () => {
  it("accepts an https URL and appends the trailing slash", () => {
    expect(validateCatalogBase("https://staging.example.test/atlas")).toBe(
      "https://staging.example.test/atlas/",
    );
    expect(validateCatalogBase("https://staging.example.test/atlas/")).toBe(
      "https://staging.example.test/atlas/",
    );
    expect(validateCatalogBase("  https://staging.example.test:8443/a/ ")).toBe(
      "https://staging.example.test:8443/a/",
    );
  });

  it("rejects http, other schemes, relative paths and non-strings (REGRESSION: never same-origin)", () => {
    for (const bad of [
      "http://staging.example.test/atlas/",
      "file:///tmp/atlas/",
      "javascript:alert(1)",
      "data:text/plain,x",
      "/atlas/",
      "./atlas/",
      "atlas/",
      "",
      "   ",
      null,
      undefined,
      42,
    ]) {
      expect(validateCatalogBase(bad), String(bad)).toBeNull();
    }
  });

  it("rejects embedded credentials, a query string and a fragment", () => {
    expect(validateCatalogBase("https://user:pw@staging.example.test/a/")).toBeNull();
    expect(validateCatalogBase("https://staging.example.test/a/?x=1")).toBeNull();
    expect(validateCatalogBase("https://staging.example.test/a/#frag")).toBeNull();
  });
});

describe("plain-http loopback: allowed for the BUILD-time override only, never from a link", () => {
  it("validateCatalogBase rejects http loopback unless allowLoopbackHttp is set", () => {
    expect(validateCatalogBase("http://localhost:8080/atlas")).toBeNull();
    expect(validateCatalogBase("http://localhost:8080/atlas", { allowLoopbackHttp: true })).toBe(
      "http://localhost:8080/atlas/",
    );
    expect(validateCatalogBase("http://127.0.0.1:9/", { allowLoopbackHttp: true })).toBe(
      "http://127.0.0.1:9/",
    );
  });

  it("allowLoopbackHttp never admits a non-loopback http host", () => {
    expect(
      validateCatalogBase("http://example.test/atlas/", { allowLoopbackHttp: true }),
    ).toBeNull();
    expect(
      validateCatalogBase("http://localhost.evil.test/", { allowLoopbackHttp: true }),
    ).toBeNull();
  });

  it("REGRESSION: a ?catalog= override of http loopback is ignored; the same value as the build env is honoured", () => {
    expect(resolveCatalogBase("http://localhost:8080/atlas/", undefined)).toBe(CATALOG_BASE);
    expect(resolveCatalogBase(undefined, "http://localhost:8080/atlas/")).toBe(
      "http://localhost:8080/atlas/",
    );
  });
});

describe("resolveCatalogBase: ?catalog= > VITE_CATALOG_BASE > the default", () => {
  it("a valid override wins over the env and the default", () => {
    expect(resolveCatalogBase("https://a.example.test/x/", "https://b.example.test/y/")).toBe(
      "https://a.example.test/x/",
    );
  });

  it("with no override, a valid build-time env wins over the default", () => {
    expect(resolveCatalogBase(undefined, "https://b.example.test/y")).toBe(
      "https://b.example.test/y/",
    );
  });

  it("a malformed override falls through to the env, then to the default -- never throws", () => {
    expect(resolveCatalogBase("http://evil.test/", "https://b.example.test/y/")).toBe(
      "https://b.example.test/y/",
    );
    expect(resolveCatalogBase("http://evil.test/", "nonsense")).toBe(CATALOG_BASE);
    expect(resolveCatalogBase(null, undefined)).toBe(CATALOG_BASE);
  });
});

describe("resolveHref / catalogUrl", () => {
  it("resolves a relative href against the referring document, not the page", () => {
    expect(resolveHref("https://atlas.test/atlas/biotrack/items/a.json", "../values.parquet")).toBe(
      "https://atlas.test/atlas/biotrack/values.parquet",
    );
    expect(resolveHref("https://atlas.test/atlas/catalog.json", "./c/collection.json")).toBe(
      "https://atlas.test/atlas/c/collection.json",
    );
  });

  it("an absolute href stays absolute", () => {
    expect(resolveHref("https://atlas.test/atlas/catalog.json", "https://other.test/x.json")).toBe(
      "https://other.test/x.json",
    );
  });

  it("an unresolvable href is null, not a throw", () => {
    expect(resolveHref("not a url", "../x")).toBeNull();
  });

  it("catalogUrl is catalog.json under the base", () => {
    expect(catalogUrl("https://atlas.test/atlas/")).toBe("https://atlas.test/atlas/catalog.json");
  });
});
