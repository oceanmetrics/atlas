// V3 (P round, 2026-09-24): the two ServiceDef factories — mostly a "does this build the right
// URL/host label" check, since registry.test.ts already covers bannerMessage's copy in depth.
import { describe, expect, it } from "vitest";
import { dataServiceDef, tilerServiceDef } from "../../src/lib/health/services";

describe("tilerServiceDef", () => {
  it("probes /healthz on the given host, and strips the scheme for hostLabel", () => {
    const def = tilerServiceDef("https://titiler-v8.marinesensitivity.org");
    expect(def.url).toBe("https://titiler-v8.marinesensitivity.org/healthz");
    expect(def.hostLabel).toBe("titiler-v8.marinesensitivity.org");
    expect(def.id).toBe("tiler");
  });

  it("defaults to the real production titiler-v8 host when no host is given", () => {
    const def = tilerServiceDef();
    expect(def.url).toBe("https://titiler-v8.marinesensitivity.org/healthz");
  });
});

describe("dataServiceDef", () => {
  it("probes the release's own app/boot.json, under the public bucket base", () => {
    const def = dataServiceDef("v9");
    expect(def.url).toBe("https://storage.oceanmetrics.io/marine-atlas/v9/app/boot.json");
    expect(def.hostLabel).toBe("storage.oceanmetrics.io");
    expect(def.id).toBe("data");
  });

  it("the URL always names the SAME ver it was asked about, never a stale one", () => {
    expect(dataServiceDef("v7").url).toContain("/v7/app/boot.json");
    expect(dataServiceDef("v9").url).toContain("/v9/app/boot.json");
  });

  // P round 2 fix: `base`, when given, is `window.__early.base` -- the SAME resolved origin
  // index.html's own early-fetch script used for its `app/boot.json` fetch (a preview session's
  // signed-in data prefix, on the preview host). Threading it through here (services.ts's former
  // "known gap") means the probe can never disagree with what the release itself actually loaded.
  it("probes under a GIVEN resolved base, not the public bucket, when one is passed", () => {
    const def = dataServiceDef("v9", "https://data.example.org/prefix/");
    expect(def.url).toBe("https://data.example.org/prefix/v9/app/boot.json");
    expect(def.hostLabel).toBe("data.example.org");
  });

  it("falls back to the public bucket when no base is given", () => {
    expect(dataServiceDef("v9").url).toBe(
      "https://storage.oceanmetrics.io/marine-atlas/v9/app/boot.json",
    );
  });
});
