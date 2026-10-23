import { describe, expect, it } from "vitest";
import {
  manifest,
  manifestCapability,
  minimalManifestCheck,
  type Manifest,
} from "../../src/lib/release/manifest";

describe("minimalManifestCheck (the structural check standing in for the real JSON Schema, TODO atlas-1)", () => {
  it("accepts a well-formed manifest", () => {
    const m = minimalManifestCheck({
      ver: "v9",
      capabilities: { cell_species_list: true },
      tables: { cell: "https://example/v9/tables/cell.parquet" },
    });
    expect(m).toEqual({
      ver: "v9",
      capabilities: { cell_species_list: true },
      tables: { cell: "https://example/v9/tables/cell.parquet" },
    });
  });

  it("defaults capabilities to {} when the key is absent, rather than rejecting the manifest", () => {
    const m = minimalManifestCheck({ ver: "v9" });
    expect(m?.capabilities).toEqual({});
  });

  it("defaults tables to {} when the key is absent", () => {
    const m = minimalManifestCheck({ ver: "v9" });
    expect(m?.tables).toEqual({});
  });

  it("rejects a raw value with no ver at all", () => {
    expect(minimalManifestCheck({ capabilities: {} })).toBeNull();
  });

  it("rejects a ver that is not a version label", () => {
    expect(minimalManifestCheck({ ver: "latest" })).toBeNull();
  });

  it("rejects null, an array, and a non-object", () => {
    for (const raw of [null, undefined, [], "v9", 42]) {
      expect(minimalManifestCheck(raw)).toBeNull();
    }
  });

  it("carries the optional v7b+ `methods` array through untouched", () => {
    const methods = [{ method_key: "m1", value: 1, description: "d" }];
    const m = minimalManifestCheck({ ver: "v7b", methods });
    expect(m?.methods).toEqual(methods);
  });
});

describe("manifestCapability (mirrors msens manifest_can(), version.R:466-477)", () => {
  const m: Manifest = { ver: "v9", capabilities: { cell_species_list: true }, tables: {} };

  it("is true only for a capability explicitly set true", () => {
    expect(manifestCapability(m, "cell_species_list")).toBe(true);
  });

  it("is false for a capability explicitly set false", () => {
    const n: Manifest = { ver: "v9", capabilities: { score_cogs: false }, tables: {} };
    expect(manifestCapability(n, "score_cogs")).toBe(false);
  });

  it("is false for a capability the manifest never mentions", () => {
    expect(manifestCapability(m, "native_representation")).toBe(false);
  });

  it("is false when the whole manifest is null/undefined", () => {
    expect(manifestCapability(null, "cell_species_list")).toBe(false);
    expect(manifestCapability(undefined, "cell_species_list")).toBe(false);
  });

  it("is false when capabilities itself is an empty object", () => {
    expect(manifestCapability({ ver: "v9", capabilities: {}, tables: {} }, "anything")).toBe(false);
  });
});

describe("manifest() (consumes window.__early when present)", () => {
  it("prefers early.manifest over fetching", async () => {
    const fetchJson = async () => {
      throw new Error("must not fetch when early.manifest is present");
    };
    const m = await manifest("v9", {
      early: { manifest: Promise.resolve({ ver: "v9", capabilities: {}, tables: {} }) },
      fetchJson,
    });
    expect(m?.ver).toBe("v9");
  });

  it("falls back to fetchJson when there is no early object (report.html's path)", async () => {
    const requested: string[] = [];
    const m = await manifest("v9", {
      fetchJson: async (url) => {
        requested.push(url);
        return { ver: "v9", capabilities: {}, tables: {} };
      },
    });
    expect(m?.ver).toBe("v9");
    expect(requested).toEqual([
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/manifest.json",
    ]);
  });

  it("resolves to null, never a throw, when early.manifest rejects", async () => {
    const m = await manifest("v9", { early: { manifest: Promise.reject(new Error("network")) } });
    expect(m).toBeNull();
  });

  it("resolves to null when there is neither an early object nor a fetchJson", async () => {
    expect(await manifest("v9")).toBeNull();
  });

  it("resolves to null when ver is null and there is no early object", async () => {
    expect(await manifest(null, { fetchJson: async () => ({ ver: "v9" }) })).toBeNull();
  });

  it("passes the raw payload through an injected validator", async () => {
    let sawRaw: unknown;
    const validate = (raw: unknown) => {
      sawRaw = raw;
      return null;
    };
    const m = await manifest("v9", {
      early: { manifest: Promise.resolve({ ver: "v9" }) },
      validate,
    });
    expect(m).toBeNull();
    expect(sawRaw).toEqual({ ver: "v9" });
  });

  it("a validator rejection resolves to null, not a throw", async () => {
    const m = await manifest("v9", {
      early: { manifest: Promise.resolve({ ver: "v9" }) },
      validate: () => null,
    });
    expect(m).toBeNull();
  });
});

// TODO(atlas-1): once msens publishes the manifest.json JSON Schema, add a drift guard comparing its
// sha256 against msens `main`'s copy, mirroring tests/pins.test.ts's verdict-drift pattern. Until
// then manifest() validates with minimalManifestCheck() only (see the module header).
it.skip("manifest.json JSON Schema sha256 matches msens main (TODO atlas-1: schema not yet published)", () => {
  expect(true).toBe(false); // placeholder body; never runs while skipped
});
