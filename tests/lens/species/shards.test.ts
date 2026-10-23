// shards.ts: the sharding rule, the loaders, the cache and the typed errors.
import { describe, expect, it } from "vitest";
import {
  clearShardCache,
  createShardCache,
  loadAlias,
  loadTaxon,
  parseAliasShard,
  parseTaxonShard,
  shardIdFor,
} from "../../../src/lens/species/data/shards";
import { dataUrl } from "../../../src/lib/release/dataBase";
import { fixtureFetch, readFixture, type FetchLog } from "./fixtures";

// The expected column comes from the R twin itself (msens/R/app_bundle.R:125-134), printed by:
//
//   Rscript -e 'k <- c("ms_merge|WORMS:137209","am|Rep-3437","54383","ms_merge|BOTW:22694915",
//                      "rng_iucn|6494","ch_nmfs|Dermochelys_coriacea","0","255","256","007",
//                      "12345678901");
//               m <- regmatches(k, regexpr("[0-9]+$", k)); n <- rep(0, length(k));
//               hit <- regexpr("[0-9]+$", k) > 0; n[hit] <- as.numeric(m) %% 256;
//               cat(paste(k, sprintf("%02x", as.integer(n))), sep = "\n")'
//
// Run 2026-09-22 against msens' `.shard_of()`; every row below is that command's output verbatim.
const SHARD_VECTORS: [key: string, shard: string][] = [
  ["ms_merge|WORMS:137209", "f9"], // the leatherback, and the shard its fixture is published in
  ["am|Rep-3437", "6d"],
  ["54383", "6f"], // a v7 mdl_seq
  ["ms_merge|BOTW:22694915", "03"],
  ["rng_iucn|6494", "5e"],
  ["ch_nmfs|Dermochelys_coriacea", "00"], // no trailing digits -> "00"
  ["0", "00"],
  ["255", "ff"], // the top of the range
  ["256", "00"], // wraps
  ["007", "07"], // leading zeros are digits, not octal
  ["12345678901", "35"], // 11 digits: as.numeric, not as.integer (which would be NA -> "00")
];

describe("shardIdFor: the 256-way rule (msens .shard_of)", () => {
  for (const [key, shard] of SHARD_VECTORS) {
    it(`${key} -> ${shard}`, () => {
      expect(shardIdFor(key)).toBe(shard);
    });
  }

  it("always returns two lowercase hex digits", () => {
    for (let i = 0; i < 256; i++) expect(shardIdFor(String(i))).toMatch(/^[0-9a-f]{2}$/);
  });

  it("covers all 256 shards over 0..255 (a %% 255 rule would collide 0 and 255)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) seen.add(shardIdFor(String(i)));
    expect(seen.size).toBe(256);
  });

  it("every committed fixture sits in the shard its filename claims", () => {
    for (const [file, keys] of [
      ["v9/taxon/f9.json", ["ms_merge|WORMS:137209"]],
      ["v9/taxon/75.json", ["ms_merge|WORMS:137077"]],
      ["v7/taxon/6f.json", ["54383"]],
      ["v1/taxon/48.json", ["17224"]],
    ] as const) {
      const shard = (readFixture(file) as { shard: string }).shard;
      for (const key of keys) expect([file, shardIdFor(key)]).toEqual([file, shard]);
    }
  });
});

describe("loadTaxon / loadAlias", () => {
  it("reads the taxon card through dataUrl(), from the shard the key belongs to", async () => {
    const log: FetchLog = { urls: [] };
    const cache = createShardCache();
    const res = await loadTaxon("v9", "ms_merge|WORMS:137209", {
      fetchJson: fixtureFetch(log),
      cache,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.sci).toBe("Dermochelys coriacea");
    expect(log.urls).toEqual(["https://storage.oceanmetrics.io/marine-atlas/v9/app/taxon/f9.json"]);
  });

  it("caches the shard: a second taxon in the same shard costs no second fetch", async () => {
    const log: FetchLog = { urls: [] };
    const cache = createShardCache();
    const opts = { fetchJson: fixtureFetch(log), cache };
    await loadTaxon("v9", "ms_merge|WORMS:137209", opts);
    await loadTaxon("v9", "ax|137209", opts); // same shard (f9), absent from it -> not-found
    expect(log.urls).toHaveLength(1);
    clearShardCache(cache);
    await loadTaxon("v9", "ms_merge|WORMS:137209", opts);
    expect(log.urls).toHaveLength(2);
  });

  it("a missing key in a good shard is a typed not-found, not a throw", async () => {
    // 137465 = 137209 + 256, so it lands in the SAME shard (f9) that really loaded
    const res = await loadTaxon("v9", "ms_merge|WORMS:137465", {
      fetchJson: fixtureFetch(),
      cache: createShardCache(),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe("not-found");
  });

  it("a 404 is a typed http error carrying the status, and is NOT cached", async () => {
    const log: FetchLog = { urls: [] };
    const cache = createShardCache();
    const opts = { fetchJson: fixtureFetch(log), cache };
    const res = await loadTaxon("v9", "nothing|here|1", opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe("http");
    expect(res.error.status).toBe(404);
    await loadTaxon("v9", "nothing|here|1", opts);
    expect(log.urls).toHaveLength(2); // retried, because failures are never cached
  });

  it("a malformed shard is a typed schema error, never a throw into the UI", async () => {
    const res = await loadTaxon("v9", "ms_merge|WORMS:137209", {
      cache: createShardCache(),
      fetchJson: fixtureFetch(undefined, {
        "v9/app/taxon/f9.json": { schema: 1, ver: "v9", shard: "f9", taxa: { x: { key: "x" } } },
      }),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe("schema");
    expect(res.error.url).toBe(dataUrl("v9", "app/taxon/f9.json"));
  });

  it("an alias resolves a raw input key to [merged_key, ds_key]", async () => {
    const res = await loadAlias("v9", "ax|137209", {
      fetchJson: fixtureFetch(),
      cache: createShardCache(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ mergedKey: "ms_merge|WORMS:137209", dsKey: "ax" });
  });

  it("a merged key aliases to itself with ds_key ms_merge", async () => {
    const res = await loadAlias("v7", "54383", {
      fetchJson: fixtureFetch(),
      cache: createShardCache(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ mergedKey: "54383", dsKey: "ms_merge" });
  });
});

describe("parse: the shapes the contract allows", () => {
  it("merged: null is a VALUE (no published surface), not a schema violation", () => {
    const shard = parseTaxonShard(readFixture("v1/taxon/48.json"));
    expect(typeof shard).not.toBe("string");
    if (typeof shard === "string") return;
    const card = shard.taxa.get("17224");
    expect(card?.merged).toBeNull();
    expect(card?.inputs).toEqual([]);
  });

  it("merged.type: null is the same 'no surface' state", () => {
    const shard = parseTaxonShard({
      schema: 1,
      ver: "v9",
      shard: "00",
      taxa: {
        k: { key: "k", sci: "s", sp_cat: "fish", merged: { type: null, url: null }, inputs: [] },
      },
    });
    expect(typeof shard).not.toBe("string");
    if (typeof shard === "string") return;
    expect(shard.taxa.get("k")?.merged).toBeNull();
  });

  it("rescale is passed through verbatim, including AquaX's delivered 0-1000", () => {
    const shard = parseTaxonShard(readFixture("v9/taxon/f9.json"));
    if (typeof shard === "string") throw new Error(shard);
    const ax = shard.taxa.get("ms_merge|WORMS:137209")?.inputs.find((i) => i.dsKey === "ax");
    expect(ax?.assets.find((a) => a.rep === "native")?.rescale).toEqual([0, 1000]);
    expect(ax?.assets.find((a) => a.rep === "model")?.rescale).toEqual([1, 100]);
  });

  it("an envelope with a bad ver/shard is rejected", () => {
    expect(typeof parseTaxonShard({ schema: 1, ver: "nine", shard: "f9", taxa: {} })).toBe(
      "string",
    );
    expect(typeof parseTaxonShard({ schema: 1, ver: "v9", shard: "F9", taxa: {} })).toBe("string");
    expect(typeof parseAliasShard({ schema: 1, ver: "v9", shard: "f9", alias: { a: ["x"] } })).toBe(
      "string",
    );
  });
});
